"use client";

import { useEffect, useState } from "react";
import Nav from "../nav";
import Progress, { useProgress } from "../progress";
import { byChars } from "@/lib/progress";
import { finishJob, jobLabel, newJobId, startJob } from "@/lib/jobs";
import { FileSlot, useSlotFiles } from "../file-slot";
import { prepareFiles, runAI } from "@/lib/ai-client";
import type { CheerOptions } from "@/lib/cheer-prompt";

const SAVE_KEY = "cheer-settings";
const DEFAULTS: CheerOptions = {
  school: "",
  subject: "영어",
  teacher: "아름쌤",
  linkTitle: "DYB 행운의 부적 받기",
  link: "https://drive.google.com/file/d/17RzZX5OU20pcuaqx8MS-G202y6CJqG0w/view?usp=sharing",
  note: "",
};

export default function Cheer() {
  const slot = useSlotFiles(10);
  const [opts, setOpts] = useState<CheerOptions>(DEFAULTS);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const prog = useProgress(0.15);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "" });

  // 학교·선생님·링크 같은 설정은 이 기기에 기억해 둔다
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
      if (saved) setOpts((o) => ({ ...o, ...saved, note: "" }));
    } catch {}
  }, []);
  const set = <K extends keyof CheerOptions>(k: K, v: CheerOptions[K]) =>
    setOpts((o) => {
      const n = { ...o, [k]: v };
      try {
        const { note: _, ...keep } = n;
        localStorage.setItem(SAVE_KEY, JSON.stringify(keep));
      } catch {}
      return n;
    });

  const hasNotes = slot.files.length > 0;

  async function generate() {
    if (!hasNotes || busy) return;
    setBusy(true);
    prog.start();
    setMsg({ text: "직보 자료를 읽고 응원 메시지를 쓰는 중…" });
    setText("");
    const jobId = newJobId();
    let started: Promise<void> = Promise.resolve();
    let outcome: { status: "done" | "failed"; error?: string; content?: string } = { status: "failed", error: "중단됨" };
    try {
      const files = await prepareFiles(slot.files.map((f) => ({ role: f.role, file: f.file })));
      // 관리자 기록용: 올린 직보 자료를 보관하고 작업 기록을 남긴다 (실패해도 계속)
      started = startJob({ jobId, feature: "cheer", label: jobLabel(files.map((f) => f.origName)), files: files.map((f) => ({ name: f.origName, blob: f.blob })) });
      const r = await runAI("/api/cheer", files, { options: JSON.stringify({ ...opts }), jobId }, (t) => {
        setText(t);
        prog.set(byChars(t.length, 1300)); // 응원 문자는 보통 1,000~1,500자
      });
      setText(r.text.trim());
      outcome = { status: "done", error: r.truncated ? "중간에 잘림" : undefined, content: r.text.trim() };
      setMsg(r.truncated ? { text: "중간에 끊겼어요. 다시 만들어 보세요.", err: true } : { text: "완료! 내용을 고친 뒤 📋 복사해서 보내세요." });
    } catch (e) {
      outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      setMsg({ text: `실패: ${e instanceof Error ? e.message : e}`, err: true });
    } finally {
      setBusy(false);
      prog.stop();
      await started;
      await finishJob({ jobId, feature: "cheer", kind: "text", ...outcome });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ text: "복사했어요! 카카오톡·문자에 붙여 넣으세요." });
    } catch {
      setMsg({ text: "복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요.", err: true });
    }
  }

  return (
    <main>
      <Nav />
      <h1>📣 시험 당일 응원 메시지</h1>
      <p className="sub">직보 자료를 넣으면 핵심 문법·중요 문장·포인트를 뽑아 아이들에게 보낼 응원 문자를 만들어 줍니다.</p>

      <FileSlot no={1} icon="📝" title="직보 자료" desc="직전 보강 자료 (PDF·사진, 여러 개 가능)" role="notes" required disabled={busy} slot={slot} />
      {slot.note && <p className="hint">{slot.note}</p>}

      <div className="card">
        <div className="slot-h"><b>2. ⚙️ 메시지 설정</b></div>
        <div className="opts">
          <label>
            학교 이름
            <input value={opts.school} onChange={(e) => set("school", e.target.value)} placeholder="예: 석우중 (비우면 자료에서)" />
          </label>
          <label>
            과목
            <input value={opts.subject} onChange={(e) => set("subject", e.target.value)} />
          </label>
          <label>
            선생님 호칭
            <input value={opts.teacher} onChange={(e) => set("teacher", e.target.value)} placeholder="예: 아름쌤" />
          </label>
          <label className="wide">
            마지막 링크 제목
            <input value={opts.linkTitle} onChange={(e) => set("linkTitle", e.target.value)} placeholder="예: DYB 행운의 부적 받기" />
          </label>
          <label className="wide">
            링크 주소 (비우면 링크 없이)
            <input value={opts.link} onChange={(e) => set("link", e.target.value)} placeholder="https://…" />
          </label>
          <label className="wide">
            추가 요청 (선택)
            <textarea rows={2} value={opts.note} onChange={(e) => set("note", e.target.value)} placeholder="예: 관계대명사 꼭 넣어 줘, 응원은 더 짧게" />
          </label>
        </div>
        <div className="row">
          <button className="p" disabled={!hasNotes || busy} onClick={generate}>
            {busy ? "만드는 중…" : text ? "📣 다시 만들기" : "📣 응원 메시지 만들기"}
          </button>
        </div>
        {!hasNotes && <p className="hint">직보 자료를 올리면 시작할 수 있어요.</p>}
        <Progress value={prog.value} />
        <div className={"msg" + (msg.err ? " err" : "")}>{msg.text}</div>
      </div>

      {(text || busy) && (
        <div className="card">
          <div className="row" style={{ marginTop: 0, alignItems: "center" }}>
            <b style={{ flex: 1 }}>✉️ 응원 메시지</b>
            <span className="hint" style={{ margin: 0 }}>{text.length.toLocaleString()}자</span>
            <button className="p" disabled={!text || busy} onClick={copy}>📋 복사</button>
          </div>
          <textarea className="cheer-out" value={text} onChange={(e) => setText(e.target.value)} readOnly={busy} />
          <p className="hint">글을 눌러 바로 고칠 수 있어요.</p>
        </div>
      )}
    </main>
  );
}
