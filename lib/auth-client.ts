// 브라우저 전용: 구글 로그인(Supabase)과 로그인 토큰이 붙은 서버 호출
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ConfigError extends Error {}

let clientPromise: Promise<SupabaseClient> | null = null;

// Supabase 접속 정보는 빌드 때가 아니라 서버(/api/config)에서 실행 때 받아 온다.
export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new ConfigError((await res.json().catch(() => null))?.error ?? "서버 설정을 불러오지 못했어요.");
      const { supabaseUrl, supabaseAnonKey } = await res.json();
      return createClient(supabaseUrl, supabaseAnonKey, {
        auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
    })();
    clientPromise.catch(() => {
      clientPromise = null; // 다음에 다시 시도할 수 있게
    });
  }
  return clientPromise;
}

export async function signInWithGoogle(): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/", queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const sb = await getSupabase();
  await sb.auth.signOut();
}

export async function getToken(): Promise<string | null> {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

// 로그인 토큰을 붙여 서버를 부른다. 토큰이 거부되면(401) 화면이 다시 로그인 상태를 확인하도록 알린다.
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) window.dispatchEvent(new Event("auth-expired"));
  return res;
}
