import Anthropic from "@anthropic-ai/sdk";
import { CONVERT_PROMPT } from "@/lib/prompt";
import { diagnose403 } from "@/lib/diagnose";

export const runtime = "nodejs";
export const maxDuration = 300;

// 화면과 서버가 주고받는 규약 버전 (응답 표식 \0OK/\0TRUNC 등을 바꿀 때 올린다)
export const PROTOCOL = "2";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// Anthropic 요청 한도(32MB)에서 base64 부풀림(×1.33)을 감안한 원본 합계 상한
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  // Cloudflare Workers 등에서는 환경 변수가 요청 시점에만 보이므로, 클라이언트는 요청마다 만든다.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.", 500);

  let files: File[] = [];
  try {
    const form = await req.formData();
    // 화면(클라이언트)과 서버의 응답 규약이 맞아야 한다. 예전 화면이 열려 있으면 새로고침을 안내한다.
    if (form.get("v") !== PROTOCOL)
      return fail("화면이 예전 버전이에요. 페이지를 새로고침해 주세요. (설치한 앱은 완전히 종료한 뒤 다시 열어 주세요)", 426);
    files = form.getAll("files").filter((f): f is File => f instanceof File);
  } catch {
    return fail("업로드를 읽지 못했어요.", 400);
  }
  if (!files.length) return fail("파일이 없어요.", 400);
  if (files.length > MAX_FILES) return fail(`한 번에 최대 ${MAX_FILES}개까지 올릴 수 있어요.`, 400);

  let total = 0;
  for (const f of files) {
    if (f.type !== "application/pdf" && !isImageType(f.type))
      return fail(`지원하지 않는 형식이에요: ${f.name || f.type} (JPG·PNG·WEBP·GIF·PDF만 가능)`, 400);
    if (f.size > MAX_FILE_BYTES) return fail(`파일이 너무 커요: ${f.name} (파일당 최대 20MB)`, 413);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) return fail("파일 전체 용량이 너무 커요. (합계 최대 22MB)", 413);

  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of files) {
    const data = Buffer.from(await f.arrayBuffer()).toString("base64");
    if (f.type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if (isImageType(f.type)) {
      content.push({ type: "image", source: { type: "base64", media_type: f.type, data } });
    }
  }
  const kinds = files.map((f, i) => `파일 ${i + 1}: ${f.type === "application/pdf" ? "PDF" : "사진"}`).join(", ");
  content.push({
    type: "text",
    text:
      (files.length > 1
        ? `위 ${files.length}개 파일(${kinds})은 같은 학습지의 연속된 부분이야. 올린 순서대로 하나의 HTML로 만들되, 파일과 파일 사이(PDF는 원본 페이지와 페이지 사이)에는 반드시 <div class="pagebreak"></div> 한 줄을 넣어. 이 표식은 각 파일이 PDF의 새 페이지에서 시작하게 하는 용도야.\n\n`
        : files[0].type === "application/pdf"
          ? `파일 1: PDF. PDF의 원본 페이지와 페이지 사이에는 반드시 <div class="pagebreak"></div> 한 줄을 넣어.\n\n`
          : `파일 1: 사진\n\n`) + CONVERT_PROMPT,
  });

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: "claude-haiku-5-5",
    max_tokens: 40000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content }],
  });

  // 결과 HTML 텍스트를 그대로 흘려보내고, 실패 시 마지막에 표식 줄을 붙인다.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") send(event.delta.text);
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") send("\n\u0000ERROR:이 파일은 변환할 수 없어요.");
        else if (final.stop_reason === "max_tokens") send("\n\u0000TRUNC:내용이 너무 길어 중간에 잘렸어요.");
        else send("\n\u0000OK"); // 끝까지 정상 종료됐다는 표식 (없으면 클라이언트가 '중간에 끊김'으로 본다)
      } catch (err) {
        console.error("convert failed", err);
        let msg = "AI 변환 중 오류가 났어요.";
        if (err instanceof Anthropic.RateLimitError) { send("\n\u0000RATE:요청이 많아요."); return; }
        else if (err instanceof Anthropic.AuthenticationError) msg = "서버의 API 키가 올바르지 않아요. 키를 확인해 주세요.";
        else if (err instanceof Anthropic.PermissionDeniedError) msg = await diagnose403(apiKey);
        else if (err instanceof Anthropic.APIError)
          msg = `AI 서버 오류 (${err.status ?? "연결 실패"}): ${String(err.message).slice(0, 200)}`;
        else if (err instanceof Error) msg = `AI 변환 중 오류: ${err.message.slice(0, 200)}`;
        send("\n\u0000ERROR:" + msg);
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
