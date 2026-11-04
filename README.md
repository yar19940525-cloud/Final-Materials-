# 학습지 → 시험지·답지 변환기

학습지 사진을 올리면 학생 필기·낙서를 지운 **깨끗한 시험지**와, 정답이 빨간색으로 표시된 **답지**를 만들어 주는 Next.js 서비스입니다.

## 직보예상문제 (`/predict`)

1. **기출분석 자료** (PDF·사진, 선택) 2. **기출문제** (PDF·사진, 선택) 3. **학교 프린트** (PDF·사진, 필수)를 올리면 우리 학교 출제 경향에 맞춘 예상문제를 만들어 줍니다.

- 옵션: 문항 수(5~40), 객관식 비율, 난이도, 추가 요청
- 1단계: 기출분석·기출문제로 출제 경향을 요약하고 문항별 출제 계획(유형·내용·근거)을 세움 (구조화 출력 JSON)
- 2단계: 계획을 5문항씩 나눠 3개씩 병렬로 문제·정답·해설·출제 근거를 작성 (자료 부분은 프롬프트 캐시로 재사용)
- **기출 시험지 디자인 따라하기**: 1단계에서 기출 시험지의 학교명·제목 형식·학년반번호이름 칸·안내문·단 수(1/2단)·글꼴(명조/고딕)·문항 번호 모양·선택지 배치·지문 상자·배점 표기·서술형 번호 방식·끝맺음 문구를 읽어 와 예상문제 시험지에 그대로 입힘. 결과 화면에서 단·글꼴·선택지·번호·지문 상자를 바꿀 수 있음 (`lib/paginate.ts`가 A4 쪽·단 단위로 배치)
- 결과: **시험지**(문제만) / **답지·해설**(정답·해설·출제 근거·경향 분석) — PDF·Word·인쇄, 화면에서 직접 수정 가능
- 모델: **모든 자료를 `claude-haiku-5-5`로 고정** (요금 절감). 서버(`lib/server-ai.ts`의 `MODEL`)에서만 정하며 화면에서 바꿀 수 없음
- 업로드 한도: 파일 30개, 합계 22MB (사진은 브라우저에서 줄여서 보냄)

## 학프예상문제 (`/hakpeu`)

**학프(학교 프린트)** PDF·사진을 올리면 **어법 / 어휘 / 독해 / 서술형** 영역별 문항 수대로 예상문제를 만들고, 시험지에 `Ⅰ. 어법 (n문항)`처럼 영역 제목을 붙여 영역 순서로 배치합니다. 기출 시험지(선택)를 넣으면 그 디자인을 따라 하고, 시험지 디자인·지문 상자·답지·PDF·Word는 직보예상문제와 같습니다 (`app/predict/predict-app.tsx`를 두 탭이 함께 씀).

## 대표 대화문 빈칸 (`/dialogue`)

교과서 대화문 사진·PDF(과 번호가 보이게)를 올리면 대화문마다 `Lesson 3 · Listen & Talk 1`처럼 과를 표시하고, **화자 | 영어(중요 표현 빈칸) | 우리말** 표로 빈칸 시험지를 만듭니다. 빈칸 양(적게/보통/많이) 선택, 시험지/답지(빨간 정답), PDF·Word·인쇄. 사진은 한 장씩 3장 동시 처리.

## 기출분석 자료 제작 (`/analysis`)

**학교 시험지**(PDF·사진, 여러 개) + **기출분석 샘플**(우리 학원 양식)을 넣으면, 샘플의 제목·섹션 순서·표 열 구성·말투를 그대로 따라 이번 시험지의 기출분석 자료(문항별 유형·출제 포인트·난이도·정답, 총평·대비 전략 등)를 만듭니다. 화면에서 수정 후 PDF·Word·인쇄.

## 시험 당일 응원 메시지 (`/cheer`)

**직보 자료**를 넣으면 "[학교 과목 내신 응원 문자] → 1. 문법 KEY POINT → 2. 중요한 문장 정리 → 3. 꼭 기억해야 할 포인트 → 4. 선생님의 응원 → ★ 링크" 형식의 응원 문자를 만듭니다. 학교·과목·선생님 호칭·링크는 기기에 기억되고, 결과를 고친 뒤 복사해 카카오톡·문자로 보냅니다.

