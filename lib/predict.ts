// 예상문제 만들기 (브라우저): 1) 출제 계획을 세우고 2) 5문항씩 나눠 병렬로 문제를 만든 뒤 번호순으로 이어 붙인다.
// 한 번에 수십 문항을 만들면 AI 출력 한도·서버 시간 제한에 걸리므로 나눠서 요청한다.
import { clean, shrink } from "./client";
import { DEFAULT_STYLE, type ExamStyle, type Plan, type PlanItem, type PredictOptions, type Role } from "./predict-prompt";

const PROTOCOL = "1"; // app/api/predict/route.ts의 PROTOCOL과 같아야 함
const BATCH = 5;
const CONCURRENCY = 3;
const RATE_WAIT_MS = [8000, 20000, 45000];
export const MAX_TOTAL_BYTES = 22 * 1024 * 1024;

const M = { err: "\u0000ERROR:", rate: "\u0000RATE:", trunc: "\u0000TRUNC:", ok: "\u0000OK" };
type Outcome = { kind: "ok"; text: string } | { kind: "rate" } | { kind: "trunc" } | { kind: "err"; msg: string; retry: boolean };

export interface Upload {
  role: Role;
  file: File;
}
interface Prepared {
  role: Role;
  blob: Blob;
  name: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

// 사진은 줄여서 보낸다 (PDF는 그대로).
export async function prepare(uploads: Upload[]): Promise<Prepared[]> {
  const out: Prepared[] = [];
  for (const [n, u] of uploads.entries()) {
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
    throw new Error(`파일 전체 용량이 너무 커요 (${(total / 1024 / 1024).toFixed(1)}MB, 최대 22MB). 기출문제 수를 줄여 주세요.`);
  return out;
}

async function request(files: Prepared[], fields: Record<string, string>, onChars: (n: number) => void): Promise<Outcome> {
  try {
    const fd = new FormData();
    fd.append("v", PROTOCOL);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) {
      fd.append("roles", f.role);
      fd.append("files", f.blob, f.name);
    }
    const res = await fetch("/api/predict", { method: "POST", body: fd });
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
    if (at(M.ok) < 0) return { kind: "trunc" }; // 정상 종료 표식 없이 끊김
    const body = text.slice(0, at(M.ok));
    return body.trim() ? { kind: "ok", text: body } : { kind: "err", msg: "AI가 빈 결과를 돌려줬어요.", retry: true };
  } catch (e) {
    return { kind: "err", msg: e instanceof Error ? e.message : String(e), retry: true };
  }
}

// 요청 과다·끊김은 기다렸다가 다시 시도한다.
async function withRetry(run: () => Promise<Outcome>): Promise<{ text: string } | { error: string }> {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await run();
    if (r.kind === "ok") return { text: r.text };
    if (r.kind === "rate") {
      last = "요청이 많아요.";
      await sleep(RATE_WAIT_MS[Math.min(attempt, RATE_WAIT_MS.length - 1)]);
      continue;
    }
    if (r.kind === "trunc") {
      last = "응답이 중간에 끊겼어요.";
      continue;
    }
    last = r.msg;
    if (!r.retry) break;
    await sleep(2000 * (attempt + 1));
  }
  return { error: last || "알 수 없는 오류" };
}

