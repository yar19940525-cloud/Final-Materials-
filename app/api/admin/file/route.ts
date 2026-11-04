import { fail, guard, HttpError } from "@/lib/http";
import { requireAdmin } from "@/lib/server-auth";
import { getBucket } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 저장된 문서(올린 원본·결과물)를 관리자에게 내려 준다. 우리가 만든 경로만 허용한다.
const KEY_RE = /^jobs\/[0-9a-f-]{36}\/(in\/[^/]+|result\.(html|txt))$/i;

export async function GET(req: Request) {
  return guard(async () => {
    await requireAdmin(req);
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (!KEY_RE.test(key)) return fail("파일 경로가 잘못됐어요.", 400);
    const bucket = await getBucket();
    if (!bucket) throw new HttpError("저장소가 연결되어 있지 않아요.", 503);
    const obj = await bucket.get(key);
    if (!obj) throw new HttpError("저장된 파일이 없어요.", 404);
    const name = key.split("/").pop() ?? "file";
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        // 올린 사람이 만든 HTML이 관리자 화면에서 실행되지 못하게 막는다
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "Cache-Control": "no-store",
      },
    });
  });
}
