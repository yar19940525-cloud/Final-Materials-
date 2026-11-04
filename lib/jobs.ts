// 브라우저 전용: 작업(변환 1번, 예상문제 1번 …)의 시작·끝을 서버에 알려 사용 기록과 문서 보관이 남게 한다.
// 이 호출이 실패해도 문서 만들기는 계속된다 (실패를 삼킨다).
import { authFetch } from "./auth-client";

import type { Feature } from "./features";
export type { Feature };

export const newJobId = (): string => crypto.randomUUID();

export const jobLabel = (names: string[]): string => names.slice(0, 5).join(", ") + (names.length > 5 ? ` 외 ${names.length - 5}개` : "");

export async function startJob(j: { jobId: string; feature: Feature; label: string; files: { name: string; blob: Blob }[] }): Promise<void> {
  try {
    const fd = new FormData();
    fd.append("jobId", j.jobId);
    fd.append("feature", j.feature);
    fd.append("label", j.label);
    for (const f of j.files) fd.append("files", f.blob, f.name);
    await authFetch("/api/jobs/start", { method: "POST", body: fd });
  } catch {
    /* 기록 실패는 무시 */
  }
}

export async function finishJob(j: {
  jobId: string;
  feature: Feature;
  status: "done" | "failed";
  error?: string;
  content?: string; // 결과물 (HTML 또는 글)
  kind?: "html" | "text";
}): Promise<void> {
  try {
    await authFetch("/api/jobs/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(j) });
  } catch {
    /* 기록 실패는 무시 */
  }
}
