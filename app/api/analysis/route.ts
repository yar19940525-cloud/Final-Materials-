import { analysisPrompt } from "@/lib/analysis-prompt";
import { filesToContent, handle, streamAI } from "@/lib/server-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

// 학교 시험지 + 기출분석 샘플 → 샘플 양식의 기출분석 자료 (HTML)
export async function POST(req: Request) {
  return handle(req, "analysis", async (form, apiKey, ctx) => {
    const raw = JSON.parse(String(form.get("options") ?? "{}"));
    const content = await filesToContent(form, { sample: "기출분석 샘플", exam: "학교 시험지" }, ["sample", "exam"]);
    content.push({
      type: "text",
      text: analysisPrompt({ title: String(raw.title ?? "").trim().slice(0, 80), note: String(raw.note ?? "").trim().slice(0, 1000) }),
    });
    return streamAI(apiKey, content, 64000, ctx);
  });
}
