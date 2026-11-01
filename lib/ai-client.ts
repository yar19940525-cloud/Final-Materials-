// 브라우저 공용: 파일 준비(사진 축소), 서버 스트리밍 요청, 재시도 (응원 메시지·기출분석 탭)
import { shrink } from "./client";

const PROTOCOL = "1"; // lib/server-ai.ts의 PROTOCOL과 같아야 함
const RATE_WAIT_MS = [8000, 20000, 45000];
export const MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const M = { err: "\u0000ERROR:", rate: "\u0000RATE:", trunc: "\u0000TRUNC:", ok: "\u0000OK" };

export interface RoleFile {
  role: string;
  file: File;
}
interface Prepared {
  role: string;
  blob: Blob;
  name: string;
}
type Outcome = { kind: "ok"; text: string } | { kind: "rate" } | { kind: "trunc"; text: string } | { kind: "err"; msg: string; retry: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function prepareFiles(list: RoleFile[]): Promise<Prepared[]> {
  const out: Prepared[] = [];
  for (const [n, u] of list.entries()) {
    if (u.file.type === "application/pdf") {
      out.push({ role: u.role, blob: u.file, name: u.file.name || `file${n + 1}.pdf` });
      continue;
    }
    const img = await shrink(u.file);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(img.type))
      throw new Error(`이 사진 형식은 지원하지 않아요: ${u.file.name} (JPG·PNG 등으로 바꿔 주세요)`);
    out.push({ role: u.role, blob: img, name: `img${n + 1}.${img.type === "image/jpeg" ? "jpg" : img.type.split("/")[1]}` });
  }
  const total = out.reduce((s, p) => s + p.blob.size, 0);
  if (total > MAX_TOTAL_BYTES)
    throw new Error(`파일 전체 용량이 너무 커요 (${(total / 1024 / 1024).toFixed(1)}MB, 최대 22MB). 파일 수를 줄여 주세요.`);
  return out;
}

async function request(url: string, files: Prepared[], fields: Record<string, string>, onText: (t: string) => void): Promise<Outcome> {
  try {
    const fd = new FormData();
    fd.append("v", PROTOCOL);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) {
      fd.append("roles", f.role);
      fd.append("files", f.blob, f.name);
    }
    const res = await fetch(url, { method: "POST", body: fd });
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
      const cut = text.indexOf("\u0000");
      onText(cut >= 0 ? text.slice(0, cut) : text);
    }
    const at = (m: string) => text.indexOf(m);
    if (at(M.rate) >= 0) return { kind: "rate" };
    if (at(M.trunc) >= 0) return { kind: "trunc", text: text.slice(0, at(M.trunc)) };
    if (at(M.err) >= 0) return { kind: "err", msg: text.slice(at(M.err) + M.err.length).trim(), retry: false };
    if (at(M.ok) < 0) return { kind: "trunc", text }; // 정상 종료 표식 없이 끊김
    const body = text.slice(0, at(M.ok));
    return body.trim() ? { kind: "ok", text: body } : { kind: "err", msg: "AI가 빈 결과를 돌려줬어요.", retry: true };
  } catch (e) {
    return { kind: "err", msg: e instanceof Error ? e.message : String(e), retry: true };
  }
}

// 요청 과다·일시 오류는 기다렸다 다시 시도. 잘린 결과는 그대로 돌려주되 truncated로 알린다.
export async function runAI(
  url: string,
  files: Prepared[],
  fields: Record<string, string>,
  onText: (t: string) => void,
): Promise<{ text: string; truncated: boolean }> {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await request(url, files, fields, onText);
    if (r.kind === "ok") return { text: r.text, truncated: false };
    if (r.kind === "trunc") {
      if (r.text.trim()) return { text: r.text, truncated: true };
      last = "응답이 중간에 끊겼어요.";
      continue;
    }
    if (r.kind === "rate") {
      last = "요청이 많아요.";
      await sleep(RATE_WAIT_MS[Math.min(attempt, RATE_WAIT_MS.length - 1)]);
      continue;
    }
    last = r.msg;
    if (!r.retry) break;
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(last || "알 수 없는 오류");
}
