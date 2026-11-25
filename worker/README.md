# 쉽앤핑 수집 Worker

`POST /v1/ingest`는 한 앱·버전의 묶음을 읽어 주소·메서드·UTC 5분별 통계와 정제한 오류 예시, 깊게 보기 시도를 만든다. 본문은 65,536바이트, `records`는 100건까지 받는다.

## 설치와 실행

rust-toolchain.toml로 고정한 Rust 1.99.1와 Node.js/npm, 벤치마크용 Python 3을 사용한다. 다음 명령은 `worker/`에서 실행한다.

```sh
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.9.0 --locked
cargo fmt --check
cargo clippy --locked -- -D warnings
cargo test --locked
worker-build --release
npx --yes wrangler@4.168.0 dev --local --var INGEST_DRY_RUN:true
```

다른 터미널의 `worker/`에서 아래 명령으로 현재 시각의 합성 묶음을 전송한다. 스크립트가 모든 응답의 `accepted=100`, `dropped=0`을 확인하고 HTTP 왕복 시간을 출력한다.

```sh
cargo build --release --example bench
python3 bench_http.py --ascii
python3 bench_http.py
```

HTTP 통합 테스트는 빌드된 Wasm과 로컬 가상 RPC를 사용한다. `worker-build --release` 후 실행한다.

```sh
npm install --prefix target/workerd --no-save workerd@1.20261123.1
cargo test --locked --test http -- --ignored
```

## 수신과 저장

공통 필드는 `spec="sp-1"`, UUID `batch_id`, `app_version`, `platform`, RFC 3339 `sent_at`, 배열 `records`다. 각 원소는 `type`으로 `request`, `attempt_start`, `attempt_result`를 구분한다. 요청은 대문자 HTTP 메서드와 정수 밀리초를 사용한다. HTTP 응답 전 예외는 `status=0`으로 표현한다. 4xx는 사용자 오류로만 세고 그 밖에 5xx·예외·오류 종류가 있는 요청은 실패로 센다. 히스토그램 각 구간은 상한을 포함한다.

키 형식 오류는 401, JSON·묶음 공통 필드 오류는 400, 상한 초과는 413이다. 개별 기록의 필드가 잘못됐거나 수신 시각 기준 ±24시간을 벗어나면 그 기록만 `dropped`에 더한다. 브라우저 키로 보낸 서버 출처 결과도 버린다.

두 엔드포인트 모두 Authorization의 Bearer 키로 인증한다. `/v1/ingest`에서 `text/plain` JSON은 헤더가 없을 때 최상위 `key`의 수집 키로도 인증한다. 브라우저는 페이지를 떠날 때 `sendBeacon`으로 보낼 수 있다. 본문으로 서버 키를 사용하면 400을 반환한다.

POST /v1/feature-map은 route, method, name을 가진 배열을 받는다. 최대 200개이며 배열 전체를 검증하고 이름과 주소를 정제한 뒤 suggest_feature_map에 제안만 저장한다. 성공은 202와 accepted·dropped 건수, 개별 항목 오류는 400이다.

Worker는 키의 SHA-256 해시로 `lookup_key_app`을 호출한다. `service_role`만 실행할 수 있고, 유효한 키의 앱 UUID 또는 null을 반환한다. isolate는 성공을 5분, 실패를 60초간 보관한다. UTC 분마다 실패한 인증 100회까지 허용하며 이후 새 조회 요청에 429를 반환한다. DB 장애는 503을 반환한다. 저장 RPC는 `lock_key`로 폐기·만료를 다시 검사한다.

두 경로는 앱별로 UTC 분당 20묶음, UTC 하루 2,000묶음의 한도를 공유한다. 검증된 묶음은 저장 직전에 한도를 사용한다. 초과하면 429와 다음 창까지의 초를 Retry-After에 담는다. isolate 재시작과 병렬 isolate 때문에 이 값은 근사치다.

SUPABASE_URL과 SUPABASE_SECRET_KEY가 모두 비어 있고 INGEST_DRY_RUN=true인 로컬 실행에서는 RPC를 생략하고 키 해시별로 한도를 센다. 나머지 설정 누락은 503이다.

측정 결과와 재현 절차는 [BENCH.md](BENCH.md)에 있다.

## 알림 발송과 슬랙 연결

| 환경값 | 쓰임 |
|---|---|
| WEB_ORIGIN | 회원용 Pages의 HTTPS 기본 주소. 문제 링크와 OAuth 복귀에 사용한다. |
| SLACK_CLIENT_ID | incoming-webhook 권한을 신청한 슬랙 앱의 클라이언트 ID |
| SLACK_CLIENT_SECRET | 코드 교환용 비밀값. Worker secret으로 등록한다. |
| RESEND_API_KEY | Resend 발송용 Worker secret |
| MAIL_FROM | Resend에서 인증한 도메인의 발신 주소 |

슬랙 앱에 Worker의 `/v1/slack/callback` HTTPS 주소를 등록한다. S9에서 로그인을 확인하고 연결을 시작하면 해당 탭과 회원 앱에 10분간 유효한 일회용 state가 생긴다. 연결 정보는 Vault에 저장한다.

매분 판정 후 최대 10개를 선점한다. 슬랙 메시지는 같은 워크스페이스·채널 단위로 합친다. 폐기된 연결은 다음 발송부터 로그인 이메일로 대신 보낸다. 이메일은 UTC 하루 전체 90회·회원당 20회까지 발송을 시도하고, 초과분은 다음 UTC 자정(한국 오전 9시)부터 수신자별로 모아 보낸다. 메일 비밀값이나 발신 주소가 없으면 이력에 ‘설정 필요’를 기록한다.
