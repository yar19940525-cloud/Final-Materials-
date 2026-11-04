# 처음 설정하기 (Supabase · Cloudflare · Google 로그인)

이 사이트는 **구글로 로그인 → 관리자가 승인 → 승인된 선생님만 사용**하는 구조예요.
아래 순서대로 한 번만 하면 됩니다. (화면 메뉴 이름은 서비스가 바뀌면서 조금 다를 수 있어요.)

| 서비스 | 하는 일 | 비용 |
|---|---|---|
| **Cloudflare** | 사이트 운영(Workers) + 올린 문서·결과물 보관(R2) | Workers 무료 범위 안, R2는 10GB까지 무료 (카드 등록 필요) |
| **Supabase** | 구글 로그인 + 사용자·사용 기록 데이터베이스 | 무료 플랜 가능 (아래 주의 참고) |
| **Google Cloud** | "구글로 로그인" 버튼 허가증 발급 | 무료 |
| **Anthropic** | 문서를 만드는 AI | 사용한 만큼 (Haiku로 고정) |

순서: **① Cloudflare에서 사이트를 한 번 올려 주소를 얻는다 → ② Supabase·Google 설정 → ③ Cloudflare에 비밀 값 입력 → ④ 첫 로그인**

---

## ① Cloudflare: 저장소(R2) 만들고 사이트 올리기

1. https://dash.cloudflare.com 로그인.
2. 왼쪽 **R2 Object Storage** → (처음이면 R2 사용 설정, 결제 카드 등록) → **Create bucket**
   - 이름: **`final-materials-files`** ← 반드시 이 이름 (`wrangler.jsonc`에 적혀 있어요)
   - 위치(Location): Automatic
   - **공개(Public access)는 켜지 마세요.** 비공개로 둡니다. (문서는 관리자 화면을 통해서만 열립니다)
3. 왼쪽 **Workers & Pages → Create → Import a repository** → GitHub의 **`Final-Materials-`** 저장소 선택.
   - Worker 이름: **`final-materials`** ← `wrangler.jsonc`의 이름과 같아야 해요.
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
   - **Save and Deploy**
4. 배포가 끝나면 Worker 화면에 사이트 주소가 보여요. 예) `https://final-materials.○○○.workers.dev`
   → **이 주소를 복사해 두세요** (②에서 씁니다). 지금은 "서버의 로그인 설정이 아직 끝나지 않았어요"라고 나오는 게 정상이에요.

## ② Supabase 만들기

1. https://supabase.com → 가입 → **New project**
   - 이름 예) `exam-site`, 데이터베이스 비밀번호(따로 저장), **Region: Northeast Asia (Seoul)**
2. **데이터베이스 만들기**: 왼쪽 **SQL Editor → New query** → 이 저장소의 `supabase/schema.sql` 내용 **전체**를 붙여 넣고 **Run** → "Success"가 나오면 끝.
3. **키 3개 복사**: **Project Settings → API (또는 API Keys)**
   - **Project URL** → 예) `https://abcdefgh.supabase.co`
   - **anon public** 키 (새 화면에서는 *publishable* 키)
   - **service_role** 키 (새 화면에서는 *secret* 키) ← **절대 남에게 보이거나 올리면 안 되는 비밀 키**
