import { fail, guard, HttpError } from "@/lib/http";
import { fetchAll, monthRange } from "@/lib/admin-data";
import { requireAdmin, type Profile } from "@/lib/server-auth";
import { deletePrefix, getBucket } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 사용자 목록 (이번 달 사용 횟수·추정 요금 포함)
export async function GET(req: Request) {
  return guard(async () => {
    const { sb } = await requireAdmin(req);
    const { month, start, end } = monthRange(new URL(req.url).searchParams.get("month"));
    const { data: users, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) throw new HttpError("사용자 목록을 불러오지 못했어요.", 500);
    const logs = await fetchAll<{ user_id: string; cost_usd: number; request_count: number }>((a, b) =>
      sb.from("usage_logs").select("user_id,cost_usd,request_count").gte("created_at", start).lt("created_at", end).order("id").range(a, b),
    );
    const agg = new Map<string, { jobs: number; requests: number; cost: number }>();
    for (const l of logs) {
      const x = agg.get(l.user_id) ?? { jobs: 0, requests: 0, cost: 0 };
      x.jobs += 1;
      x.requests += l.request_count;
      x.cost += Number(l.cost_usd);
      agg.set(l.user_id, x);
    }
    const rank = { pending: 0, approved: 1, blocked: 2 } as const;
    const list = (users as Profile[])
      .map((u) => ({ ...u, month: agg.get(u.id) ?? { jobs: 0, requests: 0, cost: 0 } }))
      .sort((a, b) => rank[a.status] - rank[b.status]);
    return Response.json({ month, users: list }, { headers: { "Cache-Control": "no-store" } });
  });
}

// 승인 / 차단 / 대기로 바꾸기
export async function PATCH(req: Request) {
  return guard(async () => {
    const { sb, profile: me } = await requireAdmin(req);
    const body = await req.json().catch(() => null);
    const status = body?.status;
    if (typeof body?.id !== "string" || !["approved", "blocked", "pending"].includes(status)) return fail("요청이 잘못됐어요.", 400);
    if (body.id === me.id) throw new HttpError("내 계정은 바꿀 수 없어요.", 400);
    const { data: target } = await sb.from("profiles").select("*").eq("id", body.id).maybeSingle();
    if (!target) throw new HttpError("사용자를 찾을 수 없어요.", 404);
    if (target.role === "admin") throw new HttpError("관리자 계정은 여기서 바꿀 수 없어요.", 400);
    const { error } = await sb
      .from("profiles")
      .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null })
      .eq("id", body.id);
    if (error) throw new HttpError("저장하지 못했어요.", 500);
    return Response.json({ ok: true });
  });
}

// 사용자 삭제: 로그인 계정 + 사용 기록 + 저장된 문서까지 모두 지운다.
export async function DELETE(req: Request) {
  return guard(async () => {
    const { sb, profile: me } = await requireAdmin(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!id) return fail("요청이 잘못됐어요.", 400);
    if (id === me.id) throw new HttpError("내 계정은 지울 수 없어요.", 400);
    const { data: target } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
    if (!target) throw new HttpError("사용자를 찾을 수 없어요.", 404);
    if (target.role === "admin") throw new HttpError("관리자 계정은 여기서 지울 수 없어요.", 400);

    const jobs = await fetchAll<{ job_id: string }>((a, b) => sb.from("usage_logs").select("job_id").eq("user_id", id).order("id").range(a, b));
    let deletedFiles = 0;
    const bucket = await getBucket();
    if (bucket) for (const j of jobs) deletedFiles += await deletePrefix(bucket, `jobs/${j.job_id}/`);

    const { error } = await sb.auth.admin.deleteUser(id); // profiles·usage_logs는 연쇄 삭제
    if (error) throw new HttpError("계정을 지우지 못했어요.", 500);
    return Response.json({ ok: true, deletedJobs: jobs.length, deletedFiles });
  });
}
