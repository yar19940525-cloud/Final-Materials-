"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "../nav";
import { FileSlot, useSlotFiles } from "../file-slot";
import { prepareFiles, runAI } from "@/lib/ai-client";
import { clean, download, makePdf } from "@/lib/client";
import { makeDocx } from "@/lib/docx";
import { QUALITY_LABEL, type Quality } from "@/lib/predict-prompt";

export default function Analysis() {
  const slot = useSlotFiles(30);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [quality, setQuality] = useState<Quality>("standard");
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });
  const sheetRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  // 직접 고친 내용을 지키기 위해 새 결과가 올 때만 innerHTML을 넣는다.
  useEffect(() => {
    if (html !== null && sheetRef.current) {
      sheetRef.current.innerHTML = html;
      outRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [html]);

  const ready = slot.files.some((f) => f.role === "sample") && slot.files.some((f) => f.role === "exam");

  async function generate() {
    if (!ready || busy) return;
    setBusy(true);
    const t0 = Date.now();
    setMsg({ text: "파일을 준비하는 중…" });
    try {
      const files = await prepareFiles(slot.files.map((f) => ({ role: f.role, file: f.file })));
      setMsg({ text: "시험지를 분석하고 샘플 양식에 맞춰 쓰는 중… (몇 분 걸릴 수 있어요)" });
      const r = await runAI("/api/analysis", files, { options: JSON.stringify({ title: title.trim(), note: note.trim(), quality }) }, (t) =>
        setMsg({ text: `분석 자료 쓰는 중… (${t.length.toLocaleString()}자, ${Math.round((Date.now() - t0) / 1000)}초)` }),
      );
      setHtml(clean(r.text));
      setMsg(
        r.truncated
          ? { text: "내용이 길어 끝부분이 잘렸어요. 시험지 수를 줄여 다시 만들거나, 잘린 부분은 직접 채워 주세요.", err: true }
          : { text: `완료! (${Math.round((Date.now() - t0) / 1000)}초) 글자를 눌러 직접 고칠 수 있어요.` },
      );
    } catch (e) {
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setBusy(false);
    }
  }

  async function pdf() {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "PDF 만드는 중…" });
    try {
      download("exam-analysis.pdf", await makePdf(el));
      setMsg({ text: "PDF 저장 완료!" });
    } catch (e) {
      setMsg({ text: `PDF 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setExporting(false);
    }
  }

  async function word() {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "Word 파일 만드는 중…" });
    try {
      download("exam-analysis.docx", await makeDocx(el, "key"));
      setMsg({ text: "Word 저장 완료!" });
    } catch (e) {
      setMsg({ text: `Word 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setExporting(false);
    }
  }

  return (
    <main>
      <Nav />
      <h1>📊 기출분석 자료 제작</h1>
      <p className="sub">아이들의 학교 시험지와 우리 학원 기출분석 샘플을 넣으면, 샘플 양식 그대로 이번 시험의 기출분석 자료를 만들어 줍니다.</p>

      <FileSlot no={1} icon="🏫" title="학교 시험지" desc="분석할 학교 시험지 (PDF·사진, 여러 개 가능)" role="exam" required disabled={busy} slot={slot} />
      <FileSlot no={2} icon="📑" title="기출분석 샘플" desc="따라 할 기출분석 양식 (PDF·사진)" role="sample" required disabled={busy} slot={slot} />
      {slot.note && <p className="hint">{slot.note}</p>}

      <div className="card">
        <div className="slot-h"><b>3. ⚙️ 옵션</b></div>
        <div className="opts">
          <label className="wide">
            자료 제목 (선택)
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="비우면 샘플 형식대로 자동 (예: 2025 석우중 2학년 1학기 중간 영어 기출분석)" />
          </label>
          <label>
            품질 · 비용
            <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              {(["standard", "high", "saver"] as const).map((q) => (
                <option key={q} value={q}>{QUALITY_LABEL[q].replace(/ \(.*\)/, "")}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            추가 요청 (선택)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 서술형 분석을 더 자세히, 문항별 표에 출처(교과서 쪽수) 열 추가" />
          </label>
        </div>
        <div className="row">
          <button className="p" disabled={!ready || busy} onClick={generate}>
            {busy ? "분석 중…" : html ? "📊 다시 만들기" : "📊 기출분석 자료 만들기"}
          </button>
        </div>
        {!ready && <p className="hint">학교 시험지와 기출분석 샘플을 모두 올리면 시작할 수 있어요.</p>}
        <div className={"msg" + (msg.err ? " err" : "")}>{msg.text}</div>
      </div>

      <div ref={outRef} style={{ display: html === null ? "none" : "block" }}>
        <div className="card tabs">
          <div className="row" style={{ marginTop: 0 }}>
            <button disabled={exporting} onClick={pdf}>⬇ PDF</button>
            <button disabled={exporting} onClick={word}>⬇ Word</button>
            <button onClick={() => window.print()}>🖨 인쇄</button>
          </div>
          <div className="sub" style={{ margin: "8px 0 0", fontSize: 13 }}>
            AI가 만든 분석이에요. 정답·배점·수치를 한 번 확인해 주세요. 글자를 눌러 직접 고칠 수 있어요.
          </div>
        </div>
        <div className="scroller">
          <div ref={sheetRef} className="sheet key ana-doc" contentEditable suppressContentEditableWarning />
        </div>
      </div>
    </main>
  );
}
