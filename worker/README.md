# 쉽앤핑 수집 Worker PoC

`POST /v1/ingest`는 한 앱·버전의 묶음을 읽어 주소·메서드·UTC 5분별 통계와 정제한 오류 예시, 깊게 보기 시도를 만든다. 본문은 65,536바이트, `records`는 100건까지 받는다.

## 설치와 실행

공식 rustup으로 설치한 stable Rust와 Node.js/npm, 벤치마크용 Python 3을 사용한다. 다음 명령은 `worker/`에서 실행한다.

```sh
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.9.0 --locked
cargo fmt --check
cargo clippy --locked -- -D warnings
cargo test --locked
worker-build --release
npx --yes wrangler@4.168.0 dev --local
```

다른 터미널의 `worker/`에서 아래 명령으로 현재 시각의 합성 묶음을 전송한다. 스크립트가 모든 응답의 `accepted=100`, `dropped=0`을 확인하고 HTTP 왕복 시간을 출력한다.

```sh
cargo build --release --example bench
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

기본 실행은 키 형식과 SHA-256을 확인하고 RPC 본문 직렬화까지 수행한다. 로컬 DB 연동 시 `.dev.vars.example`을 `.dev.vars`로 복사하고 두 값을 채운다. 모두 설정하면 `BatchSink`가 `/rest/v1/rpc/ingest_batch`에 `{app_key_hash,payload}`를 한 번 보내고 DB가 반환한 건수에 Worker에서 버린 건수를 반영한다. RPC의 401·400을 그대로 반환하고 연결 실패나 DB 5xx는 503으로 반환한다. 설정 하나만 채우면 500이다. 키 조회·캐시는 T4 범위다. 앱 식별, 중복 묶음 처리, 앱당 주소 200개 제한과 오류 예시 보관은 DB가 맡는다. RPC에는 요청 원본·원문 키가 들어가지 않는다.

측정 결과와 재현 절차는 [BENCH.md](BENCH.md)에 있다.
