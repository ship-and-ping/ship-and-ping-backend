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

두 엔드포인트 모두 Authorization의 Bearer 키로 인증한다. 브라우저는 OPTIONS 사전 요청 후 JSON을 application/json 또는 text/plain으로 보낼 수 있다. 본문에 key만 보내면 401이다. 페이지 종료 시 인증 헤더가 필요하므로 fetch의 keepalive 옵션을 사용한다.

POST /v1/feature-map은 route, method, name을 가진 배열을 받는다. 최대 200개이며 배열 전체를 검증하고 이름과 주소를 정제한 뒤 suggest_feature_map에 제안만 저장한다. 성공은 202와 accepted·dropped 건수, 개별 항목 오류는 400이다.

키 원문의 SHA-256 해시로 lookup_key_app(app_key_hash text)를 호출한다. 이 RPC는 앱 UUID 또는 미등록 키에 null을 반환해야 하며 service_role만 호출할 수 있어야 한다. 현재 Supabase 마이그레이션에 이 조회 함수가 없어 DB 담당 작업에서 추가해야 한다. 미설치 시 Worker는 503을 반환한다. 성공한 조회 결과만 isolate 메모리에 5분간 보관한다. 저장할 때마다 ingest_batch 또는 suggest_feature_map이 DB에서 lock_key로 키를 다시 검사한다. DB의 PT401은 401, 잘못된 입력 22023은 400, 그 밖의 DB 오류는 503이다.

두 경로는 앱별로 UTC 분당 20묶음, UTC 하루 2,000묶음의 한도를 공유한다. 검증된 묶음은 저장 직전에 한도를 사용한다. 초과하면 429와 다음 창까지의 초를 Retry-After에 담는다. isolate 재시작과 병렬 isolate 때문에 이 값은 근사치다.

SUPABASE_URL과 SUPABASE_SECRET_KEY가 모두 비어 있고 INGEST_DRY_RUN=true인 로컬 실행에서는 RPC를 생략하고 키 해시별로 한도를 센다. 나머지 설정 누락은 503이다.

측정 결과와 재현 절차는 [BENCH.md](BENCH.md)에 있다.
