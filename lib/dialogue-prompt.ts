// 대표 대화문 빈칸 시험지 프롬프트 (교과서 대화문 사진 → 과 표시 + 영어 빈칸 + 우리말)

export type BlankLevel = "적게" | "보통" | "많이";
const LEVEL_GUIDE: Record<BlankLevel, string> = {
  적게: "대화문 하나에 3~5개 (꼭 외워야 할 핵심 표현만)",
  보통: "한 줄에 0~1개, 대화문 하나에 6~10개",
  많이: "거의 모든 줄에 1~2개, 대화문 하나에 10~16개",
};

export function dialoguePrompt(level: BlankLevel, note: string): string {
  return `너는 중학교 영어 선생님이야. 첨부한 사진(또는 PDF)은 영어 교과서의 대표 대화문이고, 몇 과(Lesson)인지 적혀 있어.
사진 속 대화문을 모두 찾아, 학생이 외웠는지 확인하는 "대화문 빈칸 시험지"를 만들어.

규칙:
- 사진에 있는 대화문을 하나도 빠뜨리지 말고, 영어 문장은 철자·문장부호까지 사진 그대로 옮겨. 학생 필기·낙서는 무시해.
- 대화문마다 맨 위에 과 표시 제목: <h2 class="lesson">Lesson 3 · Listen & Talk 1</h2> 처럼 사진에 적힌 과 번호와 대화문 이름(Listen & Talk, Dialogue, Real Life Talk 등)을 그대로. 과 이름(단원 제목)이 보이면 "Lesson 3 · 단원 제목 · Listen & Talk 1"처럼 함께. 과 번호가 정말 안 보이면 "Lesson ?".
- 그다음 표 하나: <table class="dlg"><tr><th>화자</th><th>English</th><th>우리말</th></tr> 다음 대사 한 줄마다 <tr><td>화자</td><td>영어 대사</td><td>우리말 해석</td></tr>.
  - 화자는 사진 그대로 (A, B, G, B, W, M, 이름 등). 없으면 A/B.
  - 우리말: 사진에 해석이 있으면 그대로, 없으면 자연스러운 우리말로 해석해.
- 빈칸: 시험에 잘 나오는 중요한 부분을 골라 영어 칸에서 <span class="f">빈칸 정답</span>으로 감싸. 빈칸 양: ${LEVEL_GUIDE[level]}.
  - 우선순위: 그 과의 의사소통 기능 표현(예: I'm worried about ~, How about ~ing?, Can you tell me ~?) > 핵심 어휘·숙어 > 문법 포인트(시제, to부정사, 관계대명사 등).
  - 빈칸 하나는 한 단어~네 단어 정도로. 화자·우리말 칸에는 빈칸을 만들지 마.
- 대화문이 여러 개면 위 형식(제목 + 표)을 대화문마다 반복해.
${note ? `- 선생님 추가 요청 (최우선 반영): ${note}\n` : ""}
출력: HTML 조각만. <html>,<body>,<style>,<script>, 코드블록(\`\`\`), 앞뒤 설명, style 속성 금지.`;
}
