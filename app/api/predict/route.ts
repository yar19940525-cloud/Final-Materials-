import { filesToContent, handle, HttpError, streamAI } from "@/lib/server-ai";
import {
  AREAS,
  PLAN_SCHEMA,
  planPrompt,
  ROLE_LABEL,
  writePrompt,
  type PlanItem,
  type PredictOptions,
} from "@/lib/predict-prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

function readOptions(raw: unknown): PredictOptions {
  const o = (raw ?? {}) as Partial<PredictOptions>;
  const level = (["기본", "중간", "상", "최상"] as const).find((l) => l === o.level) ?? "중간";
  return {
    count: Math.min(40, Math.max(1, Math.round(Number(o.count) || 20))),
    mcRatio: Math.min(100, Math.max(0, Math.round(Number(o.mcRatio) || 0))),
    level,
    note: String(o.note ?? "").slice(0, 1000),
    variant: o.variant === "hakpeu" ? "hakpeu" : "jikbo",
    areas: Object.fromEntries(
      AREAS.map((a) => [a, Math.min(20, Math.max(0, Math.round(Number(o.areas?.[a]) || 0)))]),
    ) as PredictOptions["areas"],
  };
}

function readItems(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 15).map((i) => ({
    no: Math.round(Number(i?.no) || 0),
    num: String(i?.num ?? "").slice(0, 20),
    type: String(i?.type ?? "").slice(0, 20),
    topic: String(i?.topic ?? "").slice(0, 600),
    basis: String(i?.basis ?? "").slice(0, 400),
    level: String(i?.level ?? "").slice(0, 20),
    area: String(i?.area ?? "").slice(0, 10),
  }));
}

export async function POST(req: Request) {
  return handle(
    req,
    (form) => (JSON.parse(String(form.get("options") ?? "{}")).variant === "hakpeu" ? "predict-hakpeu" : "predict-jikbo"),
    async (form, apiKey, ctx) => {
      const stage: "plan" | "write" = form.get("stage") === "write" ? "write" : "plan";
      const opts = readOptions(JSON.parse(String(form.get("options") ?? "{}")));
      const items = stage === "write" ? readItems(JSON.parse(String(form.get("items") ?? "[]"))) : [];
      const pointExample = String(form.get("pointExample") ?? "").slice(0, 20);
      if (stage === "write" && !items.length) throw new HttpError("출제 계획이 없어요.", 400);

      // 같은 자료를 계획·문항 작성 여러 번 보내므로 캐시 표시를 달아 싸고 빠르게 한다.
      const content = await filesToContent(form, ROLE_LABEL, ["print"], true);
      content.push({ type: "text", text: stage === "plan" ? planPrompt(opts) : writePrompt(opts, items, pointExample) });
      return streamAI(apiKey, content, 64000, ctx, {
        schema: stage === "plan" ? (PLAN_SCHEMA as unknown as Record<string, unknown>) : undefined,
        refusal: "이 자료로는 문제를 만들 수 없어요.",
      });
    },
    "1", // 화면(lib/predict.ts)과 맞춰야 하는 규약 버전
  );
}
