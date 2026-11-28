# 쉽앤핑 운영 배포

## T32 기기 간 승인 적용 순서

1. Supabase에 `20261126400000_login_requests.sql`을 적용한다. Auth Redirect URLs에 운영 Pages 원점의 `/login/approve?req=*`를 추가하고 로그인·가입 확인 메일 양식을 갱신한다.
2. Worker에 같은 Supabase 프로젝트의 공개 키를 `SUPABASE_PUBLISHABLE_KEY`로 등록하고 배포한다. Worker는 이 키로 일반 OTP·가입 메일을 요청하며, 해당 메일의 복귀 주소에만 요청별 승인 값을 넣는다. `WEB_ORIGIN`은 운영 Pages 원점으로 설정한다. 기존 `SUPABASE_SECRET_KEY`를 교체하면 진행 중인 승인 요청은 새로 시작한다.
3. Pages를 배포한다. PC에서 메일 링크를 요청하고 휴대폰으로 확인해 두 기기에 각각 로그인되는지 확인한다. 새 요청을 거절해 PC 거절 화면도 확인한다.

## 1. 계정과 배포 권한 준비 · 사람

Cloudflare Workers Free 계정에서 workers.dev 하위 도메인을 선택한다. 운영 Worker 이름은 `ship-and-ping-ingest`다. Workers & Pages에서 **Direct Upload** 방식의 Pages 프로젝트를 만들고 운영 브랜치를 `main`으로 지정한다. 할당받은 Pages HTTPS 주소와 Worker HTTPS 주소를 기록한다.

