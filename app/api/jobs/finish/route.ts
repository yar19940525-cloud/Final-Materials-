import { fail, guard, HttpError } from "@/lib/http";
import { requireApproved } from "@/lib/server-auth";
import { serviceClient } from "@/lib/supabase-server";
import { getBucket } from "@/lib/storage";
import { asFeature, asJobId } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RESULT_CHARS = 12 * 1024 * 1024;

// 작업이 끝났을 때 화면이 한 번 부른다: 결과물을 저장하고 기록을 '완료'/'실패'로 바꾼다.
export async function POST(req: Request) {
  return guard(async () => {
    const { profile } = await requireApproved(req);
    const body = await req.json().catch(() => null);
    if (!body) return fail("요청을 읽지 못했어요.", 400);
    const jobId = asJobId(body.jobId);
    const feature = asFeature(body.feature);
    const status = body.status === "failed" ? "failed" : "done";
    if (!jobId || !feature) throw new HttpError("작업 정보가 잘못됐어요.", 400);

    let resultKey: string | null = null;
    const content = typeof body.content === "string" ? body.content : "";
    if (content && content.length <= MAX_RESULT_CHARS) {
      const bucket = await getBucket();
      if (bucket) {
        const isText = body.kind === "text";
        const key = `jobs/${jobId}/result.${isText ? "txt" : "html"}`;
        try {
          await bucket.put(key, content, { httpMetadata: { contentType: isText ? "text/plain; charset=utf-8" : "text/html; charset=utf-8" } });
          resultKey = key;
        } catch (e) {
          console.error("R2 put failed", e);
        }
      }
    }

    const { error } = await serviceClient().rpc("finish_job", {
      p_job_id: jobId,
      p_user_id: profile.id,
      p_feature: feature,
      p_status: status,
      p_error: typeof body.error === "string" && body.error ? body.error.slice(0, 300) : null,
      p_result_key: resultKey,
    });
    if (error) throw new HttpError("사용 기록을 저장하지 못했어요.", 500);
    return Response.json({ ok: true, stored: !!resultKey });
  });
}
