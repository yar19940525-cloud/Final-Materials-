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
  num?: string; // 시험지에 찍을 번호 표기 (예: "3." / "[서술형 1]"), 화면에서 정한다
  type: string; // 객관식 / 서술형 / 단답형
  topic: string; // 무엇을 묻는지 (프린트의 어느 내용)
  basis: string; // 출제 근거 (기출 경향·기출 n번 변형 등)
  level: string;
}

// 기출 시험지에서 읽어 낸 디자인 (예상문제 시험지에 그대로 입힌다)
export interface ExamStyle {
  school: string; // 학교 이름 (모르면 "")
  title: string; // 시험지 제목 (기출 제목 형식을 본떠 이번 시험에 맞춤)
  fields: string[]; // 머리의 학년·반·번호·이름 칸
  columns: 1 | 2; // 단 수
  font: "serif" | "sans"; // 명조 / 고딕
  numStyle: "dot" | "box"; // 문항 번호: "1." / 네모 칸
  choiceLayout: "vertical" | "inline"; // 선택지 세로 나열 / 가로로 이어 쓰기
  boxPassage: boolean; // 지문·<보기>를 테두리 상자에 넣는지
  pointExample: string; // 배점 표기 예 (예: "[4.2점]"), 없으면 ""
  essaySeparate: boolean; // 서술형 번호를 따로 매기는지 (서술형 1, 2…)
  essayLabel: string; // 서술형 번호 앞말 (예: "서술형", "서답형")
  note: string; // 제목 아래 안내문 (없으면 "")
  footer: string; // 마지막 문구 (예: "수고하셨습니다", 없으면 "")
}

export const DEFAULT_STYLE: ExamStyle = {
  school: "",
  title: "",
  fields: ["학년", "반", "번호", "이름"],
  columns: 2,
  font: "serif",
  numStyle: "dot",
  choiceLayout: "vertical",
  boxPassage: true,
  pointExample: "",
  essaySeparate: true,
  essayLabel: "서술형",
  note: "",
  footer: "",
};

