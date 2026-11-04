// 업로드한 파일을 작은 조각(사진 1장 / PDF 3페이지)으로 나눠 병렬로 변환하고 순서대로 이어 붙인다.
// 한 번에 긴 문서를 보내면 AI 출력 한도(max_tokens)에서 잘리므로, 조각마다 별도 요청을 보낸다.
import { PDFDocument } from "pdf-lib";
import { authFetch } from "./auth-client";
import { clean, embedFigures, shrink } from "./client";

const CHUNK_PAGES = 3;
const CONCURRENCY = 3;
const RATE_WAIT_MS = [8000, 20000, 45000];
export const MAX_TOTAL_PAGES = 100;

const M = { err: "\u0000ERROR:", rate: "\u0000RATE:", trunc: "\u0000TRUNC:", ok: "\u0000OK" };
const BREAK = '<div class="pagebreak"></div>';

export interface SourceFile {
  file: File;
}

interface Unit {
  label: string;
  upload: Blob; // 서버로 보내는 파일
  uploadName: string;
  crop: Blob; // 그림을 잘라낼 원본 (사진 원본 / PDF 조각)
  pdf?: { doc: PDFDocument; from: number; to: number }; // PDF 조각이면 원본 문서와 페이지 범위(0부터, to 미포함)
}

type Outcome = { kind: "ok"; text: string } | { kind: "rate" } | { kind: "trunc" } | { kind: "err"; msg: string; retry: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function slicePdf(doc: PDFDocument, from: number, to: number): Promise<Blob> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, Array.from({ length: to - from }, (_, i) => from + i));
  pages.forEach((p) => out.addPage(p));
  return new Blob([new Uint8Array(await out.save())], { type: "application/pdf" });
}

export async function buildUnits(files: File[]): Promise<Unit[]> {
  const units: Unit[] = [];
  for (const [n, file] of files.entries()) {
    const name = file.name || `파일 ${n + 1}`;
    if (file.type !== "application/pdf") {
      const img = await shrink(file);
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(img.type))
        throw new Error(`이 사진 형식은 지원하지 않아요: ${name} (JPG·PNG 등으로 바꿔 주세요)`);
      units.push({ label: name, upload: img, uploadName: `page${n + 1}.${img.type === "image/jpeg" ? "jpg" : img.type.split("/")[1]}`, crop: file });
      continue;
    }
    let doc: PDFDocument | null = null;
    try {
      doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    } catch {
      /* 열 수 없는 PDF는 통째로 한 조각으로 보낸다 */
    }
    if (!doc || doc.getPageCount() <= CHUNK_PAGES) {
      units.push({ label: name, upload: file, uploadName: name, crop: file, pdf: doc ? { doc, from: 0, to: doc.getPageCount() } : undefined });
      continue;
    }
    const total = doc.getPageCount();
    for (let from = 0; from < total; from += CHUNK_PAGES) {
      const to = Math.min(total, from + CHUNK_PAGES);
      const blob = await slicePdf(doc, from, to);
      units.push({ label: `${name} ${from + 1}~${to}쪽`, upload: blob, uploadName: `part${from + 1}.pdf`, crop: blob, pdf: { doc, from, to } });
    }
  }
  return units;
}

export function countPages(units: Unit[]): number {
  return units.reduce((n, u) => n + (u.pdf ? u.pdf.to - u.pdf.from : 1), 0);
}

async function request(u: Unit, onChars: (n: number) => void, jobId: string): Promise<Outcome> {
  try {
    const fd = new FormData();
    fd.append("v", "2"); // 서버 응답 규약 버전 (app/api/convert/route.ts의 PROTOCOL과 같아야 함)
    fd.append("jobId", jobId);
    fd.append("files", u.upload, u.uploadName);
    const res = await authFetch("/api/convert", { method: "POST", body: fd });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => null);
      return { kind: "err", msg: j?.error ?? `서버 오류 (${res.status})`, retry: res.status >= 500 };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      onChars(text.length);
    }
    const at = (m: string) => text.indexOf(m);
    if (at(M.rate) >= 0) return { kind: "rate" };
    if (at(M.trunc) >= 0) return { kind: "trunc" };
    if (at(M.err) >= 0) return { kind: "err", msg: text.slice(at(M.err) + M.err.length).trim(), retry: false };
    if (at(M.ok) < 0) return { kind: "trunc" }; // 정상 종료 표식 없이 끊김 (서버 시간 제한·네트워크 등)
    const body = text.slice(0, at(M.ok));
    return body.trim() ? { kind: "ok", text: body } : { kind: "err", msg: "AI가 빈 결과를 돌려줬어요.", retry: true };
  } catch (e) {
    return { kind: "err", msg: e instanceof Error ? e.message : String(e), retry: true };
  }
}

const failNote = (label: string, msg: string) => `<p class="fail">⚠ ${label.replace(/[<>&]/g, "")} 변환 실패: ${msg.replace(/[<>&]/g, "")}</p>`;

async function runUnit(u: Unit, onChars: (n: number) => void, jobId: string, depth = 0): Promise<{ html: string; failed: number }> {
  let lastMsg = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await request(u, onChars, jobId);
    if (r.kind === "ok") return { html: await embedFigures(clean(r.text), [u.crop]), failed: 0 };
    if (r.kind === "rate") {
      lastMsg = "요청이 많아요.";
      await sleep(RATE_WAIT_MS[Math.min(attempt, RATE_WAIT_MS.length - 1)]);
      continue;
    }
    if (r.kind === "trunc") {
      lastMsg = "응답이 중간에 잘렸어요.";
      // 여러 쪽이면 반으로 쪼개 다시 시도한다
      if (u.pdf && u.pdf.to - u.pdf.from > 1 && depth < 3) {
        const mid = Math.floor((u.pdf.from + u.pdf.to) / 2);
        const mk = async (from: number, to: number): Promise<Unit> => {
          const blob = await slicePdf(u.pdf!.doc, from, to);
          return { label: `${u.label.replace(/ \d+~\d+쪽$/, "")} ${from + 1}~${to}쪽`, upload: blob, uploadName: `part${from + 1}.pdf`, crop: blob, pdf: { doc: u.pdf!.doc, from, to } };
        };
        const a = await runUnit(await mk(u.pdf.from, mid), onChars, jobId, depth + 1);
        const b = await runUnit(await mk(mid, u.pdf.to), onChars, jobId, depth + 1);
        return { html: a.html + BREAK + b.html, failed: a.failed + b.failed };
      }
      continue;
    }
    lastMsg = r.msg;
    if (!r.retry) break;
    await sleep(2000 * (attempt + 1));
  }
  return { html: failNote(u.label, lastMsg || "알 수 없는 오류"), failed: 1 };
}

export async function convertUnits(
  units: Unit[],
  onProgress: (done: number, total: number, chars: number) => void,
  jobId: string,
): Promise<{ html: string; failed: number }> {
  const results: string[] = new Array(units.length);
  let done = 0, failed = 0, next = 0;
  const live = new Map<number, number>(); // 진행 중인 조각별 받은 글자 수
  const report = () => onProgress(done, units.length, [...live.values()].reduce((a, b) => a + b, 0));
  const worker = async () => {
    while (next < units.length) {
      const i = next++;
      live.set(i, 0);
      const r = await runUnit(
        units[i],
        (n) => {
          live.set(i, n);
          report();
        },
        jobId,
      );
      results[i] = r.html;
      failed += r.failed;
      live.delete(i);
      done++;
      report();
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, units.length) }, worker));
  return { html: results.join(BREAK), failed };
}
