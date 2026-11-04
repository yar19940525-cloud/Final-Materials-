import { guard } from "@/lib/http";
import { fetchAll, monthRange } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  user_id: string;
  feature: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: string;
}

interface UserStat {
  user_id: string;
  email: string;
  name: string | null;
  jobs: number;
  cost: number;
  byFeature: Record<string, number>;
}

// 월별 통계: 전체 합계, 사용자별(기능별 횟수), 기능별
export async function GET(req: Request) {
  return guard(async () => {
    const { sb } = await requireAdmin(req);
    const { month, start, end } = monthRange(new URL(req.url).searchParams.get("month"));
    const rows = await fetchAll<Row>((a, b) =>
      sb.from("usage_logs").select("user_id,feature,request_count,input_tokens,output_tokens,cost_usd,status").gte("created_at", start).lt("created_at", end).order("id").range(a, b),
    );
    const { data: people } = await sb.from("profiles").select("id,email,name");
    const info = new Map((people ?? []).map((p) => [p.id as string, p]));

    const total = { jobs: 0, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, failed: 0 };
    const users = new Map<string, UserStat>();
    const features = new Map<string, { feature: string; jobs: number; cost: number }>();
    for (const r of rows) {
      total.jobs += 1;
      total.requests += r.request_count;
      total.inputTokens += Number(r.input_tokens);
      total.outputTokens += Number(r.output_tokens);
      total.cost += Number(r.cost_usd);
      if (r.status === "failed") total.failed += 1;
      const p = info.get(r.user_id);
      const u: UserStat = users.get(r.user_id) ?? { user_id: r.user_id, email: p?.email ?? "(삭제됨)", name: p?.name ?? null, jobs: 0, cost: 0, byFeature: {} };
      u.jobs += 1;
      u.cost += Number(r.cost_usd);
      u.byFeature[r.feature] = (u.byFeature[r.feature] ?? 0) + 1;
      users.set(r.user_id, u);
      const f = features.get(r.feature) ?? { feature: r.feature, jobs: 0, cost: 0 };
      f.jobs += 1;
      f.cost += Number(r.cost_usd);
      features.set(r.feature, f);
    }
    return Response.json(
      { month, total, byUser: [...users.values()].sort((a, b) => b.cost - a.cost), byFeature: [...features.values()].sort((a, b) => b.jobs - a.jobs) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
