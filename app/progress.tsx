"use client";

import { useEffect, useState } from "react";
import { byTime, pct } from "@/lib/progress";

// 진행률 상태: start() → set(0~1 어림값, 줄어들지 않음) → stop().
// AI가 글을 쓰기 전(생각하는 동안)에도 시간에 따라 조금씩 올라가도록 0.5초마다 다시 그린다.
export function useProgress(timeMax = 0.1) {
  const [state, setState] = useState<{ t0: number; frac: number } | null>(null);
  const [, tick] = useState(0);
  const active = state !== null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [active]);
  return {
    value: state ? pct(Math.max(state.frac, byTime(Date.now() - state.t0, timeMax))) : null,
    start: () => setState({ t0: Date.now(), frac: 0 }),
    set: (frac: number) => setState((s) => (s ? { ...s, frac: Math.max(s.frac, frac) } : s)),
    stop: () => setState(null),
  };
}

// 자료를 만드는 동안 보이는 진행 막대 (%)
export default function Progress({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="prog" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="prog-bar" style={{ width: `${value}%` }} />
      <span className="prog-txt">{value}% 진행 중</span>
    </div>
  );
}
