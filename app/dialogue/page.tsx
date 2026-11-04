"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "../nav";
import Progress, { useProgress } from "../progress";
import { FileSlot, useSlotFiles } from "../file-slot";
import { prepareFiles, runAI } from "@/lib/ai-client";
import { clean, download, makePdf } from "@/lib/client";
import { makeDocx } from "@/lib/docx";
import type { BlankLevel } from "@/lib/dialogue-prompt";

type Mode = "test" | "key";
const CONCURRENCY = 3;
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export default function Dialogue() {
  const slot = useSlotFiles(30);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<BlankLevel>("보통");
  const [note, setNote] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("test");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });
  const prog = useProgress(0.1);
  const sheetRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  // 직접 고친 내용을 지키기 위해 새 결과가 올 때만 innerHTML을 넣는다.
  useEffect(() => {
    if (html !== null && sheetRef.current) {
      sheetRef.current.innerHTML = html;
      outRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [html]);

  const ready = slot.files.length > 0;

  async function generate() {
    if (!ready || busy) return;
    setBusy(true);
    prog.start();
    const t0 = Date.now();
    setMsg({ text: "사진을 준비하는 중…" });
    try {
      const files = await prepareFiles(slot.files.map((f) => ({ role: "dlg", file: f.file })));
      // 사진(파일) 한 장씩 따로 요청해 3장씩 동시에 처리하고, 올린 순서대로 이어 붙인다.
      const results: string[] = new Array(files.length);
      const live = new Map<number, number>();
      let next = 0, done = 0, failed = 0;
      const report = () => {
        const chars = [...live.values()].reduce((a, b) => a + b, 0);
        setMsg({ text: `대화문 빈칸 시험지 만드는 중… ${done}/${files.length}장 완료 (${chars.toLocaleString()}자, ${Math.round((Date.now() - t0) / 1000)}초)` });
        prog.set((done + Math.min(live.size * 0.9, chars / 2500)) / files.length); // 사진 1장당 약 2,500자로 어림
      };
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          live.set(i, 0);
          try {
            const r = await runAI("/api/dialogue", [files[i]], { options: JSON.stringify({ level, note: note.trim() }) }, (t) => {
              live.set(i, t.length);
              report();
            });
            results[i] = clean(r.text) + (r.truncated ? `<p class="fail">⚠ ${i + 1}번째 사진: 내용이 길어 끝부분이 잘렸어요.</p>` : "");
          } catch (e) {
            failed++;
            results[i] = `<p class="fail">⚠ ${i + 1}번째 사진 실패: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
          }
          live.delete(i);
          done++;
          report();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
      const head =
        `<p class="xt">${esc(title.trim() || "대표 대화문 빈칸 시험지")}</p>` +
        `<table class="hd"><tr><td>학년</td><td>반</td><td>번호</td><td>이름</td><td>점수</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>`;
      setMode("test");
      setHtml(head + results.join(""));
      const blanks = (results.join("").match(/class="f"/g) ?? []).length;
      setMsg(
        failed
          ? { text: `일부 실패: ⚠ 표시된 사진만 다시 올려 주세요.`, err: true }
          : { text: `완료! 빈칸 ${blanks}개 (${Math.round((Date.now() - t0) / 1000)}초). 답지 탭에서 정답을 확인하세요.` },
      );
    } catch (e) {
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setBusy(false);
      prog.stop();
    }
  }

  async function pdf(m: Mode) {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    setMsg({ text: "PDF 만드는 중…" });
    const prev = el.className;
    try {
      el.className = "sheet dlgs " + m;
      download(m === "key" ? "dialogue-answer-key.pdf" : "dialogue-test.pdf", await makePdf(el));
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
      download(m === "key" ? "dialogue-answer-key.docx" : "dialogue-test.docx", await makeDocx(el, m));
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
      <h1>💬 대표 대화문 빈칸 시험지</h1>
      <p className="sub">교과서 대화문 사진을 올리면 과마다 표시하고, 중요한 표현을 빈칸으로 뚫은 영어 + 우리말 시험지를 만들어 줍니다.</p>

      <FileSlot no={1} icon="💬" title="교과서 대화문" desc="대화문 사진 또는 PDF (과 번호가 보이게, 여러 장 가능)" role="dlg" required disabled={busy} slot={slot} />
      {slot.note && <p className="hint">{slot.note}</p>}

      <div className="card">
        <div className="slot-h"><b>2. ⚙️ 옵션</b></div>
        <div className="opts">
          <label className="wide">
            시험지 제목 (선택)
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2학년 1학기 중간 대표 대화문 빈칸 테스트 (비우면 기본 제목)" />
          </label>
          <label>
            빈칸 양
            <select value={level} onChange={(e) => setLevel(e.target.value as BlankLevel)}>
              <option value="적게">적게 (핵심 표현만)</option>
              <option value="보통">보통</option>
              <option value="많이">많이</option>
            </select>
          </label>
          <label className="wide">
            추가 요청 (선택)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 의사소통 기능 표현은 꼭 빈칸으로, 우리말 해석은 짧게" />
          </label>
        </div>
        <div className="row">
          <button className="p" disabled={!ready || busy} onClick={generate}>
            {busy ? "만드는 중…" : html ? "💬 다시 만들기" : "💬 대화문 빈칸 시험지 만들기"}
          </button>
        </div>
        {!ready && <p className="hint">대화문 사진을 올리면 시작할 수 있어요.</p>}
        <Progress value={prog.value} />
        <div className={"msg" + (msg.err ? " err" : "")}>{msg.text}</div>
      </div>

      <div ref={outRef} style={{ display: html === null ? "none" : "block" }}>
        <div className="card tabs">
          <div className="row" style={{ marginTop: 0 }}>
            <button className={mode === "test" ? "on" : ""} onClick={() => setMode("test")}>시험지</button>
            <button className={mode === "key" ? "on" : ""} onClick={() => setMode("key")}>답지</button>
            <button disabled={exporting} onClick={() => pdf("test")}>⬇ 시험지 PDF</button>
            <button disabled={exporting} onClick={() => pdf("key")}>⬇ 답지 PDF</button>
            <button disabled={exporting} onClick={() => word("test")}>⬇ 시험지 Word</button>
            <button disabled={exporting} onClick={() => word("key")}>⬇ 답지 Word</button>
            <button onClick={() => window.print()}>🖨 인쇄</button>
          </div>
          <div className="sub" style={{ margin: "8px 0 0", fontSize: 13 }}>
            AI가 옮겨 적은 내용이라 철자·과 번호를 한 번 확인해 주세요. 글자를 눌러 직접 고칠 수 있어요.
          </div>
        </div>
        <div className="scroller">
          <div ref={sheetRef} className={"sheet dlgs " + mode} contentEditable suppressContentEditableWarning />
        </div>
      </div>
    </main>
  );
}
