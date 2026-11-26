# 쉽앤핑 작업 규칙

제품 결정을 확인할 때는 [PRD.md](PRD.md) → [기능명세서](docs/specs/2026-11-24-ship-and-ping-feature-spec.md) → [db.md](db.md) 순서로 읽는다. PRD 본문과 맨 위 v1.1 변경표가 다르면 변경표를 따른다.

## 레포 구조

| 경로 | 역할 |
|---|---|
| `worker/` | Rust로 작성한 Cloudflare Workers. 기록 수집·정제, 키 발급, 주기적 판정 호출, 알림을 담당한다. |
| `supabase/` | PostgreSQL 마이그레이션, RPC 함수, 행 수준 권한(RLS)과 테스트 |
| `web/` | React 회원 화면. Cloudflare Pages에 배포하고 Supabase Auth 세션으로 자기 앱을 조회한다. |
| `examples/` | 연결·검증용 웹앱 두 개(서버 사용 / 브라우저만 사용) |
| `docs/` | 기능명세서, 조사, 구현 계획, 개인 위임 로그 |
| `prompts/` | 매니저 요청 버전과 작업별 지시문 원문 |

## 명령

| 대상 | 실행 명령 |
|---|---|
| 제출 산출물 | 레포 루트에서 `bash scripts/check-deliverables.sh` |
| 비밀값 | Gitleaks CLI 설치 시 `gitleaks git --redact --no-banner`. PR의 `ci`에서도 검사한다. |
| Worker 빌드·실행·테스트 | `worker/`에서 `worker-build --release`, `npx --yes wrangler@4.168.0 dev --local --var INGEST_DRY_RUN:true`, `cargo test --locked`. HTTP 통합 테스트는 [Worker README](worker/README.md) 참고 |
| Supabase 로컬 실행·테스트 | Docker 실행 후 레포 루트에서 `npx supabase@2.75.0 start`, `npx supabase@2.75.0 migration up --local`, `npx supabase@2.75.0 test db --local` |
| 웹 실행·빌드·테스트 | `web/`에서 `npm ci` 후 `npm run dev`, `npm run build`, `npm test`. 화면 검사는 `npm run qa:shots` |

## 보안과 개인정보

- 실제 키, Slack webhook 주소, DB 비밀번호, `sb_secret_`로 시작하는 비밀 키, `.dev.vars`를 커밋하지 않는다. 예시에는 자리표시자만 쓰고 배포 비밀값은 Cloudflare·Supabase 비밀 설정에 넣는다.
- 모니터링에서 입력값(이름·전화·이메일), 요청·응답 본문, 쿠키·토큰, 쿼리 문자열, 주소 안의 실제 값, 사용자 계정 ID를 수집하지 않는다. 정제 규칙은 기능명세서 4.2~4.3을 따른다.
- 도구의 승인 절차를 우회하는 플래그를 사용하지 않는다. main에 직접 push하지 않는다.

## 브랜치·커밋·위임 기록

- 브랜치 이름은 `타입/T번호-내용` 형식으로 짓고 PR로 검토받는다. 예시는 `chore/T1-repo-skeleton`이다.
- 커밋은 `타입: 내용` 형식으로 쓰며 타입은 `feat`, `fix`, `docs`, `test`, `chore`, `refactor` 중에서 고른다.
- 맡은 지시문의 전문을 `prompts/tasks/T번호.md`에 저장한다. 작업을 마칠 때마다 [김태형 위임 로그](docs/위임로그/김태형.md)에 목표·프롬프트·결과·검증·수정·배운 점 여섯 칸의 표를 덧붙인다.
