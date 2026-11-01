// 서버 전용: 업로드 파일 검사·변환과 Claude 스트리밍 응답 (응원 메시지·기출분석 탭에서 공용)
// 응답 규약은 lib/ai-client.ts와 같다: 결과 텍스트를 그대로 흘려보내고 끝에 \0OK / \0ERROR: / \0TRUNC: / \0RATE: 표식.
import Anthropic from "@anthropic-ai/sdk";
import { diagnose403 } from "./diagnose";
import type { Quality } from "./predict-prompt";

export const PROTOCOL = "1";
const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// Anthropic 요청 한도(32MB)에서 base64 부풀림(×1.33)을 감안한 원본 합계 상한
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

// 품질/비용 모드별 모델·생각 깊이 (예상문제 탭과 같은 기준)
export const MODES: Record<Quality, { model: string; effort: "low" | "medium" | "high"; fallback: boolean }> = {
  high: { model: "claude-opus-5-5", effort: "high", fallback: true },
  standard: { model: "claude-sonnet-5-5", effort: "medium", fallback: true },
  saver: { model: "claude-haiku-5-5", effort: "medium", fallback: false }, // Haiku는 서버 측 거절 대체 기능이 없다
};
export const readQuality = (v: unknown): Quality => (v === "high" || v === "saver" ? v : "standard");

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
export const fail = (error: string, status: number) => Response.json({ error }, { status });

// 폼에서 종류(roles)별 파일을 읽어 "[제목] n개 파일" + 파일 블록으로 만든다. 마지막 파일에 캐시 표시.
export async function filesToContent(
  form: FormData,
  labels: Record<string, string>,
  required: string[],
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const roles = form.getAll("roles").map(String);
  if (!files.length) throw new HttpError("파일이 없어요.", 400);
  if (files.length > MAX_FILES) throw new HttpError(`한 번에 최대 ${MAX_FILES}개까지 올릴 수 있어요.`, 400);
  if (roles.length !== files.length || roles.some((r) => !(r in labels))) throw new HttpError("파일 종류 정보가 잘못됐어요.", 400);
  for (const r of required) if (!roles.includes(r)) throw new HttpError(`${labels[r]}을(를) 한 개 이상 올려 주세요.`, 400);
  let total = 0;
  for (const f of files) {
    if (f.type !== "application/pdf" && !isImageType(f.type))
      throw new HttpError(`지원하지 않는 형식이에요: ${f.name || f.type} (JPG·PNG·WEBP·GIF·PDF만 가능)`, 400);
    if (f.size > MAX_FILE_BYTES) throw new HttpError(`파일이 너무 커요: ${f.name} (파일당 최대 20MB)`, 413);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new HttpError("파일 전체 용량이 너무 커요. (합계 최대 22MB)", 413);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const role of Object.keys(labels)) {
    const group = files.filter((_, i) => roles[i] === role);
    if (!group.length) continue;
    content.push({ type: "text", text: `[${labels[role]}] ${group.length}개 파일` });
    for (const f of group) {
      const data = Buffer.from(await f.arrayBuffer()).toString("base64");
      if (f.type === "application/pdf")
        content.push({ type: "document", title: f.name || undefined, source: { type: "base64", media_type: "application/pdf", data } });
      else if (isImageType(f.type)) content.push({ type: "image", source: { type: "base64", media_type: f.type, data } });
    }
  }
  const last = content[content.length - 1];
  if (last.type === "document" || last.type === "image") last.cache_control = { type: "ephemeral" };
  return content;
}

// Claude 응답을 스트리밍으로 돌려준다.
export function streamAI(apiKey: string, quality: Quality, content: Anthropic.Beta.BetaContentBlockParam[], maxTokens = 64000): Response {
  const mode = MODES[quality];
  const client = new Anthropic({ apiKey });
  const stream = client.beta.messages.stream({
    model: mode.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: mode.effort },
    ...(mode.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    messages: [{ role: "user", content }],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") send(event.delta.text);
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") send("\n\u0000ERROR:이 자료로는 만들 수 없어요.");
        else if (final.stop_reason === "max_tokens") send("\n\u0000TRUNC:내용이 너무 길어 중간에 잘렸어요.");
        else send("\n\u0000OK");
      } catch (err) {
        console.error("ai failed", err);
        if (err instanceof Anthropic.RateLimitError) send("\n\u0000RATE:요청이 많아요.");
        else send("\n\u0000ERROR:" + (await errorMessage(err, apiKey)));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

async function errorMessage(err: unknown, apiKey: string): Promise<string> {
  const m = err instanceof Error ? String(err.message) : String(err);
  if (err instanceof Anthropic.APIError && /usage limits/i.test(m)) {
    const until = m.match(/on (\d{4})-(\d{2})-(\d{2})/);
    return (
      "이번 달 AI 사용 한도에 도달했어요. console.anthropic.com → Settings → Limits에서 월 사용 한도를 올리면 바로 다시 쓸 수 있어요." +
      (until ? ` (그대로 두면 ${Number(until[2])}월 ${Number(until[3])}일에 풀려요)` : "")
    );
  }
  if (err instanceof Anthropic.APIError && /credit balance/i.test(m))
    return "AI 사용 크레딧이 다 떨어졌어요. console.anthropic.com → Settings → Billing에서 충전한 뒤 다시 시도해 주세요.";
  if (err instanceof Anthropic.AuthenticationError) return "서버의 API 키가 올바르지 않아요. 키를 확인해 주세요.";
  if (err instanceof Anthropic.PermissionDeniedError) return diagnose403(apiKey);
  if (err instanceof Anthropic.BadRequestError) return `요청 오류: ${m.slice(0, 200)} (파일 수·쪽수를 줄여 보세요)`;
  if (err instanceof Anthropic.APIError) return `AI 서버 오류 (${err.status ?? "연결 실패"}): ${m.slice(0, 200)}`;
  return `AI 처리 중 오류: ${m.slice(0, 200)}`;
}

// 라우트 공통 틀: 키 확인 → 규약 버전 확인 → 처리. HttpError는 JSON 오류로 바꾼다.
export async function handle(req: Request, run: (form: FormData, apiKey: string) => Promise<Response>): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.", 500);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("업로드를 읽지 못했어요.", 400);
  }
  if (form.get("v") !== PROTOCOL)
    return fail("화면이 예전 버전이에요. 페이지를 새로고침해 주세요. (설치한 앱은 완전히 종료한 뒤 다시 열어 주세요)", 426);
  try {
    return await run(form, apiKey);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    console.error(e);
    return fail("요청을 처리하지 못했어요.", 500);
  }
}
