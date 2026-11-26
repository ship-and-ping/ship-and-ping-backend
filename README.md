# Ship & Ping · 쉽앤핑

쉽앤핑은 비전공 제작자의 웹앱 전체를 지켜보고, 문제가 생긴 기능을 쉬운 한국어로 알려 주고, 업데이트 후 실제 사용 결과로 해결 여부를 확인하는 관리형 모니터링 서비스다.

브랜드 색은 미드나이트 퍼플 `#261B40`, 라벤더 `#C3A6FF`, 민트 `#76E7C4`다. 마스코트는 민트색 레이더 뿔이 달린 로봇 양이다.

## 실행 방법

### 수집·판정 Worker

레포 루트에서 다음 명령을 실행한다. Rust 버전과 타깃은 `worker/rust-toolchain.toml`에 고정돼 있다.

```sh
cd worker
rustup toolchain install
cargo test --locked
cargo install worker-build --version 0.9.0 --locked
worker-build --release
npx --yes wrangler@4.168.0 dev --local --var INGEST_DRY_RUN:true
```

이 모드에서는 DB 설정을 비워 두고 수집만 시험한다. DB에 연결해 저장·판정하려면 로컬 Worker에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 설정한다. 알림과 Slack 연결에는 `WEB_ORIGIN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`을 사용한다. 매분 판정과 알림까지 가짜 수신기로 확인하는 방법은 아래 T10 검사를 따른다. [Worker HTTP 통합 테스트](worker/README.md)

### Supabase 로컬 DB

Docker를 실행한 뒤 레포 루트에서 로컬 스택을 시작한다. 새 DB에는 `supabase/migrations/`의 SQL이 번호순으로 적용된다. 기존 로컬 DB에는 두 번째 명령으로 미적용 마이그레이션을 반영한다.

```sh
npx supabase@2.75.0 start
npx supabase@2.75.0 migration up --local
npx supabase@2.75.0 test db --local
```

DB만 필요한 CI는 첫 명령으로 `npx --yes supabase@2.75.0 db start`를 사용한다. [DB 워크플로](.github/workflows/db.yml)

### React 웹 화면

Node.js 24에서 `web/.env.local`을 만든다. 아래 값은 형식 설명용이다. `VITE_SUPABASE_URL`과 `VITE_INGEST_URL`에는 각각 Supabase와 Worker의 HTTPS 기본 주소를 넣는다. 로컬 Supabase의 기본 HTTP 주소나 HTTP Worker 주소를 넣으면 설정 안내가 표시된다. 로컬 서비스를 웹에 연결할 때도 HTTPS 주소가 필요하다. `VITE_SUPABASE_PUBLISHABLE_KEY`에는 `sb_publishable_`로 시작하는 해당 프로젝트의 브라우저용 공개 키를 넣고 개발 서버를 다시 시작한다. 아래 키는 자리표시자다.

```dotenv
VITE_SUPABASE_URL=https://database.example.invalid
VITE_SUPABASE_PUBLISHABLE_KEY=replace-with-local-public-key
VITE_INGEST_URL=https://ingest.example.invalid
```

레포 루트에서 다음을 실행한다. 개발 서버를 종료한 뒤 테스트와 화면 캡처를 실행할 수 있다.

```sh
cd web
npm ci
npm run dev
npm test
npm run qa:shots
```

화면 캡처는 자체 서버와 모의 응답을 사용한다. Windows에서는 Edge, 다른 환경에서는 설치된 Playwright WebKit 또는 Chrome을 사용하며 결과는 `docs/design/qa/after/`에 쓴다.

### 예제 앱 두 개로 일괄 확인

Docker, Python 3, Node.js, Rust, worker-build와 Chrome이 있는 환경에서 레포 루트의 `bash scripts/verify-local.sh`를 실행한다. Chrome 경로는 `CHROME_BIN`으로 지정할 수 있다. 서버가 있는 예제와 브라우저 전용 예제가 기록 수집부터 문제 해결까지 거치는 경로를 로컬에서 확인한다. [T10 검증 기록](docs/verification/2026-11-26-T10.md)

## 고른 메뉴 표

Q1~Q11은 PRD 8장의 제품 결정이고, D1~D4는 조사 후 확정한 구현 결정이다. 보관 방식과 모니터링 엔진은 PRD v1.1을 따른다. [PRD](PRD.md) · [기능명세서 0장](docs/specs/2026-11-24-ship-and-ping-feature-spec.md)

