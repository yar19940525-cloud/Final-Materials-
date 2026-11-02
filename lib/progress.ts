// 진행률 어림 계산 (AI는 끝날 때까지 전체 분량을 알 수 없으므로, 받은 글자 수와 걸린 시간으로 어림한다)

// 글자 수 기준: 예상 분량(expected)에 가까워질수록 천천히 100%에 다가간다 (끝나기 전엔 97%를 넘지 않음).
export function byChars(chars: number, expected: number): number {
  return 0.97 * (1 - Math.exp(-chars / Math.max(1, expected) * 1.4));
}

// 시간 기준: AI가 글을 쓰기 전 생각하는 동안에도 막대가 조금씩 움직이게 (최대 maxFrac까지)
export function byTime(ms: number, maxFrac = 0.1, halfMs = 25000): number {
  return maxFrac * (1 - Math.pow(0.5, ms / halfMs));
}

// 0~1 → 0~99 정수 % (완료 전에는 100을 보여 주지 않는다)
export const pct = (frac: number) => Math.max(0, Math.min(99, Math.floor(frac * 100)));
