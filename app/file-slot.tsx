"use client";

import { useEffect, useRef, useState } from "react";

export interface SlotFile {
  id: number;
  role: string;
  file: File;
  url: string; // 미리보기용 blob 주소
}
let nextId = 1;

// 파일 목록 상태 (여러 칸이 한 목록을 같이 쓴다). 화면을 떠날 때 미리보기 주소를 정리한다.
export function useSlotFiles(max = 30) {
  const [files, setFiles] = useState<SlotFile[]>([]);
  const [note, setNote] = useState("");
  const ref = useRef(files);
  ref.current = files;
  useEffect(() => () => ref.current.forEach((f) => URL.revokeObjectURL(f.url)), []);
  const add = (role: string, picked: File[]) => {
    const ok = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    const room = Math.max(0, max - files.length);
    const added = ok.slice(0, room).map((file) => ({ id: nextId++, role, file, url: URL.createObjectURL(file) }));
    setFiles((cur) => [...cur, ...added]);
    const notes: string[] = [];
    if (ok.length < picked.length) notes.push("사진·PDF가 아닌 파일은 제외했어요.");
    if (ok.length > added.length) notes.push(`전체 최대 ${max}개까지만 올릴 수 있어요.`);
    setNote(notes.join(" "));
  };
  const remove = (id: number) =>
    setFiles((cur) => {
      const gone = cur.find((f) => f.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((f) => f.id !== id);
    });
  return { files, add, remove, note };
}

// 파일 올리는 칸 하나 (제목·필수/선택 표시·파일 목록·미리보기)
export function FileSlot(props: {
  no: number;
  icon: string;
  title: string;
  desc: string;
  role: string;
  required?: boolean;
  disabled?: boolean;
  slot: ReturnType<typeof useSlotFiles>;
}) {
  const { slot, role } = props;
  const mine = slot.files.filter((f) => f.role === role);
  const [preview, setPreview] = useState<SlotFile | null>(null);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);
  return (
    <div className="card">
      <div className="slot-h">
        <b>
          {props.no}. {props.icon} {props.title}
        </b>
        {props.required ? <span className="req">필수</span> : <span className="opt">선택</span>}
      </div>
      <label className="drop sm">
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          disabled={props.disabled}
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            if (picked.length) slot.add(role, picked);
          }}
        />
        <span>{mine.length ? "➕ 더 추가" : props.desc}</span>
      </label>
      {mine.length > 0 && (
        <ol className="files">
          {mine.map((it) => (
            <li key={it.id}>
              <button className="open" aria-label={`${it.file.name} 미리보기`} onClick={() => setPreview(it)}>
                {it.file.type === "application/pdf" ? <span className="pdfico">PDF</span> : <img src={it.url} alt="" />}
                <span className="name">{it.file.name}</span>
              </button>
              <button aria-label="삭제" disabled={props.disabled} onClick={() => slot.remove(it.id)}>✕</button>
            </li>
          ))}
        </ol>
      )}
      {preview && (
        <div className="pv" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="pv-bar" onClick={(e) => e.stopPropagation()}>
            <span className="t">{preview.file.name}</span>
            {preview.file.type === "application/pdf" && (
              <a href={preview.url} target="_blank" rel="noreferrer">새 탭에서 열기</a>
            )}
            <button onClick={() => setPreview(null)}>닫기 ✕</button>
          </div>
          <div className="pv-body" onClick={(e) => e.stopPropagation()}>
            {preview.file.type === "application/pdf" ? (
              <iframe src={preview.url} title={preview.file.name} />
            ) : (
              <img src={preview.url} alt={preview.file.name} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