// AI가 읽어 온 디자인 값을 검사하고, 빠진 값은 기본값으로 채운다.
function normalizeStyle(raw: Partial<ExamStyle> | undefined): ExamStyle {
  const r = raw ?? {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const fields = Array.isArray(r.fields) ? r.fields.map((f) => str(f, 10)).filter(Boolean).slice(0, 6) : [];
  return {
    school: str(r.school, 40),
    title: str(r.title, 80),
    fields: fields.length ? fields : DEFAULT_STYLE.fields,
    columns: r.columns === 1 ? 1 : 2,
    font: r.font === "sans" ? "sans" : "serif",
    numStyle: r.numStyle === "box" ? "box" : "dot",
    choiceLayout: r.choiceLayout === "inline" ? "inline" : "vertical",
    boxPassage: r.boxPassage !== false,
    pointExample: str(r.pointExample, 20),
    essaySeparate: r.essaySeparate !== false,
    essayLabel: str(r.essayLabel, 10) || "서술형",
    note: str(r.note, 200),
    footer: str(r.footer, 40),
  };
}

const isMC = (it: PlanItem) => it.type.includes("객관");

// 번호 매기기: 서술형을 따로 매기는 학교면 객관식 먼저 1, 2, … 그다음 [서술형 1], [서술형 2], …
export function numberItems(items: PlanItem[], style: ExamStyle): PlanItem[] {
  if (!style.essaySeparate) return items.map((it, i) => ({ ...it, no: i + 1, num: `${i + 1}.` }));
  const mc = items.filter(isMC), essay = items.filter((it) => !isMC(it));
  return [
    ...mc.map((it, i) => ({ ...it, no: i + 1, num: `${i + 1}.` })),
    ...essay.map((it, i) => ({ ...it, no: mc.length + i + 1, num: `[${style.essayLabel} ${i + 1}]` })),
  ];
}

export async function makePlan(files: Prepared[], opts: PredictOptions, onChars: (n: number) => void): Promise<Plan> {
  const r = await withRetry(() => request(files, { stage: "plan", options: JSON.stringify(opts) }, onChars));
  if ("error" in r) throw new Error(r.error);
  let plan: Plan;
  try {
    plan = JSON.parse(r.text);
  } catch {
    throw new Error("출제 계획을 읽지 못했어요.");
  }
  if (!Array.isArray(plan.items) || !plan.items.length) throw new Error("출제 계획이 비어 있어요.");
  plan.style = normalizeStyle(plan.style);
  plan.items = numberItems(plan.items.slice(0, opts.count), plan.style);
  return plan;
}

export async function writeQuestions(
  files: Prepared[],
  opts: PredictOptions,
  items: PlanItem[],
  pointExample: string,
  onProgress: (done: number, total: number, chars: number) => void,
): Promise<{ html: string; failed: number }> {
  const batches: PlanItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const results: string[] = new Array(batches.length);
  const live = new Map<number, number>();
  let done = 0, failed = 0, next = 0;
  const report = () => onProgress(done, batches.length, [...live.values()].reduce((a, b) => a + b, 0));
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      const b = batches[i];
      live.set(i, 0);
      const r = await withRetry(() =>
        request(files, { stage: "write", options: JSON.stringify(opts), items: JSON.stringify(b), pointExample }, (n) => {
          live.set(i, n);
          report();
        }),
      );
      if ("text" in r) results[i] = clean(r.text);
      else {
        failed++;
        results[i] = `<p class="fail">⚠ ${b[0].num}~${b[b.length - 1].num} 만들기 실패: ${esc(r.error)} (“다시 만들기”로 재시도하세요)</p>`;
      }
      live.delete(i);
      done++;
      report();
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return { html: results.join(""), failed };
}

// 시험지 = 머리(학교·제목·학년반번호이름 칸·안내문) + 출제 경향(답지에만) + 문항 블록들.
// 문항은 <div class="blk">로 묶어 두고, 화면에서 이 블록 단위로 쪽·단에 배치한다 (lib/paginate.ts).
export function assemble(title: string, plan: Plan, questions: string): string {
  const st = plan.style;
  const head =
    `<div class="xh">` +
    `<div class="xh-row"><p class="xh-school">${esc(st.school)}</p>` +
    `<table class="xh-f"><tr>${st.fields.map((f) => `<th>${esc(f)}</th>`).join("")}</tr>` +
    `<tr>${st.fields.map(() => "<td>&nbsp;</td>").join("")}</tr></table></div>` +
    `<p class="xh-title">${esc(title || st.title || "예상문제")}</p>` +
    (st.note ? `<p class="xh-note">${esc(st.note)}</p>` : "") +
    `</div>`;

  const lines = plan.analysis
    .split("\n")
    .map((l) => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
  const ana =
    `<div class="blk ana"><h2 class="ana">📊 출제 경향 분석</h2>` +
    lines.map((l) => `<p class="ana">• ${esc(l)}</p>`).join("") +
    `</div>`;

  // 문항 시작(.qn)이나 실패 표시(.fail)마다 새 블록. 이어지는 선택지(.ch)는 한 묶음(.chs)으로.
  const doc = new DOMParser().parseFromString(`<div>${questions}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  const blocks: HTMLElement[] = [];
  let cur: HTMLElement | null = null;
  let chs: HTMLElement | null = null;
  for (const el of [...root.children] as HTMLElement[]) {
    if (!cur || el.classList.contains("qn") || el.classList.contains("fail")) {
      cur = doc.createElement("div");
      cur.className = "blk";
      blocks.push(cur);
      chs = null;
    }
    if (el.classList.contains("ch")) {
      if (!chs) {
        chs = doc.createElement("div");
        chs.className = "chs";
        cur.append(chs);
      }
      chs.append(el);
    } else {
      chs = null;
      cur.append(el);
    }
  }
  const end = plan.style.footer ? `<div class="blk"><p class="xh-end">${esc(plan.style.footer)}</p></div>` : "";
  return head + ana + blocks.map((b) => b.outerHTML).join("") + end;
}
