// 서버 전용: Anthropic 403 원인 진단

// 403의 원인(서버 실행 지역 vs API 키)을 가르기 위한 진단. 실패한 요청에서만 실행된다.
export async function diagnose403(apiKey: string): Promise<string> {
  const timeout = () => AbortSignal.timeout(5000);
  let where = "위치 확인 실패";
  try {
    const t = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: timeout() })).text();
    const kv = Object.fromEntries(t.split("\n").map((l) => l.split("=") as [string, string]));
    where = `서버 실행 위치 ${kv.colo ?? "?"} / 국가 ${kv.loc ?? "?"}`;
  } catch {}
  let keyCheck = "키 확인 실패";
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: timeout(),
    });
    keyCheck =
      r.status === 200
        ? "키는 정상(모델 목록 조회 성공) → 이 요청만 거부됨"
        : `같은 키로 모델 목록 조회도 실패(${r.status}) → 서버 지역 차단 가능성 큼`;
  } catch {}
  return `Anthropic이 이 요청을 거부했어요 (403). [${where}] [${keyCheck}]`;
}
