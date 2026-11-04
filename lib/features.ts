// 기능 이름 (서버 기록과 관리자 화면이 같이 쓴다. 서버 전용 코드를 끌어오지 않도록 따로 둔다)
export const FEATURES = {
  convert: "시험지·답지 변환",
  "predict-jikbo": "직보예상문제",
  "predict-hakpeu": "학프예상문제",
  dialogue: "대화문 빈칸",
  analysis: "기출분석 자료",
  "analysis-sms": "기출분석 문자",
  cheer: "응원 메시지",
} as const;
export type Feature = keyof typeof FEATURES;
