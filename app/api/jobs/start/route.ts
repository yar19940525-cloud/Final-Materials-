import { fail, guard, HttpError } from "@/lib/http";
import { requireApproved } from "@/lib/server-auth";
import { serviceClient } from "@/lib/supabase-server";
import { getBucket, safeName } from "@/lib/storage";
import { asFeature, asJobId } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

// 작업을 시작할 때 화면이 한 번 부른다: 올린 원본 문서를 클라우드플레어에 저장하고, 사용 기록 한 줄을 만든다.
// 저장·기록이 실패해도 문서 만들기 자체는 계속되도록, 화면은 이 호출의 실패를 무시한다.
export async function POST(req: Request) {
  return guard(async () => {
    const { profile } = await requireApproved(req);
    const form = await req.formData().catch(() => null);
    if (!form) return fail("업로드를 읽지 못했어요.", 400);
    const jobId = asJobId(form.get("jobId"));
    const feature = asFeature(form.get("feature"));
    if (!jobId || !feature) throw new HttpError("작업 정보가 잘못됐어요.", 400);
    const label = String(form.get("label") ?? "").trim().slice(0, 300);

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length > MAX_FILES) throw new HttpError(`파일이 너무 많아요. (최대 ${MAX_FILES}개)`, 400);
    let total = 0;
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) throw new HttpError(`파일이 너무 커요: ${f.name}`, 413);
      total += f.size;
    }
    if (total > MAX_TOTAL_BYTES) throw new HttpError("파일 전체 용량이 너무 커요.", 413);

    const bucket = await getBucket();
    const saved: { name: string; size: number; type: string; key: string | null }[] = [];
    for (const [i, f] of files.entries()) {
      let key: string | null = null;
      if (bucket) {
        key = `jobs/${jobId}/in/${i + 1}-${safeName(f.name)}`;
        try {
          await bucket.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || "application/octet-stream" } });
        } catch (e) {
          console.error("R2 put failed", e);
          key = null;
        }
      }
      saved.push({ name: f.name.slice(0, 200), size: f.size, type: f.type, key });
    }

    const { error } = await serviceClient().rpc("start_job", {
      p_job_id: jobId,
      p_user_id: profile.id,
      p_feature: feature,
      p_label: label,
      p_files: saved,
      p_count: saved.length,
      p_bytes: total,
    });
    if (error) throw new HttpError("사용 기록을 저장하지 못했어요.", 500);
    return Response.json({ ok: true, stored: !!bucket });
  });
}
