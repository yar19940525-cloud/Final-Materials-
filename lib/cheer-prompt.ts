// 시험 당일 응원 메시지 프롬프트 (직보 자료 → 학생들에게 보내는 응원 문자)

export interface CheerOptions {
  school: string; // 학교 이름 (비우면 자료에서 읽음)
  subject: string; // 과목 (기본 영어)
  teacher: string; // 선생님 호칭 (예: 아름쌤)
  linkTitle: string; // 마지막 링크 제목 (예: DYB 행운의 부적 받기)
  link: string; // 링크 주소
  note: string; // 추가 요청
}

// 선생님이 보내 준 실제 문자 (형식·말투의 기준)
const EXAMPLE = `[석우중 영어 내신 응원 문자]
사랑하는 우리 석우중 친구들♥
시험장에 들어가기 전, 이것만 가볍게 확인해 봅시다!

1. 문법 KEY POINT
① 3인칭 단수 현재형
주어가 he, she, it이면 동사에 -s / -es를 붙여요!
→ She plays the piano.
② 주의해야 할 불규칙 과거형
break → broke / catch → caught
take → took / seek → sought
③ to부정사를 목적어로 취하는 대표 동사
want, would like, decide, need, expect, wish 등
→ 동사 뒤에는 to + 동사원형!
④ 헷갈리는 비교급·최상급
good / well → better → best
bad → worse → worst
far → farther → farthest
※ farther와 farthest는 주로 거리를 나타낼 때 사용해요.

2. 중요한 문장 정리
① It was the most useful book of the movie.
② Telling a lie was the worst choice.
③ Mark bought toys for his brother.

3. 꼭 기억해야 할 포인트
① 4형식 → 3형식으로 바꿀 때, 동사에 맞는 전치사 to / for를 한 번 더 확인하기!
② 우리말을 영작할 때는 시제를 꼼꼼하게 확인하기!
③ in order to, so as to는 목적을 나타내는 to부정사로 바꿔 쓸 수 있어요!

4. 아름쌤의 응원
우리 친구들, 시험을 위해 열심히 준비해 온 시간은 절대 사라지지 않아요. 그동안 쌓아 온 실력을 믿고 시험장에 들어가 봅시다!
조금 긴장되더라도 괜찮아요. 깊게 숨을 한 번 쉬고, 지금까지 연습한 것처럼 한 문제씩 차분하게 풀어봅시다!
우리 친구들의 노력이 빛나는 하루가 되길!
석우중 파이팅!

★ DYB 행운의 부적 받기
https://drive.google.com/file/d/17RzZX5OU20pcuaqx8MS-G202y6CJqG0w/view?usp=sharing`;

export function cheerPrompt(o: CheerOptions): string {
  const school = o.school || "(자료에서 학교 이름을 찾아 쓰고, 없으면 \"우리\")";
  return `너는 학원 ${o.subject} 선생님(${o.teacher})이야. 첨부한 직보(직전 보강) 자료는 이번 ${o.subject} 내신 시험 범위를 마지막으로 정리한 자료야.
이 자료를 보고, 시험 당일 아침 학생들에게 보낼 응원 문자를 아래 [예시]와 똑같은 형식·말투로 새로 써 줘.

[예시]
${EXAMPLE}

규칙:
- 맨 첫 줄: [${school} ${o.subject} 내신 응원 문자] / 둘째 줄: 사랑하는 우리 ${school} 친구들♥ / 셋째 줄: 시험장에 들어가기 전, 이것만 가볍게 확인해 봅시다!
- 1. 문법 KEY POINT: 직보 자료에서 시험에 가장 나올 만한 문법 3~5개. 항목마다 ①②③… 제목 한 줄 + 짧은 설명이나 변화형 + 필요하면 "→ 예문". 헷갈리는 점은 ※로 한 줄.
- 2. 중요한 문장 정리: 직보 자료(본문·핵심 예문)에서 꼭 외워야 할 문장 3~5개를 철자 그대로 옮겨 (지어내지 마).
- 3. 꼭 기억해야 할 포인트: 서술형·영작·실수하기 쉬운 점 3개, "~하기!"처럼 짧게.
- 4. ${o.teacher}의 응원: 예시처럼 따뜻하고 힘이 나는 3~5줄, 예시 문장을 그대로 베끼지 말고 새로 쓰고 마지막 줄은 "(학교 이름) 파이팅!" 형식.
- 학생이 휴대폰으로 읽는 문자이니 한 줄을 짧게, 번호는 ①②③, 화살표는 →.
- 마크다운(**, #, - 목록)이나 코드블록은 쓰지 마. 문자 내용만 출력하고 앞뒤 설명은 쓰지 마.
${o.link ? `- 맨 끝에 빈 줄 하나 다음 "★ ${o.linkTitle || "행운의 부적 받기"}" 한 줄, 그 아래 링크 ${o.link} 를 그대로.` : "- 마지막 링크 부분(★ …)은 넣지 마."}
${o.note ? `- 선생님 추가 요청 (최우선 반영): ${o.note}` : ""}`;
}
