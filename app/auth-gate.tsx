"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConfigError, getSupabase, getToken, signInWithGoogle, signOut as doSignOut } from "@/lib/auth-client";

type State = "loading" | "signed-out" | "pending" | "blocked" | "approved" | "config-error" | "error";
export interface Me {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "blocked";
  pendingCount: number;
}
interface AuthCtx {
  me: Me | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx);

// 사이트 전체를 감싸는 문: 로그인하지 않았거나 승인되지 않은 사람에게는 안내 화면만 보여 준다.
// (진짜 차단은 서버가 한다: 모든 API가 로그인·승인을 다시 확인한다.)
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setMe(null);
        setState("signed-out");
        return;
      }
      // 여기서는 authFetch 대신 직접 부른다 (401이 다시 refresh를 부르는 반복을 막으려고)
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!alive.current) return;
      if (res.status === 401) {
        setMe(null);
        setState("signed-out");
        return;
      }
      if (!res.ok || !j) {
        setMsg(j?.error ?? `서버 오류 (${res.status})`);
        setState(res.status === 503 ? "config-error" : "error");
        return;
      }
      setMe(j);
      setState(j.status === "approved" ? "approved" : j.status === "blocked" ? "blocked" : "pending");
    } catch (e) {
      if (!alive.current) return;
      setMsg(e instanceof Error ? e.message : String(e));
      setState(e instanceof ConfigError ? "config-error" : "error");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    let unsub: (() => void) | undefined;
    getSupabase()
      .then((sb) => {
        const { data } = sb.auth.onAuthStateChange((ev) => {
          if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "USER_UPDATED") refresh();
        });
        unsub = () => data.subscription.unsubscribe();
      })
      .catch(() => {});
    const onExpired = () => refresh();
    window.addEventListener("auth-expired", onExpired);
    return () => {
      alive.current = false;
      unsub?.();
      window.removeEventListener("auth-expired", onExpired);
    };
  }, [refresh]);

  // 승인 대기 중이면 20초마다 확인해서, 관리자가 승인하면 자동으로 열리게 한다
  useEffect(() => {
    if (state !== "pending") return;
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [state, refresh]);

  const signOut = useCallback(async () => {
    await doSignOut();
    setMe(null);
    setState("signed-out");
  }, []);

  async function login() {
    setBusy(true);
    setMsg("");
    try {
      await signInWithGoogle(); // 구글 화면으로 이동한다
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (state === "approved") return <Ctx.Provider value={{ me, signOut, refresh }}>{children}</Ctx.Provider>;

  return (
    <main className="gate">
      <div className="card gate-card">
        <h1>📄 시험지·교재 자동 제작</h1>
        {state === "loading" && <p className="sub">불러오는 중…</p>}

        {state === "signed-out" && (
          <>
            <p className="sub">승인된 선생님만 사용할 수 있어요.<br />구글 계정으로 로그인한 뒤, 관리자가 승인하면 이용할 수 있어요.</p>
            <button className="p gbtn" disabled={busy} onClick={login}>
              {busy ? "구글로 이동 중…" : "🔐 Google로 로그인"}
            </button>
            {msg && <p className="msg err">{msg}</p>}
          </>
        )}

        {state === "pending" && (
          <>
            <p className="sub">
              <b>{me?.email}</b> 계정으로 로그인했어요.<br />
              관리자의 <b>승인을 기다리는 중</b>이에요. 승인되면 이 화면이 자동으로 열려요.
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={refresh}>승인 확인</button>
              <button onClick={signOut}>다른 계정으로 로그인</button>
            </div>
          </>
        )}

        {state === "blocked" && (
          <>
            <p className="sub"><b>{me?.email}</b> 계정은 사용이 중지되어 있어요.<br />필요하면 관리자에게 문의해 주세요.</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={signOut}>다른 계정으로 로그인</button>
            </div>
          </>
        )}

        {state === "config-error" && (
          <>
            <p className="sub">서버의 로그인 설정이 아직 끝나지 않았어요.</p>
            {msg && <p className="msg err">{msg}</p>}
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={() => location.reload()}>다시 시도</button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <p className="sub">잠시 문제가 생겼어요.</p>
            {msg && <p className="msg err">{msg}</p>}
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={() => location.reload()}>다시 시도</button>
              <button onClick={signOut}>로그아웃</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
