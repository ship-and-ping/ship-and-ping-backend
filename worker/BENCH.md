# 64 KiB·100건 수집 성능

2026-11-25, macOS arm64에서 release로 측정했다. v1.3 정제 후 네이티브 중앙값은 3.472ms(이전 1.893ms), 로컬 HTTP 중앙값은 8.876ms(이전 5.001ms)였다. 네이티브 중앙값과 10ms의 차이는 8.107ms에서 6.528ms로 줄었다. **Cloudflare CPU 10ms 완료 조건(C5)은 미검증**이다.

| 측정 대상 | 조건 | 중앙값 | 최댓값 |
|---|---|---:|---:|
| 네이티브 처리 경과 시간 | 10회 예열 후 100회 | 3.472 ms | 6.496 ms |
| 로컬 Wrangler/workerd HTTP 왕복 | 10회 예열 후 100회, curl 새 연결 | 8.876 ms | 15.217 ms |
| Cloudflare 요청당 CPU | 사용자 계정·배포 필요 | 미측정 | 미측정 |

| release 파일 | 압축 전 | gzip (level 9) |
|---|---:|---:|
| `build/index_bg.wasm` | 1,603,607 B | 557,034 B |

## 입력과 재현

이전과 같은 65,536바이트·100건 구성에서 sk_ 뒤의 예시 값을 16자로 늘려 변경된 가림 기준을 충족시켰다. 100건 모두 500 오류로 구성해 NFKC 정규화와 이메일·전화·Bearer·sk_·JWT 가림과 300자 제한 경로를 실행한다. 20개 route에 숫자 ID·쿼리를 붙이며, JSON 뒤에 공백을 추가해 정확히 65,536바이트로 맞춘다. 입력 생성 시마다 현재 시각을 사용한다. 네이티브는 해시 계산, JSON 읽기, 필드 검사, 정제, 집계, RPC JSON 직렬화를 포함한다. HTTP 측정에는 요청 전송, workerd와 Wasm 실행, 응답 수신까지 들어간다. 로컬 Worker는 `INGEST_DRY_RUN=true`로 실행했다. 양쪽 모두 DB 설정을 비워 두었고 매회 100건 수락·0건 드롭을 검사했다. HTTP 왕복에는 연결과 I/O도 들어가므로 최댓값 15.217ms로 CPU 초과 여부를 판정할 수 없다. 반대로 예열 후 중앙값만으로 콜드 스타트도 보장할 수 없다. 약 1.60 MB의 Wasm 초기화와 첫 정규식 생성 비용을 포함한 배포 직후 첫 요청을 따로 측정해야 한다.

```sh
cargo run --release --example bench
worker-build --release
wc -c build/index_bg.wasm
gzip -9 -n -c build/index_bg.wasm | wc -c
npx --yes wrangler@4.168.0 dev --local --ip 127.0.0.1 --port 8787 --var INGEST_DRY_RUN:true
```

서버가 준비되면 다른 터미널의 `worker/`에서 같은 입력 생성기 `target/release/examples/bench --body`의 출력을 curl로 `/v1/ingest`에 순차 전송했다. 단건마다 새 연결로 `time_total`을 읽고 202와 건수를 확인했다. 기존 `python3 bench_http.py`는 연결을 재사용하는 비교 측정용이다. 기존 rustup 1.29.3, Rust/Cargo 1.99.1을 사용했다. wasm32-unknown-unknown 표준 라이브러리, rustfmt와 Clippy, worker-build 0.9.0을 설치했고 npx로 Wrangler 4.168.0을 받았다. worker crate는 0.9.0이다.

## 계정 준비 후 C5 측정

**T4 전에는 DB 환경값을 넣어 배포하지 않는다.** 수집 키 진위 확인·앱별 요청 한도(429) 구현이 남아 있다.

1. 무료 Workers 계정에서 `npx wrangler login` 후 전용 테스트 Worker에 `npx wrangler deploy`로 배포한다. 첫 회차는 격리된 테스트 배포에서만 DB 환경값을 비우고 `--var INGEST_DRY_RUN:true`를 붙인다. 일반 배포는 DB 설정이 빠지면 503을 반환한다.
2. `target/release/examples/bench --body` 출력을 HTTPS 클라이언트로 테스트 배포 주소의 `/v1/ingest`에 POST한다. Content-Type은 `application/json`, Authorization은 `bench_http.py`와 같은 예시 키를 사용한다. 첫 요청과 예열 후 100회 이상을 분리하고 HTTP 상태·수락 건수·측정 시간대를 기록한다.
3. Workers & Pages에서 해당 Worker의 Metrics를 열고 측정 시간대로 좁혀 **CPU Time per execution**의 p50·p99와 invocation status의 CPU 초과 건수를 확인한다. 요청별 최댓값은 해당 시간대 Workers Logs의 invocation CPU time에서 확인한다. [공식 지표 설명](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) · [무료 한도](https://developers.cloudflare.com/workers/platform/limits/)
4. T3·T4 연동 후 테스트 DB와 발급한 키를 연결하고, 중복 방지에 걸리지 않도록 매 호출의 batch_id를 새 UUID로 바꿔 다시 측정한다. 초기 요청과 상위 구간이 10ms를 넘거나 초과 종료가 있으면 50건·32 KiB로 상한을 낮춰 같은 조건에서 재측정한다.