서버 공용 코드는 `lib/server-ai.ts`, 화면 공용은 `lib/ai-client.ts`·`app/file-slot.tsx`·`app/nav.tsx`.

## 구조

```
app/
  page.tsx              # 업로드 → 변환 → 시험지/답지 보기·수정·PDF·인쇄 (클라이언트)
  api/convert/route.ts  # 사진·PDF(여러 개)를 받아 Claude API로 HTML 변환, 결과를 스트리밍
  predict/page.tsx      # 예상문제 생성 화면 (자료 3종 업로드 → 옵션 → 시험지/답지)
  api/predict/route.ts  # 출제 계획(stage=plan) / 문항 작성(stage=write) API
  layout.tsx, globals.css
  manifest.ts, pwa.tsx  # 설치형 앱(PWA): 매니페스트, 서비스 워커 등록, 설치 버튼
lib/
  prompt.ts             # 변환 프롬프트
  client.ts             # 이미지 축소, HTML 정리(허용 태그만), PDF 생성
  docx.ts               # 화면의 시험지/답지를 Word(.docx)로 변환
  predict.ts            # 예상문제: 파일 준비, 계획 → 5문항씩 병렬 작성, 시험지 조립
  predict-prompt.ts     # 예상문제 프롬프트·계획 JSON 스키마
  diagnose.ts           # (서버) Anthropic 403 원인 진단
```

- API 키는 서버(`/api/convert`)에서만 쓰이고 브라우저로 나가지 않습니다.
- 모델: `claude-haiku-5-5` (adaptive thinking, effort `medium`).
- 업로드는 최대 10개·합계 100페이지. 브라우저가 사진 1장 / PDF 3페이지 단위로 쪼개 3개씩 병렬로 변환하고 순서대로 이어 붙입니다 (AI 출력 한도 때문에 긴 문서를 한 번에 보내지 않음). 요청 과다(429)는 자동 재시도, 응답이 잘리면 더 잘게 쪼개 재시도, 끝내 실패한 조각은 ⚠로 표시합니다.

## 실행

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY 입력
npm run dev                  # http://localhost:3000
```

배포: `npm run build && npm start`, 또는 Vercel에 올리고 환경 변수 `ANTHROPIC_API_KEY`를 설정하세요. 변환이 30초~1분 걸리므로 API 라우트의 `maxDuration`을 300초로 두었습니다 (플랜별 제한 확인).

## 앱 설치 (PWA)

- 안드로이드/PC 크롬·엣지: 주소창의 설치 아이콘 또는 화면 오른쪽 아래 “앱으로 설치” 버튼
- 아이폰 사파리: 공유 버튼 → “홈 화면에 추가”
- 서비스 워커(`public/sw.js`)는 화면과 정적 파일만 캐시하며 `/api/*`는 항상 서버로 보냅니다. 아이콘은 `public/icons/`.
- 설치는 HTTPS에서만 되므로 Cloudflare 주소(https)에서 동작합니다.

## Cloudflare 배포 (Git 연동)

- 설정 파일: `wrangler.jsonc`, `open-next.config.ts` (OpenNext for Cloudflare)
- Worker 설정 → Builds
  - Build command: `npx opennextjs-cloudflare build`
  - Deploy command: `npx opennextjs-cloudflare deploy`
- `ANTHROPIC_API_KEY`는 Variables and Secrets에 **Secret**으로 등록합니다.
- Anthropic API는 홍콩(HKG) 등 일부 지역에서 403으로 거부하므로 `wrangler.jsonc`의 `placement`로 Worker를 미국 동부(`aws:us-east-1`) 근처에서 실행합니다. 변환 실패(403) 시 화면 메시지의 “서버 실행 위치”로 확인할 수 있습니다.
- 로컬 확인: `npm run preview` (키는 `.dev.vars`에 `ANTHROPIC_API_KEY=...`)