| 고른 것 | 다른 선택지 | 고른 이유 |
|---|---|---|
| Q1. 첫 연동은 웹앱 | Flutter 등 모바일 앱부터 지원 | 첫 버전에서 서버가 있는 웹앱과 브라우저만 쓰는 웹앱의 연결을 먼저 검증한다. |
| Q2. 저장 서버가 실제 성공을 보고하고, 서버가 없으면 브라우저가 저장 응답을 확인한 뒤 보고 | 버튼을 누를 때 성공으로 집계 | 신청을 시작한 시점과 명단에 실제 저장된 시점을 구별한다. |
| Q3. 최근 30분 결과 5건 이상에서 실패율 20% 또는 평소보다 2배 느리면 경보. 깊게 보기는 3건 연속 실패·미확인 급증도 감지. 새 버전에서 5건 연속 성공하면 복구 확인 | 오류가 날 때마다 알리거나 제작자가 기준을 개별 설정 | 적은 표본과 반복 알림을 줄이고 수정 효과를 실제 결과로 확인한다. 전체 조건은 PRD 5.4와 기능명세서 7장을 따른다. |
| Q4. 슬랙 우선, 슬랙을 쓰지 않으면 이메일. 화면에는 항상 표시 | 이메일 우선 또는 슬랙만 사용 | 제작자가 쓰는 채널에 알리면서 슬랙이 없는 회원도 문제를 알 수 있다. |
| Q5. 성공 30건 이상이고 첫 기록 후 3일이 지나면 최근 7일로 평소 속도 계산 | 첫 기록부터 평소 속도를 추정 | 초기에는 관측 건수와 실제 시간만 보여 주어 적은 기록을 기준으로 삼는 일을 피한다. |
| Q6. 5분 요약 7일 → 시간별 요약 30일 → 한국 날짜(KST)별 하루 요약 1년 | 요청 원본 보관 | 최근 문제는 세밀하게 확인하고 오래된 기록은 집계해 공간을 줄인다. [DB 설계](db.md) · [PR #14](https://github.com/ship-and-ping/ship-and-ping-backend/pull/14) |
| 베타 정원은 최근 7일 활성 자동 기능 전체 100개·앱당 20개, 회원당 앱 3개. DB 300 MB 초과 시 경보 | 자동 기능 300개 상시 사용 | 정리 직후에도 약 588 MB가 필요했다. 기타 묶음과 깊게 보기는 자동 기능 정원에서 제외한다. [용량 실측](db.md) · [PR #14](https://github.com/ship-and-ping/ship-and-ping-backend/pull/14) |
| Q7. 공개 레포 한 곳에 백엔드와 `web/` 배치 | 비공개 레포 또는 웹·백엔드 분리 | 개인 제출물에서 구현과 근거 문서를 함께 확인할 수 있다. |
| Q8. 앱 전체를 자동 감시하고 앱당 최대 5개 기능은 실제 성공까지 추적 | 제작자가 고른 기능 하나만 추적 | 예상 밖의 기능 장애도 찾고, 중요한 기능은 정상 응답 뒤에 발생한 저장 실패까지 확인한다. |
| Q9. 설정과 경보 기준을 맡는 관리형 서비스 | 제작자가 코딩 AI로 Grafana에 직접 연결 | 비전공 제작자도 그래프 해석 없이 어느 기능에 문제가 있고 고쳐졌는지 알 수 있다. |
| Q10. Rust Worker와 Supabase가 회원 앱을 판정하고 Grafana Cloud는 운영자가 쉽앤핑 자체를 관찰하는 데 사용 | Grafana Cloud를 회원용 엔진으로 사용(v1.0) | 조사에서 확인한 Grafana의 내부 운영 용도와 회원 대상 서비스를 구분한다. |
| Q11. Rust + Cloudflare Workers 무료 플랜 | Supabase Edge Functions | 제작자가 Rust를 선택했고 무료 베타 배포 환경을 Workers로 정했다. |
| D1. 수집·평소 속도·경보·해결 판정은 쉽앤핑이 담당 | Grafana의 서면 허용을 기다리거나 오픈소스 Grafana를 직접 운영 | 외부 허용 여부에 개발 일정이 달리지 않고 별도 서버 관리 비용도 줄인다. |
| D2. 전용 JSON으로 최대 100건씩 묶어 전송 | OpenTelemetry 표준 형식 | Rust Worker에서 검사·합산하기 쉬우며 무료 CPU 예산(요청당 10ms)에 맞는지 T2에서 실측할 수 있다. |
| D3. Resend 무료 플랜으로 알림·가입 이메일 발송(하루 100건) | 이메일 없이 슬랙·화면 알림만 제공 | 슬랙이 없는 회원을 위한 발송 채널이다. 현재 테스트 발신은 Resend 가입 메일 주소로만 전달된다. 도메인 연결은 나중에 하기로 했다(2026-11-26 사용자 결정). |
| D4. 이메일·비밀번호를 기본으로 하고 메일 링크를 유지한다. | Google과 메일 링크만 제공 | 2026-11-26 사용자가 “아이디·비밀번호 추가”를 선택했다. Google 로그인은 운영 제공 예정이다. 웹에는 Google OAuth 호출 코드가 있고 운영 Google 설정은 아직 남아 있다. [웹 인증 코드](web/src/data.ts) [T22 PR #20](https://github.com/ship-and-ping/ship-and-ping-backend/pull/20) |

## AI 사용 지도

| 단계 | 어느 AI | 맡긴 일 | 사람이 한 일 |
|---|---|---|---|
| 기획 · PRD | Claude Code 매니저 | 첫 버전의 범위와 결정 질문 정리 | 질문에 답하며 단일 기능 추적을 앱 전체 감시로 넓히고 관리형 서비스와 Rust 백엔드를 선택했다. |
| 무료 플랜 조사 | Claude Code 매니저·조사 에이전트 | 공식 문서에서 무료 한도·약관·연결 제약 조사 | 출처를 확인하고 조사 뒤 제시된 엔진 변경안을 채택했다. |
| 기능명세서·DB 설계 | Claude Code 매니저 | 화면·권한·판정·완료 조건과 DB 설계 작성 | 엔진·기록 형식·이메일·로그인의 네 가지 추천안을 확정했다. |
| [T1](https://github.com/ship-and-ping/ship-and-ping-backend/pull/1) | Codex Astra 6.2 | 제출 문서·CI | 제출물과 위임 로그 형식 지정 |
| [T2](https://github.com/ship-and-ping/ship-and-ping-backend/pull/2) | Codex Astra 6.2 | Rust 수집 PoC, 네이티브·Wasm 측정 | Rust와 Workers 무료 플랜 선택 |
| [T3](https://github.com/ship-and-ping/ship-and-ping-backend/pull/3) | Codex Astra 6.2 | DB 스키마·회원 격리·pgTAP | 회원은 자기 앱만 조회 |
| [T4](https://github.com/ship-and-ping/ship-and-ping-backend/pull/11) | Codex Astra 6.2 | 수집·키 폐기 확인·앱별 한도 | 앱 전체 자동 감시 |
| [T5](https://github.com/ship-and-ping/ship-and-ping-backend/pull/9) | Codex Astra 6.2 | 소개·로그인·앱 등록·연결 | PC 우선, 소개 화면 포함 |
| [T6](https://github.com/ship-and-ping/ship-and-ping-backend/pull/12) | Codex Astra 6.2 | 평소 속도·문제·새 버전 해결 판정 | 실제 사용 결과로 해결 확인 |
| [T7](https://github.com/ship-and-ping/ship-and-ping-backend/pull/13) | Codex Astra 6.2 | 앱 홈·문제 상세·AI 요청문 | 제작자가 AI에 붙여넣는 흐름 |
| [T8](https://github.com/ship-and-ping/ship-and-ping-backend/pull/15) | Codex Astra 6.2 | Slack·메일 발송과 설정 | Slack 우선, 메일 대체 |
| [T9](https://github.com/ship-and-ping/ship-and-ping-backend/pull/16) | Codex Astra 6.2 | 시작·저장 결과를 짝짓는 깊게 보기 | 중요 기능 최대 5개 |
| [T10](https://github.com/ship-and-ping/ship-and-ping-backend/pull/18) | Codex Astra 6.2 | 예제 2종 통합 검증. 교차 검수에서 빌드 시각 버전까지 가린 문제를 찾아 수정 | 서버형과 브라우저형 모두 검증 |
| [T21 완료](https://github.com/ship-and-ping/ship-and-ping-backend/pull/19) | Codex Astra 6.2 | 앱 설정·탈퇴. 응답 유실 때 탈퇴 결과를 오판해 계정 상태 재확인을 추가 | 내 계정과 회원 탈퇴 포함 |
| [T22 완료](https://github.com/ship-and-ping/ship-and-ping-backend/pull/20) | Codex Astra 6.2 | 이메일·비밀번호 가입·로그인·복구 구현. 1차 검수에서 인증 오류 안내와 복구 상태 처리 미통과. 수정 후 웹 테스트 208건·빌드·린트 및 재검증 통과 | 11월 26일 비밀번호 추가, 메일 링크 유지 |
| [S1](https://github.com/ship-and-ping/ship-and-ping-backend/pull/10) | Codex Astra 6.2 | 웹·SQL 정제 공통 사례 검증. 후속 변경은 T5·T4에 반영 | 개인정보·키 수집 금지 |
| [S2](https://github.com/ship-and-ping/ship-and-ping-backend/pull/14) | Codex Astra 6.2 | DB 용량 실측, 장기 요약과 정원 적용 | 무료 베타 용량 제한 |
| [D1](https://github.com/ship-and-ping/ship-and-ping-backend/pull/4) | Claude Code 디자인 작업자 | 사용 흐름과 시안 세 가지 | C안과 B안의 양 선택 |
| [D2](https://github.com/ship-and-ping/ship-and-ping-backend/pull/4) | Claude Code 디자인 작업자 | 화면·상태별 시안과 디자인 시스템 | 양 캐릭터를 가볍게 사용 |
| [D3](https://github.com/ship-and-ping/ship-and-ping-backend/pull/5) | Claude Code 디자인 작업자 · Codex 검수 | 대비·상태 검수 수정과 내 계정 시안 | 마이페이지 추가 |
| [D4](https://github.com/ship-and-ping/ship-and-ping-backend/pull/6) | Claude Code 디자인 작업자 · Codex 검수 | PC 레이아웃과 소개 페이지 | PC 우선 방향 선택 |
| [D5](https://github.com/ship-and-ping/ship-and-ping-backend/pull/7) | Claude Code 디자인 작업자 · Codex 검수 | 요청문에서 서버 키 분리, 앱 입력 가림·경고 | 요청문 안전 보강 승인 |
| [D6](https://github.com/ship-and-ping/ship-and-ping-backend/pull/17) | Codex Astra 6.2 · Claude Code 매니저 | 매니저가 1차 수정이 얕다고 판단해 2차를 요청했다. Codex가 정보 순서와 상태 전환 모션을 고치고 키보드 조작과 전후 화면을 검증했다. | 추천한 레퍼런스 3곳을 선택하고 쉽앤핑 색을 쓰기로 했다. 비교 페이지를 보고 병합을 결정했다. |
| 운영 설정 | Claude Code 매니저 | 원격 Supabase 마이그레이션 적용, 브라우저에서 Resend SMTP·인증 메일 양식 설정. 관련 산출물은 [로컬 검증 기록](docs/verification/), [인증 메일 양식](supabase/templates/), [설정 항목을 기록한 PR #20](https://github.com/ship-and-ping/ship-and-ping-backend/pull/20)에 있다. | Resend 테스트 발신을 유지하고 도메인 연결은 보류했다. |

구현 작업은 Claude Code 매니저가 분배하고 Claude reviewflow로 교차 검증했다. 위 표의 마지막 열은 각 작업에 적용한 사용자 결정이다. 작업별 검증 결과와 재작업은 [개인 위임 로그](docs/위임로그/김태형.md)에 기록했다.

## 문서 지도

- 서비스 범위와 제품 결정은 [PRD](PRD.md)에 있다.
- 화면·데이터·권한·완료 조건은 [기능명세서](docs/specs/2026-11-24-ship-and-ping-feature-spec.md)에 있다.
- 테이블·행 수준 권한·보관 기간은 [DB 설계](db.md)에 있다.
- 작업 순서와 의존성은 [구현 계획](docs/plans/2026-11-25-ship-and-ping-plan.md)에 있다.
- 매니저 요청과 구현 지시문은 [프롬프트](prompts/)에, 작업별 결과와 검증은 [위임 로그](docs/위임로그/)에 있다.
