import { dialoguePrompt, type BlankLevel } from "@/lib/dialogue-prompt";
import { filesToContent, handle, streamAI } from "@/lib/server-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

// 교과서 대화문 사진 (한 번에 한 장) → 과 표시 + 영어 빈칸 + 우리말 표
export async function POST(req: Request) {
  return handle(req, async (form, apiKey) => {
    const raw = JSON.parse(String(form.get("options") ?? "{}"));
    const level: BlankLevel = raw.level === "적게" || raw.level === "많이" ? raw.level : "보통";
    const content = await filesToContent(form, { dlg: "교과서 대화문" }, ["dlg"]);
    content.push({ type: "text", text: dialoguePrompt(level, String(raw.note ?? "").trim().slice(0, 1000)) });
    return streamAI(apiKey, content, 32000);
  });
}
