import { cheerPrompt, type CheerOptions } from "@/lib/cheer-prompt";
import { filesToContent, handle, streamAI } from "@/lib/server-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// 직보 자료 → 시험 당일 응원 문자
export async function POST(req: Request) {
  return handle(req, "cheer", async (form, apiKey, ctx) => {
    const raw = JSON.parse(String(form.get("options") ?? "{}"));
    const o: CheerOptions = {
      school: str(raw.school, 30),
      subject: str(raw.subject, 20) || "영어",
      teacher: str(raw.teacher, 20) || "선생님",
      linkTitle: str(raw.linkTitle, 60),
      link: /^https?:\/\//.test(str(raw.link, 500)) ? str(raw.link, 500) : "",
      note: str(raw.note, 1000),
    };
    const content = await filesToContent(form, { notes: "직보 자료" }, ["notes"]);
    content.push({ type: "text", text: cheerPrompt(o) });
    return streamAI(apiKey, content, 16000, ctx);
  });
}