4. **Google 로그인 허가증 만들기** (https://console.cloud.google.com)
   1. 새 프로젝트 만들기 (이름 예: `exam-site`)
   2. **APIs & Services → OAuth consent screen** (또는 *Google Auth Platform*) → 사용자 유형 **External** → 앱 이름·내 이메일 입력 → 저장
      - 범위(Scopes)는 기본값(email, profile, openid)이면 충분해요.
      - ⚠️ **"Publish app(프로덕션으로 게시)"을 꼭 누르세요.** 테스트 상태로 두면 내가 등록한 소수의 계정만 로그인되고 7일마다 풀려요.
   3. **Credentials → Create credentials → OAuth client ID** → 종류 **Web application**
      - **Authorized redirect URIs**에 추가: `https://<내 Supabase 주소>/auth/v1/callback`
        (Supabase의 **Authentication → Sign In / Providers → Google** 화면 맨 위에 "Callback URL"로 그대로 적혀 있어요)
      - Create → **Client ID**와 **Client secret** 복사
5. **Supabase에 Google 켜기**: **Authentication → Sign In / Providers → Google** → Enable → 위의 Client ID·Client secret 붙여 넣기 → Save.
6. **사이트 주소 알려 주기**: **Authentication → URL Configuration**
   - **Site URL**: ①에서 복사한 사이트 주소 (예: `https://final-materials.○○○.workers.dev`)
   - **Redirect URLs**: 같은 주소 뒤에 `/**` 를 붙여 추가 (예: `https://final-materials.○○○.workers.dev/**`)

## ③ Cloudflare에 비밀 값 넣기

Cloudflare → **Workers & Pages → final-materials → Settings → Variables and Secrets → Add**

| 이름 | 종류 | 값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | Anthropic API 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | ②-3의 service_role(secret) 키 |
| `SUPABASE_URL` | Text | ②-3의 Project URL |
| `SUPABASE_ANON_KEY` | Text | ②-3의 anon(publishable) 키 |
| `ADMIN_EMAILS` | Text | **내 구글 이메일** (여러 명이면 쉼표로) |

저장하면 자동으로 다시 반영돼요. 안 바뀌면 **Deployments → Retry/Deploy**를 눌러 주세요.

## ④ 첫 로그인

1. 사이트 주소로 접속 → **Google로 로그인** → `ADMIN_EMAILS`에 적은 내 계정으로 로그인
   → 자동으로 **관리자 + 승인** 처리되고, 메뉴에 **🛠 관리자**가 생깁니다.
2. 선생님들께 사이트 주소를 알려 주세요. 로그인하면 "승인 대기 중" 화면이 보이고,
   **🛠 관리자 → 👥 사용자**에서 **승인**을 누르면 그 화면이 자동으로 열려요. (대기 중인 사람이 있으면 메뉴에 빨간 숫자가 떠요)

---

## 관리자 화면에서 할 수 있는 일

- **👥 사용자**: 승인 / 거절·차단 / **삭제**(계정 + 사용 기록 + 저장된 문서 모두 삭제). 이번 달 사용 횟수·추정 요금 표시.
- **🧾 사용 기록**: 누가·언제·어떤 기능으로·어떤 문서를 변환했는지. 줄을 누르면 **올린 원본 문서 열기**, **결과물 보기**, AI 호출 횟수, 토큰, 추정 요금, 실패 이유가 보여요. 사용자·기능·월로 거를 수 있어요.
- **📈 통계**: 월별 합계, 사용자별(기능별 횟수·요금), 기능별.

## 알아 두세요

- **검색엔진 차단**: `robots.txt`, 응답 헤더, 메타 태그로 구글·네이버 등의 수집을 막아 둬요. 다만 이건 "정중한 요청"이라, 진짜 보호는 **로그인·승인**이에요. 주소는 선생님들께만 알려 주세요.
- **Supabase 무료 플랜**은 **1주일 동안 아무도 접속하지 않으면 프로젝트가 일시 정지**돼요 (Supabase 대시보드에서 "Restore"를 누르면 돌아와요). 방학 등으로 오래 안 쓸 때 주의하세요. 계속 안정적으로 쓰려면 유료(Pro) 플랜을 쓰면 됩니다.
- **개인정보**: 올린 시험지·학습지에 학생 이름이나 필기가 있을 수 있어요. 이 사이트는 그 문서를 **비공개 R2 저장소**에 보관하고 **관리자만** 볼 수 있어요. 필요 없어지면 관리자 화면에서 사용자를 삭제하면 문서도 함께 지워져요.
- **요금**: 관리자 화면의 요금은 토큰으로 계산한 **추정치**예요. 정확한 금액은 Anthropic Console → Usage에서 확인하세요.
- **예전 사이트**(`materials-auto-maker`)는 로그인이 없어요. 새 사이트가 잘 되는 걸 확인한 뒤 **그 Worker를 삭제하거나** 그곳의 `ANTHROPIC_API_KEY`를 지우세요. 그렇지 않으면 주소를 아는 누구나 내 AI 요금으로 쓸 수 있어요.

## 문제가 생기면

| 증상 | 원인 / 해결 |
|---|---|
| "서버의 로그인 설정이 아직 끝나지 않았어요" | ③의 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 가 비었거나 이름이 달라요 |
| 구글 화면에서 `redirect_uri_mismatch` | ②-4의 **Authorized redirect URIs**가 Supabase의 Callback URL과 달라요 |
| 구글 로그인 후 다시 로그인 화면으로 돌아와요 | ②-6의 **Site URL / Redirect URLs**가 실제 사이트 주소와 달라요 (`https://`, 끝의 `/**` 확인) |
| 나는 관리자인데 메뉴에 관리자가 없어요 | `ADMIN_EMAILS`에 쓴 이메일이 로그인한 구글 계정과 같은지 확인 (대소문자 무관) |
| 선생님이 "승인 대기"에서 안 넘어가요 | 관리자 화면에서 승인했는지 확인. 승인 후 20초 안에 자동으로 열려요 |
| 배포가 `R2 bucket not found`로 실패 | ①-2의 버킷 이름이 `final-materials-files`와 정확히 같은지 확인 |
| 사용 기록은 남는데 "저장 안 됨"으로 보여요 | R2 버킷 연결 문제. Worker → Settings → Bindings 에 `FILES`가 있는지 확인 |

## 개발자용: 내 컴퓨터에서 돌려 보기

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                   # http://localhost:3000  (Supabase Redirect URLs에 http://localhost:3000/** 도 추가)
```
테스트용으로 저장소 없이 돌리려면 `STORAGE_MODE=memory` (재시작하면 사라지는 메모리 저장소, 배포에서는 쓰지 마세요).
