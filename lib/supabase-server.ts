// 서버 전용: Supabase 연결. 환경 변수는 요청 시점에만 보이므로 요청마다 만든다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";

// 브라우저에 알려 줘도 되는 값 (anon 키는 공개용). 빌드 때가 아니라 실행 때 읽는다.
export function publicConfig(): { supabaseUrl: string; supabaseAnonKey: string } | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  return supabaseUrl && supabaseAnonKey ? { supabaseUrl, supabaseAnonKey } : null;
}

// service_role 키로 만든 관리자 권한 연결 — 서버에서만 쓰고 절대 브라우저로 보내지 않는다.
export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError("서버에 로그인 설정(Supabase)이 아직 안 되어 있어요. 관리자에게 문의하세요.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
