// 서버 전용: 로그인한 사람이 누구인지, 승인된 사람인지, 관리자인지 확인한다.
// 브라우저는 "Authorization: Bearer <구글 로그인으로 받은 토큰>"을 보내고, 서버는 Supabase에 물어 진짜인지 확인한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
import { serviceClient } from "./supabase-server";

export type Status = "pending" | "approved" | "blocked";
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  status: Status;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
}
export interface Auth {
  profile: Profile;
  sb: SupabaseClient;
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// 로그인만 확인 (승인 여부는 보지 않음)
export async function authenticate(req: Request): Promise<Auth> {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new HttpError("로그인이 필요해요.", 401);
  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError("로그인이 만료됐어요. 다시 로그인해 주세요.", 401);
  const u = data.user;
  const email = (u.email ?? "").toLowerCase();

  let { data: profile } = await sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
  if (!profile) {
    // 가입 직후 자동 생성(트리거)이 늦었을 때를 대비해 직접 만든다
    const { data: created, error: e2 } = await sb
      .from("profiles")
      .upsert({ id: u.id, email, name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null, avatar_url: u.user_metadata?.avatar_url ?? null }, { onConflict: "id" })
      .select("*")
      .single();
    if (e2 || !created) throw new HttpError("사용자 정보를 만들지 못했어요.", 500);
    profile = created;
  }

  // 환경 변수 ADMIN_EMAILS에 적은 구글 계정(이메일 인증된)은 처음 로그인할 때 자동으로 관리자·승인 처리
  if (
    adminEmails().includes(email) &&
    u.email_confirmed_at &&
    u.app_metadata?.provider === "google" &&
    (profile.role !== "admin" || profile.status !== "approved")
  ) {
    const { data: promoted } = await sb
      .from("profiles")
      .update({ role: "admin", status: "approved", approved_at: new Date().toISOString() })
      .eq("id", u.id)
      .select("*")
      .single();
    if (promoted) profile = promoted;
  }
  return { profile: profile as Profile, sb };
}

// 승인된 사용자만 통과
export async function requireApproved(req: Request): Promise<Auth> {
  const a = await authenticate(req);
  if (a.profile.status === "pending") throw new HttpError("아직 승인되지 않았어요. 관리자가 승인하면 사용할 수 있어요.", 403);
  if (a.profile.status === "blocked") throw new HttpError("사용이 중지된 계정이에요. 관리자에게 문의하세요.", 403);
  return a;
}

// 관리자만 통과 (권한은 토큰이 아니라 데이터베이스 값으로 확인한다)
export async function requireAdmin(req: Request): Promise<Auth> {
  const a = await requireApproved(req);
  if (a.profile.role !== "admin") throw new HttpError("관리자만 볼 수 있어요.", 403);
  return a;
}
