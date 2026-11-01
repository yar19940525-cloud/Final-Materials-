import { analysisSmsPrompt } from "@/lib/analysis-sms-prompt";
import { handle, HttpError, readQuality, streamAI } from "@/lib/server-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

// 만들어 둔 기출분석 자료(글) → 기출분석 요약 문자. 파일은 다시 보내지 않아 싸고 빠르다.
export async function POST(req: Request) {
  return handle(req, async (form, apiKey) => {
    const raw = JSON.parse(String(form.get("options") ?? "{}"));
    const analysis = String(form.get("analysis") ?? "").trim().slice(0, 60000);
    if (analysis.length < 50) throw new HttpError("기출분석 자료를 먼저 만들어 주세요.", 400);
    const note = String(raw.note ?? "").trim().slice(0, 1000);
    return streamAI(apiKey, readQuality(raw.quality), [{ type: "text", text: analysisSmsPrompt(analysis, note) }], 16000);
  });
}
