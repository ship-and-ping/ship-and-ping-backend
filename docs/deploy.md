# 쉽앤핑 운영 배포

## 1. 계정과 배포 권한 준비 · 사람

Cloudflare Workers Free 계정에서 workers.dev 하위 도메인을 선택한다. 운영 Worker 이름은 `ship-and-ping-ingest`다. Workers & Pages에서 **Direct Upload** 방식의 Pages 프로젝트를 만들고 운영 브랜치를 `main`으로 지정한다. 할당받은 Pages HTTPS 주소와 Worker HTTPS 주소를 기록한다.

계정 범위를 해당 계정 하나로 제한한 API 토큰 두 개를 발급한다. Worker용은 Account → Workers Scripts → Edit, Pages용은 Account → Cloudflare Pages → Edit를 선택한다. 두 무료 주소에는 Zone·DNS 권한이 필요 없다. Workers Free 한도는 계정 전체 하루 100,000요청과 Cron 5개, 호출당 CPU 10ms·서브요청 50개다. 운영 Cron 두 개는 하루 1,441회 예약되므로 같은 계정의 다른 Worker 사용량도 확인한다. [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/) · [Pages 배포용 권한](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

## 2. GitHub 및 Worker 설정 · 사람

GitHub 저장소 Settings → Environments에서 `production`을 만들고 배포 브랜치를 `main`으로 제한한다. 아래 이름으로 등록한다.

| 저장 위치 | 이름 | 용도 |
|---|---|---|
| GitHub 환경 Secrets | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_TOKEN`, `CLOUDFLARE_PAGES_TOKEN` | 대상 계정 및 각 배포 단계 인증 |
| GitHub 환경 Variables | `CLOUDFLARE_PAGES_PROJECT` | 앞에서 만든 Pages 프로젝트 이름 |
| GitHub 환경 Secrets | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | 동일 Supabase 프로젝트의 HTTPS 원점과 브라우저 공개 키 |
| GitHub 환경 Secrets | `VITE_INGEST_URL` | 3단계에서 확인한 Worker HTTPS 원점. 경로 제외 |

승인된 운영 Supabase에 해당 릴리스의 마이그레이션이 순서대로 적용됐는지 확인한다. Cloudflare에서 운영 이름으로 빈 Worker를 먼저 만든 뒤 Settings → Variables and Secrets에서 아래 일곱 항목을 **Secret**으로 등록하고 적용한다. 이 방식은 첫 Cron 실행 전에 바인딩을 준비한다. 운영에서 `INGEST_DRY_RUN`은 설정하지 않는다.

| Worker 비밀 이름 | 가져올 곳 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | 운영 프로젝트 URL과 서버 전용 Secret API key |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend 발송 키와 인증된 도메인의 발신 주소 |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack 앱 OAuth 자격 증명. Incoming Webhooks를 켜고 콜백에 Worker 원점의 `/v1/slack/callback`을 정확히 등록 |
| `WEB_ORIGIN` | 회원 화면의 운영 Pages HTTPS 원점 |

워크스페이스별 Slack webhook은 OAuth 설치 시 Supabase Vault에 저장된다. 웹 빌드의 세 `VITE_` 항목은 브라우저에 공개되므로 서버 키는 Worker에만 둔다.

## 3. Worker와 Pages 배포 · 사람

1. 운영 승인을 받은 뒤 GitHub Actions → **Deploy to Cloudflare** → Run workflow에서 `main`, `worker`를 선택한다. Workers & Pages에서 배포 버전과 workers.dev 주소를 확인한다. 호환 날짜는 `2026-11-24`다.
2. Worker의 Triggers에서 매분 `* * * * *`과 매일 UTC 00:15(한국 09:15) `15 0 * * *`를 확인한다. 첫 식은 `evaluate_all` 후 대기 알림을 발송하고, 두 번째 식은 `cleanup_daily`를 호출한다. [Cron 분기](../worker/src/cron.rs)
3. `VITE_INGEST_URL`에 확인한 Worker 원점을 넣고 같은 워크플로를 `main`, `pages`로 실행한다. 작업 디렉터리는 `web/`, 명령은 `npm ci`와 `npm run build -- --mode pages`, 업로드 폴더는 `web/dist/`다. Pages 모드는 두 서비스 원점을 검사해 CSP의 `connect-src`에 넣는다. 빌드 변수를 바꾸면 Pages를 다시 빌드·배포한다.

## 4. Supabase Auth 설정 · 사람

Authentication → URL Configuration의 **Site URL**에 운영 Pages 원점을 넣는다. Redirect URLs에는 같은 원점의 정확한 `/login`과 `/reset-password`를 등록한다. Google 제공자를 사용할 때는 Google OAuth 클라이언트에도 Supabase 콘솔에 표시된 콜백 URI를 등록한다.

이메일 제공자를 활성화하고 Custom SMTP에 인증된 발신자와 SMTP 자격 증명을 설정한다. Email Templates에서 Confirm signup과 Magic link의 버튼을 `<a href="{{ .ConfirmationURL }}">쉽앤핑 로그인</a>`로 설정한다. 확인 링크가 Supabase에서 검증된 후 앱이 요청한 `/login`으로 돌아온다. Reset password 양식도 복구 요청의 리디렉트를 보존하는 `{{ .ConfirmationURL }}`을 쓴다. 이 브랜치의 로그인 화면은 Google과 이메일 링크를 지원한다. 비밀번호 복구는 해당 화면과 복구 세션 처리가 출시된 뒤 시험한다.

T22가 포함된 릴리스에서는 `supabase/templates/`의 `confirmation.html`, `magic-link.html`, `recovery.html` 전문을 각각 Confirm signup, Magic link, Reset password에 붙여 넣는다. 시험 회원으로 가입 확인과 비밀번호 재설정 메일을 각각 열어 올바른 화면으로 돌아오고 새 비밀번호로 로그인되는지 확인한다.

## 5. 운영 확인 · 사람

- [ ] Pages에서 `/login`과 로그인 후 앱 상세를 직접 새로고침한다. 문서 응답이 200이고 CSP의 `connect-src`에는 실제 Supabase·Worker 원점만 있는지 확인한다. 시험 계정으로 이메일 링크와 Google 로그인을 각각 마친다.
- [ ] 시험 앱을 연결해 요청을 한 번 보낸 뒤 첫 기록 도착 시각과 기능 이름이 표시되는지 확인한다.
- [ ] 알림 설정에서 시험 Slack 채널을 연결하고 시험 알림 수신을 확인한다. 메일 경로도 시험해 실제 수신함에 한 통이 도착하는지 확인한다.
- [ ] **C5**. 회원 트래픽과 분리한 시험 구간에서 T10의 `batch()` 형식으로 현재 시각·새 묶음 ID를 사용한다. 요청 100건을 담은 ASCII JSON을 공백으로 채워 정확히 65,536바이트로 만든다. 시험 앱의 수집 키로 `POST /v1/ingest`를 두 번 보내고 매번 202, accepted 100, dropped 0을 확인한다. Worker 대시보드의 Metrics에서 같은 UTC 구간의 HTTP CPU Time과 CPU 초과 오류를 확인한다. 다른 호출과 섞이거나 두 호출의 CPU를 판별할 수 없으면 C5를 보류한다. 두 요청 각각 10ms 이내인지 확인하고 배포 버전·UTC 시각·측정치만 기록한다. 로컬 HTTP 왕복 시간에는 DB 대기가 포함된다. [T10 시험 입력](../scripts/t10-scenario.mjs) · [기존 측정 결과](verification/2026-11-26-T10.md)
- [ ] 마지막으로 폐기 가능한 시험 계정의 회원 설정에서 이메일을 확인하고 탈퇴한다. 로그인 세션 종료, 기존 수집 키의 401, Auth 계정 및 소유 앱 삭제를 확인한다.

## 6. 이전 배포로 복구 · 사람

배포 전에 정상 Worker 버전과 정상 Pages 프로덕션 배포 ID를 기록한다. 장애가 난 구성 요소부터 복구한다.

- **Pages** — 프로젝트 → Deployments에서 직전 정상 production 배포의 메뉴 → Rollback to this deployment를 선택한다. 운영 주소의 새로고침과 로그인을 다시 확인한다.
- **Worker** — Worker → Deployments에서 정상 버전의 메뉴 → Rollback을 선택한다. 적용된 버전, Cron 식, 바인딩 이름과 시험 앱의 수집 응답을 확인한다. [Worker 롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- Supabase 데이터·스키마와 외부 OAuth·SMTP 설정은 각각 관리한다. 먼저 이전 Worker와 현재 RPC의 호환성을 확인하고, DB 복원이 필요하면 별도 승인과 백업을 사용한다.
