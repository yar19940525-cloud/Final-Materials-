import Anthropic from "@anthropic-ai/sdk";
import { diagnose403 } from "@/lib/diagnose";
import {
  PLAN_SCHEMA,
  planPrompt,
  ROLE_LABEL,
  writePrompt,
  type PlanItem,
  type PredictOptions,
  type Role,
} from "@/lib/predict-prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

// 화면(lib/predict.ts)과 맞춰야 하는 규약 버전
const PROTOCOL = "1";
const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// Anthropic 요청 한도(32MB)에서 base64 부풀림(×1.33)을 감안한 원본 합계 상한
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const ROLES: Role[] = ["analysis", "past", "print"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

const fail = (error: string, status: number) => Response.json({ error }, { status });

function readOptions(raw: unknown): PredictOptions {
  const o = (raw ?? {}) as Partial<PredictOptions>;
  const level = (["기본", "중간", "상", "최상"] as const).find((l) => l === o.level) ?? "중간";
  return {
    count: Math.min(40, Math.max(1, Math.round(Number(o.count) || 20))),
    mcRatio: Math.min(100, Math.max(0, Math.round(Number(o.mcRatio) || 0))),
    level,
    note: String(o.note ?? "").slice(0, 1000),
  };
}

function readItems(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 15).map((i) => ({
    no: Math.round(Number(i?.no) || 0),
    type: String(i?.type ?? "").slice(0, 20),
    topic: String(i?.topic ?? "").slice(0, 600),
    basis: String(i?.basis ?? "").slice(0, 400),
    level: String(i?.level ?? "").slice(0, 20),
  }));
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.", 500);

  let files: File[] = [];
  let roles: Role[] = [];
  let stage: "plan" | "write";
  let opts: PredictOptions;
  let items: PlanItem[] = [];
  try {
    const form = await req.formData();
    if (form.get("v") !== PROTOCOL)
      return fail("화면이 예전 버전이에요. 페이지를 새로고침해 주세요. (설치한 앱은 완전히 종료한 뒤 다시 열어 주세요)", 426);
    stage = form.get("stage") === "write" ? "write" : "plan";
    opts = readOptions(JSON.parse(String(form.get("options") ?? "{}")));
    if (stage === "write") items = readItems(JSON.parse(String(form.get("items") ?? "[]")));
    files = form.getAll("files").filter((f): f is File => f instanceof File);
    roles = form.getAll("roles").map((r) => String(r) as Role);
  } catch {
    return fail("업로드를 읽지 못했어요.", 400);
  }
  if (!files.length) return fail("파일이 없어요.", 400);
  if (files.length > MAX_FILES) return fail(`한 번에 최대 ${MAX_FILES}개까지 올릴 수 있어요.`, 400);
  if (roles.length !== files.length || roles.some((r) => !ROLES.includes(r))) return fail("파일 종류 정보가 잘못됐어요.", 400);
  if (!roles.includes("print")) return fail("학교 프린트를 한 개 이상 올려 주세요.", 400);
  if (stage === "write" && !items.length) return fail("출제 계획이 없어요.", 400);

  let total = 0;
  for (const f of files) {
    if (f.type !== "application/pdf" && !isImageType(f.type))
      return fail(`지원하지 않는 형식이에요: ${f.name || f.type} (JPG·PNG·WEBP·GIF·PDF만 가능)`, 400);
    if (f.size > MAX_FILE_BYTES) return fail(`파일이 너무 커요: ${f.name} (파일당 최대 20MB)`, 413);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) return fail("파일 전체 용량이 너무 커요. (합계 최대 22MB) 기출문제 수를 줄여 주세요.", 413);

  // 종류별로 묶어 "[기출분석 자료]" 같은 제목 뒤에 파일을 붙인다.
  // 자료 부분은 매 요청 같으므로 마지막 자료에 캐시 표시를 달아 이어지는 요청(문항 나눠 만들기)을 싸고 빠르게 한다.
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const role of ROLES) {
    const group = files.filter((_, i) => roles[i] === role);
    if (!group.length) continue;
    content.push({ type: "text", text: `[${ROLE_LABEL[role]}] ${group.length}개 파일` });
    for (const f of group) {
      const data = Buffer.from(await f.arrayBuffer()).toString("base64");
      if (f.type === "application/pdf")
        content.push({ type: "document", title: f.name || undefined, source: { type: "base64", media_type: "application/pdf", data } });
      else if (isImageType(f.type)) content.push({ type: "image", source: { type: "base64", media_type: f.type, data } });
    }
  }
  const last = content[content.length - 1];
  if (last.type === "document" || last.type === "image") last.cache_control = { type: "ephemeral" };
  content.push({ type: "text", text: stage === "plan" ? planPrompt(opts) : writePrompt(opts, items) });

  const client = new Anthropic({ apiKey });
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config:
      stage === "plan"
        ? { effort: "high", format: { type: "json_schema", schema: PLAN_SCHEMA as unknown as Record<string, unknown> } }
        : { effort: "high" },
    // 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도한다.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  });

  // 결과 텍스트를 그대로 흘려보내고, 마지막에 표식 줄(\0OK, \0ERROR: 등)을 붙인다. (lib/predict.ts가 해석)
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") send(event.delta.text);
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") send("\n\u0000ERROR:이 자료로는 문제를 만들 수 없어요.");
        else if (final.stop_reason === "max_tokens") send("\n\u0000TRUNC:내용이 너무 길어 중간에 잘렸어요.");
        else send("\n\u0000OK");
      } catch (err) {
        console.error("predict failed", err);
        let msg = "AI 처리 중 오류가 났어요.";
        if (err instanceof Anthropic.RateLimitError) {
          send("\n\u0000RATE:요청이 많아요.");
          return;
        } else if (err instanceof Anthropic.AuthenticationError) msg = "서버의 API 키가 올바르지 않아요. 키를 확인해 주세요.";
        else if (err instanceof Anthropic.PermissionDeniedError) msg = await diagnose403(apiKey);
        else if (err instanceof Anthropic.BadRequestError) msg = `요청 오류: ${String(err.message).slice(0, 200)} (파일 수·쪽수를 줄여 보세요)`;
        else if (err instanceof Anthropic.APIError) msg = `AI 서버 오류 (${err.status ?? "연결 실패"}): ${String(err.message).slice(0, 200)}`;
        else if (err instanceof Error) msg = `AI 처리 중 오류: ${err.message.slice(0, 200)}`;
        send("\n\u0000ERROR:" + msg);
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
