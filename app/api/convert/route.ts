import { CONVERT_PROMPT } from "@/lib/prompt";
import { fileBlock, handle, readFiles, streamAI } from "@/lib/server-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

// 화면과 서버가 주고받는 규약 버전 (응답 표식 \0OK/\0TRUNC 등을 바꿀 때 올린다)
const PROTOCOL = "2";
const MAX_FILES = 10;

// 학습지 사진·PDF 조각 → 필기를 지운 시험지/답지 HTML
export async function POST(req: Request) {
  return handle(
    req,
    "convert",
    async (form, apiKey, ctx) => {
      const files = readFiles(form, MAX_FILES);
      const content = [];
      for (const f of files) content.push(await fileBlock(f));
      const kinds = files.map((f, i) => `파일 ${i + 1}: ${f.type === "application/pdf" ? "PDF" : "사진"}`).join(", ");
      content.push({
        type: "text" as const,
        text:
          (files.length > 1
            ? `위 ${files.length}개 파일(${kinds})은 같은 학습지의 연속된 부분이야. 올린 순서대로 하나의 HTML로 만들되, 파일과 파일 사이(PDF는 원본 페이지와 페이지 사이)에는 반드시 <div class="pagebreak"></div> 한 줄을 넣어. 이 표식은 각 파일이 PDF의 새 페이지에서 시작하게 하는 용도야.\n\n`
            : files[0].type === "application/pdf"
              ? `파일 1: PDF. PDF의 원본 페이지와 페이지 사이에는 반드시 <div class="pagebreak"></div> 한 줄을 넣어.\n\n`
              : `파일 1: 사진\n\n`) + CONVERT_PROMPT,
      });
      return streamAI(apiKey, content, 40000, ctx, { refusal: "이 파일은 변환할 수 없어요." });
    },
    PROTOCOL,
  );
}
