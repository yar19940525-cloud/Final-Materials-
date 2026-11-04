"use client";

import Nav from "./nav";
import Progress, { useProgress } from "./progress";
import { useEffect, useRef, useState } from "react";
import { download, makePdf, shrink } from "@/lib/client";
import { finishJob, jobLabel, newJobId, startJob } from "@/lib/jobs";
import { buildUnits, convertUnits, countPages, MAX_TOTAL_PAGES } from "@/lib/convert";
import { layoutMatches } from "@/lib/match";
import { makeDocx } from "@/lib/docx";

type Mode = "test" | "key";

interface Item {
  id: number;
  file: File;
  url: string; // 미리보기용 blob 주소 (사진·PDF 모두)
}
const MAX_FILES = 10;
let nextId = 1;

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const prog = useProgress();
  const [pdfBusy, setPdfBusy] = useState(false);
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

  // 직접 수정한 내용을 지키기 위해 innerHTML은 새 결과가 올 때만 넣는다.
  useEffect(() => {
    if (html !== null && sheetRef.current) {
      const sheet = sheetRef.current;
      sheet.innerHTML = html;
      layoutMatches(sheet);
      document.fonts?.ready.then(() => layoutMatches(sheet));
      outRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [html]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = ""; // 같은 파일을 다시 골라도 반응하도록
    if (!picked.length) return;
    const ok = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    const room = MAX_FILES - items.length;
    const added = ok.slice(0, Math.max(room, 0)).map<Item>((file) => ({
      id: nextId++,
      file,
      url: URL.createObjectURL(file),
    }));
    setItems((cur) => [...cur, ...added]);
    const notes: string[] = [];
    if (ok.length < picked.length) notes.push("사진·PDF가 아닌 파일은 제외했어요.");
    if (ok.length > added.length) notes.push(`한 번에 최대 ${MAX_FILES}개까지만 올릴 수 있어요.`);
    setMsg({ text: notes.join(" ") });
  }

  function removeItem(id: number) {
    setItems((cur) => {
      const gone = cur.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((i) => i.id !== id);
    });
  }

  async function convert() {
    if (!items.length) return;
    setBusy(true);
    prog.start();
    setMsg({ text: "파일을 준비하는 중…" });
    // 관리자 기록용: 올린 문서를 보관하고 작업 기록을 남긴다 (사진은 줄여서). 실패해도 변환은 계속된다.
    const jobId = newJobId();
    const started = (async () =>
      startJob({
        jobId,
        feature: "convert",
        label: jobLabel(items.map((i) => i.file.name)),
        files: await Promise.all(items.map(async (i) => ({ name: i.file.name, blob: i.file.type === "application/pdf" ? i.file : await shrink(i.file) }))),
      }))();
    let outcome: { status: "done" | "failed"; error?: string; content?: string } = { status: "failed", error: "중단됨" };
    try {
      const units = await buildUnits(items.map((i) => i.file));
      const pages = countPages(units);
      if (pages > MAX_TOTAL_PAGES) throw new Error(`한 번에 최대 ${MAX_TOTAL_PAGES}페이지까지 변환할 수 있어요. (지금 ${pages}페이지)`);
      setMsg({ text: `총 ${pages}페이지를 ${units.length}개 조각으로 나눠 변환해요. 오래 걸리면 몇 분까지 걸려요.` });
      const t0 = Date.now();
      const { html, failed } = await convertUnits(units, (done, total, chars) => {
        const sec = Math.round((Date.now() - t0) / 1000);
        setMsg({ text: `변환 중… ${done}/${total} 조각 완료 (${chars.toLocaleString()}자 생성 중, ${sec}초)` });
        // 끝난 조각 + 진행 중인 조각(조각당 약 4,000자로 어림)
        const inflight = Math.min(3, total - done);
        prog.set((done + Math.min(inflight * 0.9, chars / 4000)) / total);
      }, jobId);
      setMode("test");
      setHtml(html);
      outcome = { status: "done", error: failed ? `${failed}개 조각 변환 실패` : undefined, content: html };
      setMsg(
        failed
          ? { text: `일부 변환 실패: ${units.length}개 중 ${failed}개 조각을 못 바꿨어요. 결과에서 ⚠ 표시된 부분만 다시 올려 주세요.`, err: true }
          : { text: "완료! 아래에서 시험지/답지를 확인하세요." },
      );
    } catch (e) {
      outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e} 다시 시도해 주세요.`, err: true });
    } finally {
      setBusy(false);
      prog.stop();
      await started;
      await finishJob({ jobId, feature: "convert", kind: "html", ...outcome });
    }
  }

  async function pdf(m: Mode) {
    const el = sheetRef.current;
    if (!el || pdfBusy) return;
    setPdfBusy(true);
    setMsg({ text: "PDF 만드는 중…" });
    const prev = el.className;
    try {
      el.className = "sheet " + m;
      const blob = await makePdf(el);
      // 일부 브라우저가 한글 파일명을 무시해서 영문 이름을 쓴다.
      download(m === "key" ? "answer-key.pdf" : "test-sheet.pdf", blob);
      setMsg({ text: "PDF 저장 완료!" });
    } catch (e) {
      setMsg({ text: `PDF 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      el.className = prev;
      setPdfBusy(false);
    }
  }

  async function word(m: Mode) {
    const el = sheetRef.current;
    if (!el || pdfBusy) return;
    setPdfBusy(true);
    setMsg({ text: "Word 파일 만드는 중…" });
    try {
      download(m === "key" ? "answer-key.docx" : "test-sheet.docx", await makeDocx(el, m));
      setMsg({ text: "Word 저장 완료!" });
    } catch (e) {
      setMsg({ text: `Word 실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setPdfBusy(false);
    }
  }

  const previewItem = items.find((i) => i.id === previewId) ?? null;

  return (
    <main>
      <Nav />
      <h1>📄 학습지 → 시험지·답지 변환기</h1>
      <p className="sub">
        학습지 사진을 올리면 필기·낙서는 지우고 깨끗한 시험지와, 정답이 빨간색으로 표시된 답지를 만들어 줍니다.
      </p>

      <div className="card">
        <label className="drop">
          <input type="file" accept="image/*,application/pdf" multiple hidden onChange={onPick} />
          <span>{items.length ? "➕ 사진·PDF 더 추가" : "📷 여기를 눌러 학습지 사진 또는 PDF 선택 (여러 개 가능)"}</span>
        </label>
        {items.length > 0 && (
          <ol className="files">
            {items.map((it) => (
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
        {items.length > 0 && <p className="hint">파일을 누르면 크게 볼 수 있어요. 사진·PDF 한 개가 결과 PDF의 한 페이지 이상을 차지해요.</p>}
        <div className="row">
          <button className="p" disabled={!items.length || busy} onClick={convert}>
            시험지 · 답지 만들기{items.length > 1 ? ` (${items.length}개 파일)` : ""}
          </button>
        </div>
        <Progress value={prog.value} />
        <div className={"msg" + (msg.err ? " err" : "")}>{msg.text}</div>
      </div>

      <div ref={outRef} style={{ display: html === null ? "none" : "block" }}>
        <div className="card tabs">
          <div className="row" style={{ marginTop: 0 }}>
            <button className={mode === "test" ? "on" : ""} onClick={() => setMode("test")}>시험지</button>
            <button className={mode === "key" ? "on" : ""} onClick={() => setMode("key")}>답지</button>
            <button disabled={pdfBusy} onClick={() => pdf("test")}>⬇ 시험지 PDF</button>
            <button disabled={pdfBusy} onClick={() => pdf("key")}>⬇ 답지 PDF</button>
            <button disabled={pdfBusy} onClick={() => word("test")}>⬇ 시험지 Word</button>
            <button disabled={pdfBusy} onClick={() => word("key")}>⬇ 답지 Word</button>
            <button onClick={() => window.print()}>🖨 인쇄</button>
          </div>
          <div className="sub" style={{ margin: "8px 0 0", fontSize: 13 }}>
            AI가 옮겨 적은 내용이라 정답과 오타를 한 번 확인해 주세요. 글자를 눌러 직접 고칠 수 있어요.
          </div>
        </div>
        <div className="scroller">
          <div
            ref={sheetRef}
            className={"sheet " + mode}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => layoutMatches(e.currentTarget)}
          />
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