계정 범위를 해당 계정 하나로 제한한 API 토큰 두 개를 발급한다. Worker용은 Account → Workers Scripts → Edit, Pages용은 Account → Cloudflare Pages → Edit를 선택한다. 두 무료 주소에는 Zone·DNS 권한이 필요 없다. Workers Free 한도는 계정 전체 하루 100,000요청과 Cron 5개, 호출당 CPU 10ms·서브요청 50개다. 운영 Cron 두 개는 하루 1,441회 예약되므로 같은 계정의 다른 Worker 사용량도 확인한다. [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/) · [Pages 배포용 권한](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

## 2. GitHub 및 Worker 설정 · 사람

GitHub 저장소 Settings → Environments에서 `production`을 만들고 배포 브랜치를 `main`으로 제한한다. Deployment protection rules의 **Required reviewers**에 운영 승인을 담당하는 사용자 본인을 지정한다. 본인이 수동 실행과 승인을 모두 담당하면 **Prevent self-review**를 해제한다. 아래 이름으로 등록한다.

| 저장 위치 | 이름 | 용도 |
|---|---|---|
| GitHub 환경 Secrets | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_TOKEN`, `CLOUDFLARE_PAGES_TOKEN` | 대상 계정 및 각 배포 단계 인증 |
| GitHub 환경 Variables | `CLOUDFLARE_PAGES_PROJECT` | 앞에서 만든 Pages 프로젝트 이름 |
| GitHub 환경 Secrets | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | 동일 Supabase 프로젝트의 HTTPS 원점과 브라우저 공개 키 |
| GitHub 환경 Secrets | `VITE_INGEST_URL` | 3단계에서 확인한 Worker HTTPS 원점. 경로 제외 |

승인된 운영 Supabase에 해당 릴리스의 마이그레이션이 순서대로 적용됐는지 확인한다. Cloudflare에서 운영 이름으로 빈 Worker를 먼저 만든 뒤 Settings → Variables and Secrets에서 아래 표의 필수 항목 다섯 개를 **Secret**으로 등록하고 적용한다. 이 방식은 첫 Cron 실행 전에 바인딩을 준비한다. 운영에서 `INGEST_DRY_RUN`은 설정하지 않는다.

| Worker 비밀 이름 | 가져올 곳 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | 운영 프로젝트 URL과 서버 전용 Secret API key |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend 발송 키와 테스트 발신 주소 `onboarding@resend.dev`. 수신자는 Resend 계정 소유자 메일로 제한된다 |
| `WEB_ORIGIN` | 회원 화면의 운영 Pages HTTPS 원점 |

슬랙 연결은 선택 사항이다. 나중에 Slack 앱의 Incoming Webhooks를 켜고 Worker 원점의 `/v1/slack/callback`을 등록한 뒤 `SLACK_CLIENT_ID`와 `SLACK_CLIENT_SECRET`을 운영 Worker Secret으로 추가하면 연결을 시작할 수 있다.

워크스페이스별 Slack webhook은 OAuth 설치 시 Supabase Vault에 저장된다. 웹 빌드의 `VITE_` 항목은 브라우저에 공개되므로 서버 키는 Worker에만 둔다.

### 홈 화면 앱 푸시를 처음 켤 때

저장소 폴더에서 개인 터미널로 `node scripts/generate-vapid.mjs`를 한 번 실행한다. 화면에 나온 두 줄에서 등호 오른쪽 값만 복사한다. 개인 키는 비밀번호처럼 보관한다. 사용자 구독은 생성 당시 공개키와 연결되므로 배포할 때마다 새 키를 만들 필요는 없다.

| 순서 | 설정할 곳 | 이름 | 붙여 넣을 값 |
|---|---|---|---|
| 1 | Cloudflare → Workers & Pages → 운영 Worker → Settings → Variables and Secrets → Add → Secret | `VAPID_PRIVATE_KEY` | 개인 키 |
| 2 | 같은 Worker의 Variables and Secrets → Add → Secret | `VAPID_PUBLIC_KEY` | 공개키 |
| 3 | GitHub 저장소 → Settings → Environments → production → Environment secrets → Add environment secret | `VITE_VAPID_PUBLIC_KEY` | 2번과 같은 공개키 |

T46(#44) 다음에 T49를 병합하고 Supabase 마이그레이션을 적용한다. 아래 3장의 순서대로 Worker, Pages를 배포한다. iOS 16.4 이상에서 Safari의 공유 버튼 → 홈 화면에 추가를 누른 뒤 홈 화면의 쉽앤핑을 열어 로그인한다. **알림 설정 → 푸시 켜기 → 허용 → 시험 푸시 보내기**를 누르고 다음 분에 알림을 확인한다. 시험 알림을 누르면 알림이 닫힌다. 실제 문제 알림을 누르면 해당 문제의 상세 화면이 열린다.

## 3. Worker와 Pages 배포 · 사람

1. 운영 승인을 받은 뒤 GitHub Actions → **Deploy to Cloudflare** → Run workflow에서 `main`, `worker`를 선택한다. Workers & Pages에서 배포 버전과 workers.dev 주소를 확인한다. 호환 날짜는 `2026-11-24`다.
2. Worker의 Triggers에서 매분 `* * * * *`과 매일 UTC 00:15(한국 09:15) `15 0 * * *`를 확인한다. 첫 식은 `evaluate_all` 후 대기 알림을 발송하고, 두 번째 식은 `cleanup_daily`를 호출한다. [Cron 분기](../worker/src/cron.rs)
3. `VITE_INGEST_URL`에 확인한 Worker 원점을 넣고 같은 워크플로를 `main`, `pages`로 실행한다. 작업 디렉터리는 `web/`, 명령은 `npm ci`와 `npm run build -- --mode pages`, 업로드 폴더는 `web/dist/`다. Pages 모드는 두 서비스 원점을 검사해 CSP의 `connect-src`에 넣는다. 빌드 변수를 바꾸면 Pages를 다시 빌드·배포한다.

## 4. Supabase Auth 설정 · 사람

Authentication → URL Configuration의 **Site URL**에 운영 Pages 원점을 끝 슬래시 없이 넣는다. Redirect URLs에는 같은 원점의 정확한 `/login`, `/install`, `/reset-password`를 등록한다. Email OTP 길이는 6자리, 만료는 600초, Token verifications는 IP당 5분에 10회로 설정한다. Google 제공자를 사용할 때는 Google OAuth 클라이언트에도 Supabase 콘솔에 표시된 콜백 URI를 등록한다.

홈 화면 앱의 6자리 코드는 Worker가 Resend로 보내고 DB에서 회원별로 10분·오답 5회·일회 사용을 강제한다. 올바른 코드가 소비된 뒤에만 Worker가 기존 회원용 Auth 해시를 발급하고 홈 화면 앱이 `verifyOtp(type=email)`로 세션을 받는다. 코드 메일 양식은 Worker 배포물에 포함된다. 운영에서 코드 발송과 시험 푸시를 확인하려면 두 T61 마이그레이션, Worker의 `WEB_ORIGIN`·`SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`RESEND_API_KEY`·확인된 `MAIL_FROM`, `VAPID_PRIVATE_KEY`·`VAPID_PUBLIC_KEY` 및 일치하는 Pages의 `VITE_VAPID_PUBLIC_KEY`가 필요하다.

이메일 제공자를 활성화하고 Custom SMTP에 Resend SMTP 자격 증명과 테스트 발신 주소 `onboarding@resend.dev`를 설정한다. Email Templates에서 `supabase/templates/`의 `confirmation.html`, `magic-link.html`, `recovery.html`을 각각 Confirm signup, Magic link, Reset password에 적용한다. 세 양식의 `{{ .ConfirmationURL }}`은 앱이 요청한 복귀 경로를 보존한다.

### 실제 사용자에게 메일을 보내기 전 · 사람

2026-11-26 결정에 따라 자체 도메인 연결은 나중에 진행한다. 실제 사용자에게 발송할 때는 Resend에 자체 도메인을 추가하고 Resend가 제시한 DNS 기록을 등록한다. 도메인 인증이 완료되면 Supabase Custom SMTP의 발신 주소와 Worker의 `MAIL_FROM`을 인증된 도메인의 발신 주소로 변경하고 별도 시험 수신함에서 Auth 메일과 알림 메일을 확인한다.

## 5. 운영 확인 · 사람

- [ ] 테스트 발신 주소를 쓰는 동안 가입 확인·비밀번호 재설정 메일은 **Resend 계정 소유자 메일로만** 확인할 수 있다. 그 주소로 시험 가입한 뒤 확인 링크가 요청 번호를 포함한 `/login/approve`로, 재설정 링크가 `/reset-password`로 돌아오는지 확인하고 새 비밀번호로 로그인한다.
- [ ] Pages에서 `/login`과 로그인 후 앱 상세를 직접 새로고침한다. 문서 응답이 200이고 CSP의 `connect-src`에는 실제 Supabase·Worker 원점만 있는지 확인한다. 시험 계정으로 이메일 링크와 Google 로그인을 각각 마친다.
- [ ] 시험 앱을 연결해 요청을 한 번 보낸 뒤 첫 기록 도착 시각과 기능 이름이 표시되는지 확인한다.
- [ ] 알림 설정에서 시험 Slack 채널을 연결하고 시험 알림 수신을 확인한다. 메일 알림은 Resend 계정 소유자 수신함에서 확인한다.
- [ ] **C5**. 회원 트래픽과 분리한 시험 구간에서 T10의 `batch()` 형식으로 현재 시각·새 묶음 ID를 사용한다. 요청 100건을 담은 ASCII JSON을 공백으로 채워 정확히 65,536바이트로 만든다. 시험 앱의 수집 키로 `POST /v1/ingest`를 두 번 보내고 매번 202, accepted 100, dropped 0을 확인한다. Worker 대시보드의 Metrics에서 같은 UTC 구간의 HTTP CPU Time과 CPU 초과 오류를 확인한다. 다른 호출과 섞이거나 두 호출의 CPU를 판별할 수 없으면 C5를 보류한다. 두 요청 각각 10ms 이내인지 확인하고 배포 버전·UTC 시각·측정치만 기록한다. 로컬 HTTP 왕복 시간에는 DB 대기가 포함된다. [T10 시험 입력](../scripts/t10-scenario.mjs) · [기존 측정 결과](verification/2026-11-26-T10.md)
- [ ] 마지막으로 폐기 가능한 시험 계정의 회원 설정에서 이메일을 확인하고 탈퇴한다. 로그인 세션 종료, 기존 수집 키의 401, Auth 계정 및 소유 앱 삭제를 확인한다.

## 6. 이전 배포로 복구 · 사람

배포 전에 정상 Worker 버전과 정상 Pages 프로덕션 배포 ID를 기록한다. 장애가 난 구성 요소부터 복구한다.

- **Pages** — 프로젝트 → Deployments에서 직전 정상 production 배포의 메뉴 → Rollback to this deployment를 선택한다. 운영 주소의 새로고침과 로그인을 다시 확인한다.
- **Worker** — Worker → Deployments에서 정상 버전의 메뉴 → Rollback을 선택한다. 적용된 버전, Cron 식, 바인딩 이름과 시험 앱의 수집 응답을 확인한다. [Worker 롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- Supabase 데이터·스키마와 외부 OAuth·SMTP 설정은 각각 관리한다. 먼저 이전 Worker와 현재 RPC의 호환성을 확인하고, DB 복원이 필요하면 별도 승인과 백업을 사용한다.
