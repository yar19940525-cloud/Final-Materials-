"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { download, makePdf } from "@/lib/client";
import { makeDocx } from "@/lib/docx";
import { assemble, makePlan, prepare, writeQuestions } from "@/lib/predict";
import { ROLE_LABEL, type PredictOptions, type Role } from "@/lib/predict-prompt";

type Mode = "test" | "key";
interface Item {
  id: number;
  role: Role;
  file: File;
  url: string;
}
const MAX_FILES = 30;
let nextId = 1;

const SLOTS: { role: Role; icon: string; desc: string; required?: boolean }[] = [
  { role: "analysis", icon: "📊", desc: "선생님 출제 경향을 정리한 기출분석 파일 (PDF·사진)" },
  { role: "past", icon: "📚", desc: "이 학교 지난 시험지 (PDF·사진, 여러 개 가능)" },
  { role: "print", icon: "📄", desc: "이번 시험 범위 학교 프린트 (PDF·사진) — 필수", required: true },
];

export default function Predict() {
  const [items, setItems] = useState<Item[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [opts, setOpts] = useState<PredictOptions>({ count: 20, mcRatio: 70, level: "중간", note: "" });
  const [title, setTitle] = useState("예상문제");
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("test");
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

  // 직접 고친 내용을 지키기 위해 새 결과가 올 때만 innerHTML을 넣는다.
  useEffect(() => {
    if (html !== null && sheetRef.current) {
      sheetRef.current.innerHTML = html;
      outRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [html]);

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

  const hasPrint = items.some((i) => i.role === "print");

  async function generate() {
    if (!hasPrint || busy) return;
    setBusy(true);
    setMsg({ text: "파일을 준비하는 중…" });
    const t0 = Date.now();
    const sec = () => Math.round((Date.now() - t0) / 1000);
    try {
      const files = await prepare(items.map((i) => ({ role: i.role, file: i.file })));
      setMsg({ text: "1단계: 기출 경향을 분석하고 출제 계획을 세우는 중… (1~2분)" });
      const plan = await makePlan(files, opts, (n) =>
        setMsg({ text: `1단계: 기출 경향 분석·출제 계획 중… (${n.toLocaleString()}자, ${sec()}초)` }),
      );
      setMsg({ text: `2단계: ${plan.items.length}문항을 만드는 중…` });
      const { html: qs, failed } = await writeQuestions(files, opts, plan.items, (done, total, chars) =>
        setMsg({ text: `2단계: 문제 만드는 중… ${done}/${total} 묶음 완료 (${chars.toLocaleString()}자, ${sec()}초)` }),
      );
      setMode("test");
      setHtml(assemble(title.trim() || "예상문제", plan, qs));
      setMsg(
        failed
          ? { text: `일부 실패: ⚠ 표시된 문항 묶음을 못 만들었어요. 다시 만들어 보세요.`, err: true }
          : { text: `완료! ${plan.items.length}문항 (${sec()}초). 답지 탭에서 정답·해설·출제 근거를 확인하세요.` },
      );
    } catch (e) {
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e} 다시 시도해 주세요.`, err: true });
    } finally {
      setBusy(false);
    }
  }

  async function pdf(m: Mode) {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "PDF 만드는 중…" });
    const prev = el.className;
    try {
      el.className = "sheet pq " + m;
      download(m === "key" ? "predict-answer-key.pdf" : "predict-test.pdf", await makePdf(el));
      setMsg({ text: "PDF 저장 완료!" });
    } catch (e) {
      setMsg({ text: `PDF 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      el.className = prev;
      setExporting(false);
    }
  }

  async function word(m: Mode) {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "Word 파일 만드는 중…" });
    try {
      download(m === "key" ? "predict-answer-key.docx" : "predict-test.docx", await makeDocx(el, m));
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
      <nav className="nav">
        <Link href="/">📄 시험지·답지 변환</Link>
        <Link href="/predict" className="on">🎯 예상문제 만들기</Link>
      </nav>
      <h1>🎯 내신 예상문제 생성기</h1>
      <p className="sub">기출분석·기출문제로 우리 학교 출제 경향을 파악하고, 학교 프린트 내용으로 예상문제를 쫙 뽑아 줍니다.</p>

      {SLOTS.map((s, n) => {
        const mine = items.filter((i) => i.role === s.role);
        return (
          <div className="card" key={s.role}>
            <div className="slot-h">
              <b>
                {n + 1}. {s.icon} {ROLE_LABEL[s.role]}
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
        <div className="slot-h"><b>4. ⚙️ 출제 옵션</b></div>
        <div className="opts">
          <label>
            시험지 제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2학기 중간고사 영어 예상문제" />
          </label>
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
              placeholder="예: 어법 문제 많이, 본문 3과 위주, 서술형은 조건 영작으로"
            />
          </label>
        </div>
        <div className="row">
          <button className="p" disabled={!hasPrint || busy} onClick={generate}>
            {busy ? "만드는 중…" : html ? "🎯 다시 만들기" : "🎯 예상문제 뽑기"}
          </button>
        </div>
        {!hasPrint && <p className="hint">학교 프린트를 올리면 시작할 수 있어요. 기출분석·기출문제가 많을수록 우리 학교 스타일에 가까워져요.</p>}
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
            <button onClick={() => window.print()}>🖨 인쇄</button>
          </div>
          <div className="sub" style={{ margin: "8px 0 0", fontSize: 13 }}>
            AI가 만든 예상문제예요. 정답·해설을 한 번 확인해 주세요. 글자를 눌러 직접 고칠 수 있어요.
          </div>
        </div>
        <div className="scroller">
          <div ref={sheetRef} className={"sheet pq " + mode} contentEditable suppressContentEditableWarning />
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
