// 서버 전용: 업로드 파일 검사·변환과 Claude 스트리밍 응답 (응원 메시지·기출분석 탭에서 공용)
// 응답 규약은 lib/ai-client.ts와 같다: 결과 텍스트를 그대로 흘려보내고 끝에 \0OK / \0ERROR: / \0TRUNC: / \0RATE: 표식.
import Anthropic from "@anthropic-ai/sdk";
import { diagnose403 } from "./diagnose";
import { fail, HttpError } from "./http";
import { requireApproved } from "./server-auth";
import { asFeature, asJobId, recordUsage, type Feature, type JobCtx, type Usage } from "./usage";

export { HttpError, fail };
export const PROTOCOL = "1";
const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// Anthropic 요청 한도(32MB)에서 base64 부풀림(×1.33)을 감안한 원본 합계 상한
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

// 요금 절감: 모든 자료를 가장 싼 모델(Haiku)로만 만든다. 화면에서 다른 값을 보내도 무시한다.
export const MODEL = "claude-haiku-5-5";
export const EFFORT = "medium" as const;

// 올린 파일을 읽고 형식·크기를 검사한다.
export function readFiles(form: FormData, max = MAX_FILES): File[] {
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError("파일이 없어요.", 400);
  if (files.length > max) throw new HttpError(`한 번에 최대 ${max}개까지 올릴 수 있어요.`, 400);
  let total = 0;
  for (const f of files) {
    if (f.type !== "application/pdf" && !isImageType(f.type))
      throw new HttpError(`지원하지 않는 형식이에요: ${f.name || f.type} (JPG·PNG·WEBP·GIF·PDF만 가능)`, 400);
    if (f.size > MAX_FILE_BYTES) throw new HttpError(`파일이 너무 커요: ${f.name} (파일당 최대 20MB)`, 413);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new HttpError("파일 전체 용량이 너무 커요. (합계 최대 22MB)", 413);
  return files;
}

// 파일 하나를 Claude에 보낼 블록으로 바꾼다.
export async function fileBlock(f: File): Promise<Anthropic.Beta.BetaContentBlockParam> {
  const data = Buffer.from(await f.arrayBuffer()).toString("base64");
  if (f.type === "application/pdf")
    return { type: "document", title: f.name || undefined, source: { type: "base64", media_type: "application/pdf", data } };
  return { type: "image", source: { type: "base64", media_type: f.type as ImageType, data } };
}

// 폼에서 종류(roles)별 파일을 읽어 "[제목] n개 파일" + 파일 블록으로 만든다.
// cache=true면 마지막 파일에 캐시 표시를 달아 같은 자료를 여러 번 보내는 작업(예상문제)을 싸게 한다.
export async function filesToContent(
  form: FormData,
  labels: Record<string, string>,
  required: string[],
  cache = false,
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const files = readFiles(form);
  const roles = form.getAll("roles").map(String);
  if (roles.length !== files.length || roles.some((r) => !(r in labels))) throw new HttpError("파일 종류 정보가 잘못됐어요.", 400);
  for (const r of required) if (!roles.includes(r)) throw new HttpError(`${labels[r]}을(를) 한 개 이상 올려 주세요.`, 400);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const role of Object.keys(labels)) {
    const group = files.filter((_, i) => roles[i] === role);
    if (!group.length) continue;
    content.push({ type: "text", text: `[${labels[role]}] ${group.length}개 파일` });
    for (const f of group) content.push(await fileBlock(f));
  }
  const last = content[content.length - 1];
  if (cache && (last.type === "document" || last.type === "image")) last.cache_control = { type: "ephemeral" };
  return content;
}

// Claude 응답을 스트리밍으로 돌려주고, 끝나면 사용량(토큰·추정 요금)을 이 작업(ctx.jobId)에 기록한다.
// opts.schema가 있으면 그 JSON 형식으로만 답하게 한다. opts.refusal은 거절됐을 때 보여 줄 문구.
export function streamAI(
  apiKey: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  maxTokens: number,
  ctx: JobCtx,
  opts: { schema?: Record<string, unknown>; refusal?: string } = {},
): Response {
  const client = new Anthropic({ apiKey });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: opts.schema ? { effort: EFFORT, format: { type: "json_schema", schema: opts.schema } } : { effort: EFFORT },
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
        const u = final.usage;
        const usage: Usage = {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        };
        await recordUsage(ctx, usage, final.stop_reason === "refusal" ? "거절됨" : final.stop_reason === "max_tokens" ? "길이 초과로 잘림" : undefined);
        if (final.stop_reason === "refusal") send("\n\u0000ERROR:" + (opts.refusal ?? "이 자료로는 만들 수 없어요."));
        else if (final.stop_reason === "max_tokens") send("\n\u0000TRUNC:내용이 너무 길어 중간에 잘렸어요.");
        else send("\n\u0000OK");
      } catch (err) {
        console.error("ai failed", err);
        if (err instanceof Anthropic.RateLimitError) {
          await recordUsage(ctx, null, "요청 과다(429)");
          send("\n\u0000RATE:요청이 많아요.");
        } else {
          const msg = await errorMessage(err, apiKey);
          await recordUsage(ctx, null, msg);
          send("\n\u0000ERROR:" + msg);
        }
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

// 라우트 공통 틀: 키 확인 → 로그인·승인 확인 → 업로드 읽기 → 규약 버전 확인 → 처리.
// 로그인하지 않았거나 승인되지 않은 사람은 파일을 읽기도 전에 여기서 막는다.
export async function handle(
  req: Request,
  feature: Feature | ((form: FormData) => Feature),
  run: (form: FormData, apiKey: string, ctx: JobCtx) => Promise<Response>,
  protocol = PROTOCOL,
): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.", 500);
  try {
    const { profile } = await requireApproved(req);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("업로드를 읽지 못했어요.", 400);
    }
    if (form.get("v") !== protocol)
      return fail("화면이 예전 버전이에요. 페이지를 새로고침해 주세요. (설치한 앱은 완전히 종료한 뒤 다시 열어 주세요)", 426);
    const f = typeof feature === "function" ? feature(form) : feature;
    // 작업 번호는 화면이 정해서 보낸다 (한 번의 작업 = 여러 AI 호출). 없으면 이번 호출만의 번호를 새로 만든다.
    const ctx: JobCtx = { userId: profile.id, jobId: asJobId(form.get("jobId")) ?? crypto.randomUUID(), feature: asFeature(f) ?? "cheer" };
    return await run(form, apiKey, ctx);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    console.error(e);
    return fail("요청을 처리하지 못했어요.", 500);
  }
}
