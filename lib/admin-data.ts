// 서버 전용: 관리자 페이지용 조회 도우미
import type { PostgrestError } from "@supabase/supabase-js";

// "이번 달"은 한국 시간 기준. month = "2026-11" 형식 (없으면 이번 달)
export function monthRange(month?: string | null): { month: string; start: string; end: string } {
  let m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
  if (!m) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    m = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const [y, mo] = m.split("-").map(Number);
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { month: m, start: `${y}-${pad(mo)}-01T00:00:00+09:00`, end: `${ny}-${pad(nm)}-01T00:00:00+09:00` };
}

// Supabase는 한 번에 1,000줄까지만 주므로 끝까지 나눠서 가져온다.
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
