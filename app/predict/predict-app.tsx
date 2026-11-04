"use client";

import Nav from "../nav";
import Progress, { useProgress } from "../progress";
import { byChars } from "@/lib/progress";
import { useEffect, useRef, useState } from "react";
import { download, makePagesPdf } from "@/lib/client";
import { makeDocx } from "@/lib/docx";
import { assemble, makePlan, prepare, writeQuestions } from "@/lib/predict";
import { flatten, paginate } from "@/lib/paginate";
import { AREAS, DEFAULT_STYLE, type Area, type ExamStyle, type PredictOptions, type Role, type Variant } from "@/lib/predict-prompt";

type Mode = "test" | "key";
interface Item {
  id: number;
  role: Role;
  file: File;
  url: string;
}
const MAX_FILES = 30;
let nextId = 1;

type Slot = { role: Role; icon: string; label: string; desc: string; required?: boolean };

// 탭별 화면 구성: 직보예상문제(기출 경향 + 직보·프린트) / 학프예상문제(학프 → 영역별)
const VARIANTS: Record<Variant, { title: string; sub: string; slots: Slot[]; heading: string; needHint: string }> = {
  jikbo: {
    title: "🎯 직보예상문제",
    sub: "기출분석·기출문제로 우리 학교 출제 경향을 파악하고, 직보·학교 프린트 내용으로 예상문제를 쫙 뽑아 줍니다.",
    slots: [
      { role: "analysis", icon: "📊", label: "기출분석 자료", desc: "선생님 출제 경향을 정리한 기출분석 파일 (PDF·사진)" },
      { role: "past", icon: "📚", label: "기출문제", desc: "이 학교 지난 시험지 (PDF·사진, 여러 개 가능)" },
      { role: "print", icon: "📄", label: "직보·학교 프린트 (이번 시험 범위)", desc: "이번 시험 범위 직보·학교 프린트 (PDF·사진) — 필수", required: true },
    ],
    heading: "📊 출제 경향 분석",
    needHint: "직보·학교 프린트를 올리면 시작할 수 있어요. 기출분석·기출문제가 많을수록 우리 학교 스타일에 가까워져요.",
  },
  hakpeu: {
    title: "📘 학프예상문제",
    sub: "학교 프린트(학프)를 올리면 어법·어휘·독해·서술형 영역별로 예상문제를 쫙 뽑아 줍니다. 기출 시험지를 넣으면 그 디자인을 따라 해요.",
    slots: [
      { role: "print", icon: "📘", label: "학프 자료", desc: "학교 프린트 (PDF·사진, 여러 개 가능) — 필수", required: true },
      { role: "past", icon: "📚", label: "기출 시험지 (디자인 참고)", desc: "이 학교 지난 시험지 — 넣으면 시험지 모양·말투를 따라 해요 (선택)" },
    ],
    heading: "📌 학프 핵심 정리",
    needHint: "학프 자료를 올리면 시작할 수 있어요.",
  },
};
const DEFAULT_AREAS: Record<Area, number> = { 어법: 6, 어휘: 4, 독해: 8, 서술형: 2 };

