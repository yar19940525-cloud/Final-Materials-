import { fail } from "@/lib/http";
import { publicConfig } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 브라우저가 로그인(Supabase)에 연결할 때 필요한 공개 값. 실행 때 환경 변수에서 읽는다.
export async function GET() {
  const c = publicConfig();
  if (!c) return fail("서버에 로그인 설정(Supabase)이 아직 안 되어 있어요.", 503);
  return Response.json(c, { headers: { "Cache-Control": "no-store" } });
}