export interface Plan {
  analysis: string; // 출제 경향 분석 요약 (줄글)
  style: ExamStyle;
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
3. style: 기출문제 시험지의 디자인을 그대로 읽어 적어 (기출문제가 없으면 기출분석 자료, 둘 다 없으면 일반적인 한국 내신 시험지 기준).
   - school: 학교 이름 (안 보이면 "").
   - title: 기출 시험지 맨 위 제목의 형식을 그대로 따르되, 학년도·학기·시험 종류는 학교 프린트로 보아 이번 시험에 맞게 바꾸고 끝에 "(예상문제)"를 붙여. 예: "2025학년도 2학기 2학년 1차 지필평가 영어 (예상문제)".
   - fields: 머리에 있는 학년·반·번호·이름 같은 칸 이름들을 순서대로 (없으면 ["학년","반","번호","이름"]).
   - columns: 본문이 두 단으로 나뉘어 있으면 2, 아니면 1.
   - font: 본문 글꼴이 명조(바탕) 계열이면 "serif", 고딕(돋움) 계열이면 "sans".
   - numStyle: 문항 번호가 네모 칸 안에 있으면 "box", "1."처럼 그냥 쓰면 "dot".
   - choiceLayout: 선택지 ①~⑤를 한 줄에 여러 개 이어 쓰면 "inline", 한 줄에 하나씩이면 "vertical".
   - boxPassage: 지문이나 <보기>를 테두리 상자 안에 넣으면 true.
   - pointExample: 배점 표기를 기출과 똑같은 모양으로 한 예 (예: "[4.2점]", "(3점)"). 배점 표기가 없으면 "".
   - essaySeparate: 서술형 문항 번호를 객관식과 따로 "서술형 1, 2…"처럼 매기면 true, 객관식 번호에 이어서 매기면 false.
   - essayLabel: 서술형 번호 앞에 붙는 말 (예: "서술형", "서답형"). 없으면 "서술형".
   - note: 제목 아래의 수험 안내문을 기출 그대로 (예: "※ 답안지에 컴퓨터용 사인펜으로 표기하시오.", 없으면 "").
   - footer: 시험지 마지막 문구 (예: "수고하셨습니다", 없으면 "").
${o.note ? `\n선생님 추가 요청 (최우선 반영): ${o.note}\n` : ""}`;
}

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "style", "items"],
  properties: {
    analysis: { type: "string" },
    style: {
      type: "object",
      additionalProperties: false,
      required: [
        "school", "title", "fields", "columns", "font", "numStyle", "choiceLayout",
        "boxPassage", "pointExample", "essaySeparate", "essayLabel", "note", "footer",
      ],
      properties: {
        school: { type: "string" },
        title: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
        columns: { type: "integer", enum: [1, 2] },
        font: { type: "string", enum: ["serif", "sans"] },
        numStyle: { type: "string", enum: ["dot", "box"] },
        choiceLayout: { type: "string", enum: ["vertical", "inline"] },
        boxPassage: { type: "boolean" },
        pointExample: { type: "string" },
        essaySeparate: { type: "boolean" },
        essayLabel: { type: "string" },
        note: { type: "string" },
        footer: { type: "string" },
      },
    },
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

export function writePrompt(o: PredictOptions, items: PlanItem[], pointExample = ""): string {
  return `너는 한국 중·고등학교 내신 시험 출제 전문가야. 첨부한 자료를 바탕으로, 아래 출제 계획의 문항들을 실제 시험지 문제로 완성해.
${ROLE_GUIDE}

출제 계획 (이 문항들만, 적힌 번호 표기 그대로 만들어):
${items.map((i) => `번호 "${i.num || i.no + "."}" [${i.type}/${i.level}] ${i.topic} (근거: ${i.basis})`).join("\n")}
${o.note ? `\n선생님 추가 요청 (최우선 반영): ${o.note}\n` : ""}
문제 작성 원칙:
- 지문·예문·개념은 학교 프린트에서 정확히 가져와 (철자·문장 그대로). 프린트에 없는 내용을 지어내지 마.
- 발문 말투, 선택지 개수(보통 5개, ①~⑤), 서술형 조건 형식은 기출문제를 본떠.
- 정답은 반드시 하나이고, 직접 풀어서 검증해. 매력적인 오답을 넣되 오답이 정답이 될 여지가 없게 해.
- 해설은 왜 정답인지와 주요 오답이 왜 틀렸는지 짧게.

출력 형식 (HTML 조각만. <html>,<body>,<style>,<script>, 코드블록(\`\`\`), 설명 문장 금지. 모든 요소는 최상위에 나란히 두고 서로 감싸지 마):
- 문항 시작: <p class="qn"><b>번호 표기</b> 발문${pointExample ? ` <span class="pt">배점</span></p>  (배점은 기출과 같은 모양으로, 예: ${pointExample})` : "</p>  (배점 표기는 넣지 마)"}
- 지문·<보기>·대화문·조건: 반드시 <p class="bx">로 써 (상자 안에 들어감). 여러 줄이면 한 <p class="bx"> 안에서 <br>로 줄바꿈하고, 지문이 길면 여러 개의 <p class="bx">를 이어 써 (이어진 것들은 한 상자로 묶임). 밑줄은 <u>, 굵게는 <b>, (A)(B) 같은 기호는 그대로.
  예: <p class="bx">&lt;보기&gt;<br>ⓐ He fixed his car <u>himself</u>.<br>ⓑ I introduced <u>myself</u> to my new friends.</p>
- 표가 필요하면 <table>(머리줄은 <th>).
- 객관식 선택지: 선택지 하나마다 <p class="ch">① 선택지</p>
- 서술형·단답형 답 쓰는 칸: <p class="wr"></p> (서술형은 2개, 단답형은 1개)
- 정답: <p class="ans">정답: ③</p> (서술형은 모범답안과 채점 기준)
- 해설: <p class="exp">해설: …</p>
- 출제 근거: <p class="src">출제 근거: …</p>
- 문항과 문항 사이에는 아무것도 넣지 마.`;
}
