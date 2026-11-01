// 예상문제 생성 프롬프트 (기출분석 + 기출문제 + 학교 프린트 → 예상문제)

export type Role = "analysis" | "past" | "print";
export const ROLE_LABEL: Record<Role, string> = {
  analysis: "기출분석 자료",
  past: "기출문제",
  print: "학교 프린트(이번 시험 범위)",
};

export interface PredictOptions {
  count: number; // 만들 문항 수
  mcRatio: number; // 객관식 비율 0~100 (나머지는 서술형·단답형)
  level: "기본" | "중간" | "상" | "최상";
  note: string; // 선생님 추가 요청
}

export interface PlanItem {
  no: number;
  type: string; // 객관식 / 서술형 / 단답형
  topic: string; // 무엇을 묻는지 (프린트의 어느 내용)
  basis: string; // 출제 근거 (기출 경향·기출 n번 변형 등)
  level: string;
}

export interface Plan {
  analysis: string; // 출제 경향 분석 요약 (줄글)
  items: PlanItem[];
}

const ROLE_GUIDE = `자료는 세 종류야.
- 기출분석 자료: 이 학교 선생님의 출제 경향(자주 나오는 유형·단원·함정·배점·서술형 비중 등)을 정리한 것. 출제 경향 판단의 1순위 근거.
- 기출문제: 이 학교의 지난 시험지. 문제 유형, 선택지 구성 방식, 발문 말투, 난이도, 서술형 조건 형식을 그대로 본떠.
- 학교 프린트: 이번 시험 범위의 수업 자료. 예상문제의 내용(지문·개념·예문)은 반드시 여기서 가져와.
없는 종류의 자료는 나머지 자료로 판단해.`;

export function planPrompt(o: PredictOptions): string {
  const mc = Math.round((o.count * o.mcRatio) / 100);
  return `너는 한국 중·고등학교 내신 시험 출제 전문가야. 첨부한 자료로 이번 시험의 예상문제 출제 계획을 세워.
${ROLE_GUIDE}

할 일:
1. analysis: 기출분석·기출문제에서 읽어 낸 이 학교의 출제 경향을 5~8줄로 요약해 (자주 나오는 유형, 선호하는 함정, 서술형 조건, 학교 프린트에서 특히 나올 만한 부분). 줄마다 "- "로 시작하고 줄바꿈(\\n)으로 구분.
2. items: 정확히 ${o.count}문항의 출제 계획. 객관식 약 ${mc}문항, 나머지는 서술형/단답형. 난이도는 전체적으로 "${o.level}" 수준에 맞춰.
   - 학교 프린트의 내용을 고르게 다루되, 기출 경향상 출제 가능성이 높은 부분에 더 많이 배정해.
   - 문항끼리 묻는 내용이 겹치지 않게 해.
   - topic: 프린트의 어느 내용(지문 단락·개념·예문 등)을 어떤 방식으로 묻는지 구체적으로 한두 문장.
   - basis: 왜 나올 것 같은지 (예: "기출 2023-1학기 7번과 같은 어법 선택 유형", "기출분석: 서술형 영작 매년 출제").
   - type: "객관식", "서술형", "단답형" 중 하나. level: "기본", "중간", "상", "최상" 중 하나.
${o.note ? `\n선생님 추가 요청 (최우선 반영): ${o.note}\n` : ""}`;
}

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "items"],
  properties: {
    analysis: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["no", "type", "topic", "basis", "level"],
        properties: {
          no: { type: "integer" },
          type: { type: "string" },
          topic: { type: "string" },
          basis: { type: "string" },
          level: { type: "string" },
        },
      },
    },
  },
} as const;

export function writePrompt(o: PredictOptions, items: PlanItem[]): string {
  return `너는 한국 중·고등학교 내신 시험 출제 전문가야. 첨부한 자료를 바탕으로, 아래 출제 계획의 문항들을 실제 시험지 문제로 완성해.
${ROLE_GUIDE}

출제 계획 (이 문항들만, 이 번호로 만들어):
${items.map((i) => `${i.no}번 [${i.type}/${i.level}] ${i.topic} (근거: ${i.basis})`).join("\n")}
${o.note ? `\n선생님 추가 요청 (최우선 반영): ${o.note}\n` : ""}
문제 작성 원칙:
- 지문·예문·개념은 학교 프린트에서 정확히 가져와 (철자·문장 그대로). 프린트에 없는 내용을 지어내지 마.
- 발문 말투, 선택지 개수(보통 5개, ①~⑤), 서술형 조건 형식은 기출문제를 본떠.
- 정답은 반드시 하나이고, 직접 풀어서 검증해. 매력적인 오답을 넣되 오답이 정답이 될 여지가 없게 해.
- 해설은 왜 정답인지와 주요 오답이 왜 틀렸는지 짧게.

출력 형식 (HTML 조각만. <html>,<body>,<style>,<script>, 코드블록(\`\`\`), 설명 문장 금지. 모든 요소는 최상위에 나란히 두고 서로 감싸지 마):
- 문항 시작: <p class="qn"><b>번호.</b> 발문 <span class="pt">[배점 또는 서술형 표시]</span></p>  (배점 표시는 기출에 있을 때만)
- 지문·<보기>·조건: <p class="bx">내용</p> (여러 줄이면 <br>로 줄바꿈, 지문이 길면 여러 개의 <p class="bx">). 밑줄은 <u>, 굵게는 <b>, (A)(B) 같은 기호는 그대로.
- 표가 필요하면 <table>(머리줄은 <th>).
- 객관식 선택지: 선택지 하나마다 <p class="ch">① 선택지</p>
- 서술형·단답형 답 쓰는 칸: <p class="wr"></p> (서술형은 2개, 단답형은 1개)
- 정답: <p class="ans">정답: ③</p> (서술형은 모범답안과 채점 기준)
- 해설: <p class="exp">해설: …</p>
- 출제 근거: <p class="src">출제 근거: …</p>
- 문항과 문항 사이에는 아무것도 넣지 마.`;
}
