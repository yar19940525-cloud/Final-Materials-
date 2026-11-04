import { guard } from "@/lib/http";
import { authenticate } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 로그인한 사람의 정보와 승인 상태. 화면이 "승인 대기 중" 안내를 띄울지 정하는 데 쓴다.
export async function GET(req: Request) {
  return guard(async () => {
    const { profile, sb } = await authenticate(req);

    // 마지막 접속 시각 (10분에 한 번만 갱신)
    const last = profile.last_seen_at ? Date.parse(profile.last_seen_at) : 0;
    if (Date.now() - last > 10 * 60 * 1000) {
      await sb.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", profile.id);
    }

    let pendingCount = 0;
    if (profile.role === "admin" && profile.status === "approved") {
      const { data } = await sb.from("profiles").select("id").eq("status", "pending");
      pendingCount = data?.length ?? 0;
    }
    const { id, email, name, avatar_url, role, status } = profile;
    return Response.json({ id, email, name, avatar_url, role, status, pendingCount }, { headers: { "Cache-Control": "no-store" } });
  });
}