export default function PredictApp({ variant }: { variant: Variant }) {
  const V = VARIANTS[variant];
  const SLOTS = V.slots;
  const [items, setItems] = useState<Item[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [opts, setOpts] = useState<PredictOptions>({ count: 20, mcRatio: 70, level: "중간", note: "", variant, areas: DEFAULT_AREAS });
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const prog = useProgress(0.08);
  const [exporting, setExporting] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("test");
  const [style, setStyle] = useState<ExamStyle>(DEFAULT_STYLE);
  const styleRef = useRef(style);
  styleRef.current = style;
  const sheetRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  useEffect(() => {
    if (previewId === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreviewId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId]);

  // 시험지/답지·디자인에 따라 블록 높이가 달라지므로 그때마다 쪽·단을 다시 배치한다.
  function relayout() {
    if (sheetRef.current?.querySelector(".blk")) paginate(sheetRef.current, styleRef.current.columns);
  }

  // 직접 고친 내용을 지키기 위해 새 결과가 올 때만 innerHTML을 넣는다.
  useEffect(() => {
    if (html !== null && sheetRef.current) {
      sheetRef.current.innerHTML = html;
      relayout();
      document.fonts?.ready.then(relayout);
      outRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [html]);

  useEffect(relayout, [mode, style]);

  function onPick(role: Role, e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!picked.length) return;
    const ok = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    const room = MAX_FILES - items.length;
    const added = ok.slice(0, Math.max(room, 0)).map<Item>((file) => ({ id: nextId++, role, file, url: URL.createObjectURL(file) }));
    setItems((cur) => [...cur, ...added]);
    const notes: string[] = [];
    if (ok.length < picked.length) notes.push("사진·PDF가 아닌 파일은 제외했어요.");
    if (ok.length > added.length) notes.push(`전체 최대 ${MAX_FILES}개까지만 올릴 수 있어요.`);
    setMsg({ text: notes.join(" ") });
  }

  function removeItem(id: number) {
    setItems((cur) => {
      const gone = cur.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((i) => i.id !== id);
    });
  }

  const areaTotal = AREAS.reduce((n, a) => n + (opts.areas?.[a] ?? 0), 0);
  const hasPrint = items.some((i) => i.role === "print") && (variant !== "hakpeu" || (areaTotal > 0 && areaTotal <= 40));

  async function generate() {
    if (!hasPrint || busy) return;
    setBusy(true);
    prog.start();
    setMsg({ text: "파일을 준비하는 중…" });
    const t0 = Date.now();
    const sec = () => Math.round((Date.now() - t0) / 1000);
    try {
      const files = await prepare(items.map((i) => ({ role: i.role, file: i.file })));
      const o = variant === "hakpeu" ? { ...opts, count: areaTotal } : opts;
      setMsg({ text: "1단계: 자료를 분석하고 출제 계획을 세우는 중… (1~2분)" });
      const plan = await makePlan(files, o, (n) =>
        {
          setMsg({ text: `1단계: 자료 분석·출제 계획 중… (${n.toLocaleString()}자, ${sec()}초)` });
          prog.set(0.15 * byChars(n, 180 * o.count + 800)); // 계획 단계 = 전체의 15%
        },
      );
      prog.set(0.15);
      setMsg({ text: `2단계: ${plan.items.length}문항을 만드는 중…` });
      const { html: qs, failed } = await writeQuestions(files, o, plan.items, plan.style.pointExample, (done, total, chars) =>
        {
          setMsg({ text: `2단계: 문제 만드는 중… ${done}/${total} 묶음 완료 (${chars.toLocaleString()}자, ${sec()}초)` });
          // 문항 작성 단계 = 나머지 85%: 끝난 묶음 + 진행 중인 묶음(묶음당 약 3,500자로 어림)
          const inflight = Math.min(3, total - done);
          prog.set(0.15 + 0.85 * Math.min(1, (done + Math.min(inflight * 0.9, chars / 3500)) / total));
        },
      );
      setMode("test");
      setStyle(plan.style);
      setHtml(assemble(title.trim(), plan, qs, V.heading));
      setMsg(
        failed
          ? { text: `일부 실패: ⚠ 표시된 문항 묶음을 못 만들었어요. 다시 만들어 보세요.`, err: true }
          : { text: `완료! ${plan.items.length}문항 (${sec()}초). 답지 탭에서 정답·해설·출제 근거를 확인하세요.` },
      );
    } catch (e) {
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e} 다시 시도해 주세요.`, err: true });
    } finally {
      setBusy(false);
      prog.stop();
    }
  }

  const sheetClass = (m: Mode) =>
    ["sheet pq paged", m, style.font === "sans" ? "f-sans" : "f-serif", style.numStyle === "box" ? "n-box" : "",
      style.choiceLayout === "inline" ? "chi" : "", style.boxPassage ? "bxon" : ""].filter(Boolean).join(" ");

  // 내보낼 모드로 잠깐 바꿔 다시 배치한 뒤 쪽마다 찍는다.
  async function renderPdf(m: Mode): Promise<Blob> {
    const el = sheetRef.current!;
    const prev = el.className;
    try {
      el.className = sheetClass(m);
      relayout();
      return await makePagesPdf(el);
    } finally {
      el.className = prev;
      relayout();
    }
  }

  async function pdf(m: Mode) {
    if (!sheetRef.current || exporting) return;
    setExporting(true);
    setMsg({ text: "PDF 만드는 중…" });
    try {
      download(m === "key" ? "predict-answer-key.pdf" : "predict-test.pdf", await renderPdf(m));
      setMsg({ text: "PDF 저장 완료!" });
    } catch (e) {
      setMsg({ text: `PDF 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setExporting(false);
    }
  }

  // 인쇄: 화면 그대로의 PDF를 새 탭에 열어 거기서 인쇄한다 (브라우저 인쇄는 쪽 나눔이 어긋나기 쉬움).
  async function print() {
    if (!sheetRef.current || exporting) return;
    const w = window.open("", "_blank"); // 팝업 차단을 피하려고 클릭 순간에 먼저 연다
    setExporting(true);
    setMsg({ text: "인쇄용 PDF 만드는 중…" });
    try {
      const url = URL.createObjectURL(await renderPdf(mode));
      if (w) w.location.href = url;
      else window.location.href = url;
      setMsg({ text: "새 탭에서 인쇄하세요." });
    } catch (e) {
      w?.close();
      setMsg({ text: `인쇄 준비 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setExporting(false);
    }
  }

  async function word(m: Mode) {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "Word 파일 만드는 중…" });
    try {
      download(m === "key" ? "predict-answer-key.docx" : "predict-test.docx", await makeDocx(flatten(el, style.choiceLayout === "inline", style.numStyle === "box"), m, {
          columns: style.columns,
          serif: style.font === "serif",
          exam: true,
          boxPassage: style.boxPassage,
        }),
      );
      setMsg({ text: "Word 저장 완료!" });
    } catch (e) {
      setMsg({ text: `Word 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setExporting(false);
    }
  }

  const previewItem = items.find((i) => i.id === previewId) ?? null;
  const set = <K extends keyof PredictOptions>(k: K, v: PredictOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <main>
      <Nav />
      <h1>{V.title}</h1>
      <p className="sub">{V.sub}</p>

      {SLOTS.map((s, n) => {
        const mine = items.filter((i) => i.role === s.role);
        return (
          <div className="card" key={s.role}>
            <div className="slot-h">
              <b>
                {n + 1}. {s.icon} {s.label}
              </b>
              {s.required ? <span className="req">필수</span> : <span className="opt">선택</span>}
            </div>
            <label className="drop sm">
              <input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={(e) => onPick(s.role, e)} />
              <span>{mine.length ? "➕ 더 추가" : s.desc}</span>
            </label>
            {mine.length > 0 && (
              <ol className="files">
                {mine.map((it) => (
                  <li key={it.id}>
                    <button className="open" aria-label={`${it.file.name} 미리보기`} onClick={() => setPreviewId(it.id)}>
                      {it.file.type === "application/pdf" ? <span className="pdfico">PDF</span> : <img src={it.url} alt="" />}
                      <span className="name">{it.file.name}</span>
                    </button>
                    <button aria-label="삭제" disabled={busy} onClick={() => removeItem(it.id)}>✕</button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}

      <div className="card">
        <div className="slot-h"><b>{SLOTS.length + 1}. ⚙️ 출제 옵션</b></div>
        <div className="opts">
          <label>
            시험지 제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="비우면 기출 시험지 제목 형식으로 자동" />
          </label>
          {variant === "hakpeu" ? (
            <div className="areas wide">
              <span>영역별 문항 수 (합계 {areaTotal}문항, 최대 40)</span>
              {AREAS.map((a) => (
                <label key={a}>
                  {a}
                  <select
                    value={opts.areas?.[a] ?? 0}
                    onChange={(e) => set("areas", { ...DEFAULT_AREAS, ...opts.areas, [a]: Number(e.target.value) })}
                  >
                    {Array.from({ length: 16 }, (_, n) => <option key={n} value={n}>{n}문항</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <>
              <label>
                문항 수
                <select value={opts.count} onChange={(e) => set("count", Number(e.target.value))}>
                  {[5, 10, 15, 20, 25, 30, 40].map((n) => <option key={n} value={n}>{n}문항</option>)}
                </select>
              </label>
              <label>
                객관식 비율
                <select value={opts.mcRatio} onChange={(e) => set("mcRatio", Number(e.target.value))}>
                  {[100, 80, 70, 60, 50, 0].map((n) => <option key={n} value={n}>{n === 0 ? "서술형만" : n === 100 ? "객관식만" : `객관식 ${n}%`}</option>)}
                </select>
              </label>
            </>
          )}
          <label>
            난이도
            <select value={opts.level} onChange={(e) => set("level", e.target.value as PredictOptions["level"])}>
              {(["기본", "중간", "상", "최상"] as const).map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="wide">
            추가 요청 (선택)
            <textarea
              rows={2}
              value={opts.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={variant === "hakpeu" ? "예: 관계대명사 어법 위주, 독해는 빈칸·순서 많이, 서술형은 조건 영작" : "예: 어법 문제 많이, 본문 3과 위주, 서술형은 조건 영작으로"}
            />
          </label>
        </div>
        <div className="row">
          <button className="p" disabled={!hasPrint || busy} onClick={generate}>
            {busy ? "만드는 중…" : html ? "🎯 다시 만들기" : "🎯 예상문제 뽑기"}
          </button>
        </div>
        {!hasPrint && <p className="hint">{V.needHint}</p>}
        <Progress value={prog.value} />
        <div className={"msg" + (msg.err ? " err" : "")}>{msg.text}</div>
      </div>

      <div ref={outRef} style={{ display: html === null ? "none" : "block" }}>
        <div className="card tabs">
          <div className="row" style={{ marginTop: 0 }}>
            <button className={mode === "test" ? "on" : ""} onClick={() => setMode("test")}>시험지</button>
            <button className={mode === "key" ? "on" : ""} onClick={() => setMode("key")}>답지·해설</button>
            <button disabled={exporting} onClick={() => pdf("test")}>⬇ 시험지 PDF</button>
            <button disabled={exporting} onClick={() => pdf("key")}>⬇ 답지 PDF</button>
            <button disabled={exporting} onClick={() => word("test")}>⬇ 시험지 Word</button>
            <button disabled={exporting} onClick={() => word("key")}>⬇ 답지 Word</button>
            <button disabled={exporting} onClick={print}>🖨 인쇄</button>
          </div>
          <div className="design">
            <span>🎨 시험지 디자인 (기출 시험지에서 읽어 옴)</span>
            <select value={style.columns} onChange={(e) => setStyle({ ...style, columns: Number(e.target.value) === 1 ? 1 : 2 })}>
              <option value={2}>2단</option>
              <option value={1}>1단</option>
            </select>
            <select value={style.font} onChange={(e) => setStyle({ ...style, font: e.target.value === "sans" ? "sans" : "serif" })}>
              <option value="serif">명조체</option>
              <option value="sans">고딕체</option>
            </select>
            <select value={style.choiceLayout} onChange={(e) => setStyle({ ...style, choiceLayout: e.target.value === "inline" ? "inline" : "vertical" })}>
              <option value="vertical">선택지 세로</option>
              <option value="inline">선택지 가로</option>
            </select>
            <select value={style.numStyle} onChange={(e) => setStyle({ ...style, numStyle: e.target.value === "box" ? "box" : "dot" })}>
              <option value="dot">번호 1.</option>
              <option value="box">번호 네모</option>
            </select>
            <label>
              <input type="checkbox" checked={style.boxPassage} onChange={(e) => setStyle({ ...style, boxPassage: e.target.checked })} /> 지문 상자
            </label>
          </div>
          <div className="sub" style={{ margin: "8px 0 0", fontSize: 13 }}>
            AI가 만든 예상문제예요. 정답·해설을 한 번 확인해 주세요. 글자를 눌러 직접 고칠 수 있어요.
          </div>
        </div>
        <div className="scroller">
          <div ref={sheetRef} className={sheetClass(mode)} contentEditable suppressContentEditableWarning onBlur={relayout} />
        </div>
      </div>

      {previewItem && (
        <div className="pv" role="dialog" aria-modal="true" onClick={() => setPreviewId(null)}>
          <div className="pv-bar" onClick={(e) => e.stopPropagation()}>
            <span className="t">{previewItem.file.name}</span>
            {previewItem.file.type === "application/pdf" && (
              <a href={previewItem.url} target="_blank" rel="noreferrer">새 탭에서 열기</a>
            )}
            <button onClick={() => setPreviewId(null)}>닫기 ✕</button>
          </div>
          <div className="pv-body" onClick={(e) => e.stopPropagation()}>
            {previewItem.file.type === "application/pdf" ? (
              <iframe src={previewItem.url} title={previewItem.file.name} />
            ) : (
              <img src={previewItem.url} alt={previewItem.file.name} />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
