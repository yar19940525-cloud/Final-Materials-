"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Nav from "../nav";
import { useAuth } from "../auth-gate";
import { authFetch } from "@/lib/auth-client";
import { FEATURES, type Feature } from "@/lib/features";

const KRW = 1400; // 1달러 = 약 1,400원 (표시용 어림)

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "blocked";
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
  month: { jobs: number; requests: number; cost: number };
}
interface LogRow {
  id: number;
  job_id: string;
  user_id: string;
  user: { email: string; name: string | null } | null;
  feature: Feature;
  label: string | null;
  files: { name: string; size: number; type: string; key: string | null }[];
  file_count: number;
  file_bytes: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: "running" | "done" | "failed";
  error: string | null;
  result_key: string | null;
  created_at: string;
  finished_at: string | null;
}
interface Stats {
  month: string;
  total: { jobs: number; requests: number; inputTokens: number; outputTokens: number; cost: number; failed: number };
  byUser: { user_id: string; email: string; name: string | null; jobs: number; cost: number; byFeature: Record<string, number> }[];
  byFeature: { feature: string; jobs: number; cost: number }[];
}

const kstMonth = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "-";
const fmtDay = (s: string | null) => (s ? new Date(s).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "2-digit", month: "numeric", day: "numeric" }) : "-");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)} (≈${Math.round(n * KRW).toLocaleString()}원)`;
const bytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const featureName = (f: string) => FEATURES[f as Feature] ?? f;
const STATUS_LABEL = { pending: "승인 대기", approved: "승인됨", blocked: "차단됨" } as const;
const JOB_LABEL = { running: "진행 중/미완료", done: "완료", failed: "실패" } as const;

// 관리자가 본 결과물(HTML)을 보여 줄 때 쓰는 최소 스타일. 아래 iframe은 스크립트를 실행하지 못하는 샌드박스다.
const RESULT_CSS = `body{font:14px/1.7 -apple-system,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif;margin:16px;color:#111}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#ddd}
.bar{background:#333;color:#fff;padding:3px 10px;margin:10px 0;font-weight:700}h2{font-size:16px}.xt{text-align:center;font-size:20px;font-weight:800}
.bx{border:1px solid #888;padding:6px 10px;margin:0}.qn{margin:16px 0 4px}.ch{margin:2px 0 2px 1.2em}.ans{color:#e00;font-weight:700}
.exp{background:#fff4f4;border-left:3px solid #e00;padding:4px 8px}.src{color:#2f5bea;font-size:12px}.f,.a,.k{color:#e00;font-weight:700;border-bottom:1px solid #e00}
.pagebreak{border-top:2px dashed #bbb;margin:18px 0}.wr{border-bottom:1px solid #999;height:24px}img{max-width:100%}.fail{color:#c00}`;

function Badge({ s }: { s: UserRow["status"] }) {
  return <span className={"adm-badge " + s}>{STATUS_LABEL[s]}</span>;
}

export default function Admin() {
  const auth = useAuth();
  const isAdmin = auth?.me?.role === "admin";
  const [tab, setTab] = useState<"users" | "logs" | "stats">("users");
  const [month, setMonth] = useState(kstMonth());
  const [err, setErr] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [fUser, setFUser] = useState("");
  const [fFeature, setFFeature] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<{ title: string; kind: "html" | "text"; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
    const res = await authFetch(url, init);
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(j?.error ?? `서버 오류 (${res.status})`);
      return null;
    }
    setErr("");
    return j as T;
  }

  const loadUsers = useCallback(async () => {
    const j = await call<{ users: UserRow[] }>(`/api/admin/users?month=${month}`);
    if (j) setUsers(j.users);
  }, [month]);

  const loadLogs = useCallback(
    async (append = false, offset = 0) => {
      const q = new URLSearchParams({ month, limit: "30", offset: String(offset) });
      if (fUser) q.set("user", fUser);
      if (fFeature) q.set("feature", fFeature);
      const j = await call<{ logs: LogRow[]; hasMore: boolean }>(`/api/admin/logs?${q}`);
      if (!j) return;
      setLogs((cur) => (append ? [...cur, ...j.logs] : j.logs));
      setHasMore(j.hasMore);
    },
    [month, fUser, fFeature],
  );

  const loadStats = useCallback(async () => {
    const j = await call<Stats>(`/api/admin/stats?month=${month}`);
    if (j) setStats(j);
  }, [month]);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "users") loadUsers();
    if (tab === "logs") {
      loadUsers(); // 사용자 거르기 목록용
      loadLogs();
    }
    if (tab === "stats") loadStats();
  }, [isAdmin, tab, loadUsers, loadLogs, loadStats]);

  async function setStatus(u: UserRow, status: "approved" | "blocked" | "pending") {
    setBusy(true);
    await call("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, status }) });
    await loadUsers();
    await auth?.refresh(); // 메뉴의 "승인 대기 n명" 표시 갱신
    setBusy(false);
  }

  async function removeUser(u: UserRow) {
    if (!confirm(`${u.name || u.email} (${u.email}) 계정을 삭제할까요?\n\n로그인 계정, 사용 기록, 저장된 문서가 모두 지워지고 되돌릴 수 없어요.`)) return;
    setBusy(true);
    const j = await call<{ deletedJobs: number; deletedFiles: number }>(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    if (j) alert(`삭제했어요. (작업 기록 ${j.deletedJobs}건, 저장 파일 ${j.deletedFiles}개)`);
    await loadUsers();
    await auth?.refresh();
    setBusy(false);
  }

  // 저장된 문서 열기: 결과물(HTML·글)은 화면에 띄우고, PDF·사진은 새 탭, 그 밖은 내려받기
  async function openFile(key: string, name: string, title: string) {
    const isResult = /\/result\.(html|txt)$/.test(key);
    const win = isResult ? null : window.open("", "_blank"); // 팝업 차단을 피하려고 클릭 순간에 먼저 연다
    const res = await authFetch(`/api/admin/file?key=${encodeURIComponent(key)}`);
    if (!res.ok) {
      win?.close();
      setErr((await res.json().catch(() => null))?.error ?? "파일을 열지 못했어요.");
      return;
    }
    if (isResult) {
      setView({ title, kind: key.endsWith(".txt") ? "text" : "html", content: await res.text() });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (/^(application\/pdf|image\/)/.test(blob.type) && win) win.location.href = url;
    else {
      win?.close();
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  if (!auth) return null;
  if (!isAdmin)
    return (
      <main>
        <Nav />
        <div className="card"><p>관리자만 볼 수 있는 화면이에요.</p></div>
      </main>
    );

  return (
    <main className="adm">
      <Nav />
      <h1>🛠 관리자</h1>
      <div className="card tabs">
        <div className="row" style={{ marginTop: 0, alignItems: "center" }}>
          <button className={tab === "users" ? "on" : ""} onClick={() => setTab("users")}>👥 사용자</button>
          <button className={tab === "logs" ? "on" : ""} onClick={() => setTab("logs")}>🧾 사용 기록</button>
          <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>📈 통계</button>
          <label className="adm-month">
            월 <input type="month" value={month} max={kstMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
      </div>
      {err && <div className="card"><p className="msg err" style={{ margin: 0 }}>{err}</p></div>}

      {tab === "users" && (
        <div className="card scroller">
          <table className="adm-table">
            <thead>
              <tr><th>사용자</th><th>상태</th><th>가입일</th><th>마지막 접속</th><th>{month} 사용</th><th>관리</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.status === "pending" ? "pend" : ""}>
                  <td>
                    <b>{u.name || u.email}</b>
                    {u.role === "admin" && <span className="adm-badge admin">관리자</span>}
                    <div className="hint">{u.email}</div>
                  </td>
                  <td><Badge s={u.status} /></td>
                  <td>{fmtDay(u.created_at)}</td>
                  <td>{fmtDate(u.last_seen_at)}</td>
                  <td>{u.month.jobs}건 · {usd(u.month.cost)}</td>
                  <td className="adm-act">
                    {u.role === "admin" ? (
                      <span className="hint">-</span>
                    ) : (
                      <>
                        {u.status !== "approved" && <button className="p" disabled={busy} onClick={() => setStatus(u, "approved")}>승인</button>}
                        {u.status === "approved" && <button disabled={busy} onClick={() => setStatus(u, "blocked")}>차단</button>}
                        {u.status === "pending" && <button disabled={busy} onClick={() => setStatus(u, "blocked")}>거절</button>}
                        <button className="danger" disabled={busy} onClick={() => removeUser(u)}>삭제</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={6} className="hint">아직 로그인한 사람이 없어요.</td></tr>}
            </tbody>
          </table>
          <p className="hint">차단하면 로그인은 되지만 아무 기능도 쓸 수 없어요. 삭제하면 계정·기록·저장된 문서가 모두 지워지고, 그 사람이 다시 로그인하면 새로 승인 대기가 돼요.</p>
        </div>
      )}

      {tab === "logs" && (
        <>
          <div className="card">
            <div className="opts">
              <label>
                사용자
                <select value={fUser} onChange={(e) => setFUser(e.target.value)}>
                  <option value="">전체</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </label>
              <label>
                기능
                <select value={fFeature} onChange={(e) => setFFeature(e.target.value)}>
                  <option value="">전체</option>
                  {Object.entries(FEATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="card scroller">
            <table className="adm-table">
              <thead>
                <tr><th>시간</th><th>사용자</th><th>기능</th><th>문서</th><th>AI 호출</th><th>추정 요금</th><th>상태</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="adm-click" onClick={() => setOpen(open === l.id ? null : l.id)}>
                      <td>{fmtDate(l.created_at)}</td>
                      <td>{l.user?.name || l.user?.email || "(삭제됨)"}</td>
                      <td>{featureName(l.feature)}</td>
                      <td className="adm-doc">{l.label || "-"}{l.file_count > 0 && <span className="hint"> ({l.file_count}개, {bytes(l.file_bytes)})</span>}</td>
                      <td>{l.request_count}회</td>
                      <td>{usd(Number(l.cost_usd))}</td>
                      <td><span className={"adm-job " + l.status}>{JOB_LABEL[l.status]}</span></td>
                    </tr>
                    {open === l.id && (
                      <tr className="adm-detail">
                        <td colSpan={7}>
                          <div className="adm-files">
                            <b>올린 문서</b>
                            {l.files.length ? (
                              l.files.map((f, i) => (
                                <span key={i} className="adm-file">
                                  {f.name} <span className="hint">({bytes(f.size)})</span>
                                  {f.key ? <button onClick={() => openFile(f.key!, f.name, f.name)}>열기</button> : <span className="hint"> 저장 안 됨</span>}
                                </span>
                              ))
                            ) : (
                              <span className="hint">없음</span>
                            )}
                          </div>
                          <div className="adm-files">
                            <b>결과물</b>
                            {l.result_key ? (
                              <button onClick={() => openFile(l.result_key!, "result", `${featureName(l.feature)} 결과 — ${l.label ?? ""}`)}>결과 보기</button>
                            ) : (
                              <span className="hint">저장된 결과가 없어요</span>
                            )}
                          </div>
                          <div className="hint">
                            토큰 입력 {Number(l.input_tokens).toLocaleString()} · 출력 {Number(l.output_tokens).toLocaleString()} · 끝난 시각 {fmtDate(l.finished_at)}
                            {l.error && <> · <span style={{ color: "#d33" }}>{l.error}</span></>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!logs.length && <tr><td colSpan={7} className="hint">이 달에는 사용 기록이 없어요.</td></tr>}
              </tbody>
            </table>
            {hasMore && <div className="row"><button onClick={() => loadLogs(true, logs.length)}>더 보기</button></div>}
          </div>
        </>
      )}

      {tab === "stats" && stats && (
        <>
          <div className="card">
            <div className="adm-cards">
              <div><span>작업</span><b>{stats.total.jobs}건</b></div>
              <div><span>AI 호출</span><b>{stats.total.requests}회</b></div>
              <div><span>추정 요금</span><b>{usd(stats.total.cost)}</b></div>
              <div><span>실패</span><b>{stats.total.failed}건</b></div>
            </div>
            <p className="hint">요금은 토큰 사용량으로 계산한 추정치예요. 정확한 금액은 Anthropic Console의 Usage에서 확인하세요.</p>
          </div>
          <div className="card scroller">
            <b>사용자별 ({stats.month})</b>
            <table className="adm-table">
              <thead>
                <tr><th>사용자</th>{Object.values(FEATURES).map((n) => <th key={n}>{n}</th>)}<th>합계</th><th>추정 요금</th></tr>
              </thead>
              <tbody>
                {stats.byUser.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.name || u.email}<div className="hint">{u.email}</div></td>
                    {Object.keys(FEATURES).map((k) => <td key={k}>{u.byFeature[k] ?? 0}</td>)}
                    <td><b>{u.jobs}</b></td>
                    <td>{usd(u.cost)}</td>
                  </tr>
                ))}
                {!stats.byUser.length && <tr><td colSpan={10} className="hint">이 달에는 사용 기록이 없어요.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card scroller">
            <b>기능별</b>
            <table className="adm-table">
              <thead><tr><th>기능</th><th>작업 수</th><th>추정 요금</th></tr></thead>
              <tbody>
                {stats.byFeature.map((f) => <tr key={f.feature}><td>{featureName(f.feature)}</td><td>{f.jobs}건</td><td>{usd(f.cost)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view && (
        <div className="pv" role="dialog" aria-modal="true" onClick={() => setView(null)}>
          <div className="pv-bar" onClick={(e) => e.stopPropagation()}>
            <span className="t">{view.title}</span>
            <button onClick={() => setView(null)}>닫기 ✕</button>
          </div>
          <div className="pv-body" onClick={(e) => e.stopPropagation()}>
            {view.kind === "text" ? (
              <pre className="adm-pre">{view.content}</pre>
            ) : (
              // 올린 사람이 만든 HTML이므로 스크립트가 실행되지 않는 샌드박스에서만 보여 준다
              <iframe sandbox="" title={view.title} srcDoc={`<!doctype html><meta charset="utf-8"><style>${RESULT_CSS}</style>${view.content}`} />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
