import { fail, guard, HttpError } from "@/lib/http";
import { monthRange } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/server-auth";
import { asFeature } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사용 기록 목록 (최신순). 사용자·기능·월로 거를 수 있다. limit+1개를 가져와 "더 있음"을 알려 준다.
export async function GET(req: Request) {
  return guard(async () => {
    const { sb } = await requireAdmin(req);
    const q = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 30));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const user = q.get("user");
    const feature = q.get("feature");
    if (feature && !asFeature(feature)) return fail("기능 값이 잘못됐어요.", 400);

    let query = sb.from("usage_logs").select("*").order("created_at", { ascending: false }).order("id", { ascending: false });
    if (user) query = query.eq("user_id", user);
    if (feature) query = query.eq("feature", feature);
    if (q.get("month") !== "all") {
      const { start, end } = monthRange(q.get("month"));
      query = query.gte("created_at", start).lt("created_at", end);
    }
    const { data, error } = await query.range(offset, offset + limit);
    if (error) throw new HttpError("사용 기록을 불러오지 못했어요.", 500);
    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const { data: people } = await sb.from("profiles").select("id,email,name");
    const byId = new Map((people ?? []).map((p) => [p.id as string, p]));
    return Response.json(
      { hasMore, logs: page.map((l) => ({ ...l, user: byId.get(l.user_id) ?? null })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
