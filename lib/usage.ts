// 서버 전용: 누가 무엇을 얼마나 썼는지 기록 (관리자 페이지의 사용 기록)
import { FEATURES, type Feature } from "./features";
import { serviceClient } from "./supabase-server";

export { FEATURES, type Feature };
export const asFeature = (v: unknown): Feature | null => (typeof v === "string" && v in FEATURES ? (v as Feature) : null);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asJobId = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null);

export interface JobCtx {
  userId: string;
  jobId: string;
  feature: Feature;
}
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Haiku 5.5 단가(달러 / 백만 토큰). 프롬프트가 10만 토큰을 넘으면 높은 단가. 캐시 읽기는 10%, 쓰기는 125%로 가정한 추정치.
export function estimateCostUsd(u: Usage): number {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const p = prompt > 100_000 ? { in: 0.5, out: 2.5 } : { in: 0.1, out: 0.5 };
  return (u.input * p.in + u.cacheWrite * p.in * 1.25 + u.cacheRead * p.in * 0.1 + u.output * p.out) / 1e6;
}

// AI 호출 1번의 사용량을 작업(job_id)에 더한다. 기록 실패가 사용을 막지 않도록 오류는 삼킨다.
export async function recordUsage(ctx: JobCtx, usage: Usage | null, error?: string): Promise<void> {
  try {
    const u = usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const { error: e } = await serviceClient().rpc("log_usage", {
      p_job_id: ctx.jobId,
      p_user_id: ctx.userId,
      p_feature: ctx.feature,
      p_input: u.input,
      p_output: u.output,
      p_cache_read: u.cacheRead,
      p_cache_write: u.cacheWrite,
      p_cost: estimateCostUsd(u),
      p_error: error ? error.slice(0, 300) : null,
    });
    if (e) console.error("recordUsage failed", e.message);
  } catch (e) {
    console.error("recordUsage failed", e);
  }
}
