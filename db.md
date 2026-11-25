---
title: 쉽앤핑 DB 설계
version: 1.0 (2026-11-25)
date: 2026-11-24
---

# 쉽앤핑 DB 설계 (Supabase PostgreSQL)

## 원칙
- 회원이 읽는 테이블은 모두 **행 수준 권한(RLS)**: `apps.owner_id = auth.uid()`인 앱과 그 하위 행만.
- 회원은 직접 쓰기를 최소로: 앱·기능 이름·알림 설정만. 기록·문제 테이블은 RPC(Worker의 `sb_secret_` 키)만 쓴다.
- 키·슬랙 webhook 같은 비밀값은 해시 또는 암호화(pgsodium/Vault)로만.
- 무료 500MB를 지키려고 요청 원본은 저장하지 않고 5분 요약만.

## 테이블

### apps — 등록한 앱
| 열 | 형식 | 설명 |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid → auth.users | 소유 회원 |
| name | text (1~40) | |
| url | text null | |
| first_record_at | timestamptz null | 첫 기록 시각(연결 확인) |
| created_at | timestamptz | |

### app_keys — 수집 키·서버 키
| 열 | 형식 | 설명 |
|---|---|---|
| id | uuid PK | |
| app_id | uuid → apps (삭제 시 같이 삭제) | |
| kind | text (`pub` / `srv`) | |
| prefix | text | 표시용 앞 8글자 |
| key_hash | text unique | SHA-256 |
| expires_at | timestamptz null | 재발급 시 24시간 뒤 |
| revoked_at | timestamptz null | |
- RLS: 회원은 prefix·kind·날짜만 조회(뷰), key_hash는 노출 안 함.

### features — 기능 (자동 + 깊게 보기)
| 열 | 형식 | 설명 |
|---|---|---|
| id | uuid PK | |
| app_id | uuid → apps | |
| kind | text (`auto` / `deep`) | |
| route | text null | auto: 주소 형태 (`/api/meetings/:id/join`) |
| method | text null | auto |
| feature_key | text null | deep: 전송에 쓰는 키 |
| name | text | 화면 이름 |
| name_source | text (`suggested` / `confirmed` / `route`) | 이름표 제안·확인 여부 |
| start_definition, success_definition | text null | deep만 |
| slow_threshold_ms | int default 5000 | 평소 속도 없을 때 기준 |
| hidden | bool default false | |
| created_at | timestamptz | |
- unique(app_id, method, route), unique(app_id, feature_key). deep은 앱당 5개(트리거로 검사). auto 주소 형태 앱당 200개.

### app_versions — 버전
| 열 | 형식 | 설명 |
|---|---|---|
| app_id, version | PK | |
| first_seen_at, last_seen_at | timestamptz | |

### stats_5m — 5분 요약 (7일)
| 열 | 형식 | 설명 |
|---|---|---|
| app_id, feature_id, version, bucket | PK | bucket = 5분 단위 시각 |
| total | int | 결과 건수 |
| failures | int | 5xx·예외 |
| client_errors | int | 4xx |
| duration_sum_ms | bigint | |
| hist | int[16] | 시간 구간별 건수(50ms·100·200·300·500·750ms·1·1.5·2·3·5·7.5·10·20·30s·그 이상) → 중앙값·90% 지점 근사 |
- 인덱스: (app_id, feature_id, bucket desc).

### stats_1h — 시간별 요약 (1년)
stats_5m과 같은 열, bucket = 1시간. 매일 Cron이 7일 지난 5분 요약을 앱·기능·버전·시간별로 합친다. 옮긴 행의 판정 입력(`private.evaluation_buckets`)은 외래 키로 함께 삭제한다. 평소 속도 계산은 경계 시각을 포함한 최근 7일의 성공 기록을 쓰고, 이전 성공 건수는 시간별 요약에서도 읽는다.

### attempts — 깊게 보기 시도 (30일)
| 열 | 형식 | 설명 |
|---|---|---|
| app_id, attempt_id | PK | |
| feature_id | uuid | |
| version | text | |
| started_at, ended_at | timestamptz | |
| status | text (`pending`/`success`/`failure`/`abandon`/`unconfirmed`) | |
| source | text null (`server`/`browser`) | |
| step, error_kind | text null | |
| duration_ms | int null | |

### error_samples — 오류 예시 (기능·버전별 최근 20개, 30일)
| 열 | 형식 |
|---|---|
| id, app_id, feature_id, version, at, error_kind, message(정제됨, ≤300자) | |

### baselines — 평소 속도
| 열 | 형식 | 설명 |
|---|---|---|
| feature_id PK | | |
| p50_ms, p90_ms | int null | null이면 아직 없음 |
| sample_count | int | |
| observed_min_ms, observed_max_ms | int | "지금까지 N건, a~b초"용 |
| computed_at | timestamptz | |

### incidents — 문제 (30일, 열린 문제는 보존)
| 열 | 형식 | 설명 |
|---|---|---|
| id | uuid PK | |
| app_id, feature_id | uuid | |
| kind | text (`failure`/`slow`/`unconfirmed`) | |
| status | text (`open`/`resolved`/`quiet`/`dismissed`) | |
| opened_at, closed_at | timestamptz | |
| opened_version | text | 문제 시작 때 버전 |
| resolved_version | text null | |
| metric_at_open, metric_worst | jsonb | 예: `{"total":24,"failures":6}` / `{"p50":3400,"baseline":1100}` |
| last_notified_at | timestamptz | |
| dismissed_until | timestamptz null | 문제 아님 → 24시간 |

### notifications — 알림 이력 (30일)
활성 채널마다 한 행을 만든다. 설정이 없으면 문제는 화면에서 확인한다. 대기와 완료 모두 등록 후 30일이면 정리한다.

| 열 | 형식 |
|---|---|
| id, incident_id, channel(`slack`/`email`), event(`open`/`worse`/`resolved`), queued_at, claimed_at, sent_at, ok, error | 선점 전 claimed_at은 null, 완료 전 sent_at·ok는 null |

`private.latest_results`는 해결 판정용 예외로 기능·버전별 최근 요청 결과 20건의 서버 수신 시각·묶음 내 순서·소요 시간·성공 여부를 최대 30일 보관한다. 깊게 보기 결과의 수신 시각은 `attempts.result_received_at`에 기록한다.

### alert_channels — 알림 받을 곳 (회원 단위)
| 열 | 형식 | 설명 |
|---|---|---|
| owner_id PK | uuid | |
| slack_webhook_secret_id | uuid null | Vault에 암호화 저장된 webhook 주소 |
| slack_channel_name | text null | |
| email_enabled | bool default true | |

### ingest_batches — 중복 방지 (24시간)
| 열 | 형식 |
|---|---|
| app_id, batch_id PK, received_at | |

### feature_map_suggestions — 이름표 제안
| 열 | 형식 |
|---|---|
| id, app_id, method, route, name, received_at, applied bool | |

## RPC 함수 (Worker 전용, `security definer`, 회원 실행 권한 없음)
| 함수 | 하는 일 |
|---|---|
| `ingest_batch(app_key_hash, payload jsonb)` | 키 확인, 중복 묶음 무시, 버전·기능 등록, stats_5m upsert, 시도·오류 예시 저장. 결과 `{accepted, dropped}` |
| `suggest_feature_map(app_key_hash, items jsonb)` | 이름표 제안 저장 |
| `evaluate_all()` | 미확인 처리, 평소 속도 갱신(6시간마다), 문제 열기·다시 알림·해결·잠잠 판정 → 알림 보낼 목록 반환 |
| `record_notification(...)` | 알림 결과 기록 |
| `claim_notifications(limit)` | 등록 순으로 대기 행 선점. 잠긴 행은 건너뛰며 10분 지난 선점은 재시도 가능 |
| `complete_notification(id, ok, error)` | 선점한 행의 발송 결과를 기록하고 오류에 포함된 URL과 민감 정보를 가린다 |
| `dismiss_incident(incident_id)` | 회원이 자기 앱의 열린 문제를 24시간 숨기고 선점 전 대기 알림을 취소한다. 이미 닫힌 문제에 다시 호출하면 기존 상태를 유지한다 |
| `incident_verification(incident_id)` | 회원이 자기 앱의 문제 이후 버전과 연속 성공 수(0~5), 마지막 결과의 소요 시간·성공 여부를 조회한다. 느려짐 문제는 해결 속도 기준을 충족한 성공만 연속 횟수에 포함한다 |
| `cleanup_daily()` | 7일 지난 5분 요약 → stats_1h, 테이블별 보관 기간을 지난 행 삭제 |
| `issue_key(app_id, kind)` | 회원 호출 가능(본인 앱만): 키 생성, 해시 저장, 원문은 한 번만 반환 |

## 용량 어림 (무료 500MB)
앱 20개 × 기능 15개가 매 칸 쓰이고 기능당 활성 버전은 하나라고 가정했다. PostgreSQL 17에서 버전 `v1`, 16칸 정수 히스토그램, 판정 행에 최솟값·최댓값이 있는 테스트 데이터를 넣고 각 테이블에서 `SELECT pg_column_size(t) FROM … AS t LIMIT 1`로 측정했다. MB는 100만 바이트다.

| 보관 데이터 | 행 수 계산 | 행 크기 | 행 용량 |
|---|---:|---:|---:|
| 5분 요약 7일 | 300 × 288 × 7 = 604,800 | 181 B | 109.5 MB |
| 5분 판정 입력 7일 | 300 × 288 × 7 = 604,800 | 180 B | 108.9 MB |
| 시간별 요약 (최근 1년 중 앞선 358일) | 300 × 24 × 358 = 2,577,600 | 181 B | 466.5 MB |
| 합계 (365일 기준, 일일 정리 직후) | 3,787,200 | | **684.9 MB** |

시간별 요약만 365일치로 계산하면 475.7 MB다. 실제 정리는 기록 시각 기준 1년이 지나면 지우므로 위 합계는 최근 7일을 시간별로 중복 계산하지 않았다. 5분 보관을 줄여도 기능 300개가 계속 쓰이면 행만으로 500 MB를 넘는다. 인덱스·페이지 여유 공간·기타 테이블과 다음 정리까지 쌓이는 행은 별도다. 사용이 없는 칸은 행을 만들지 않으며 DB 용량 운영 경보는 300 MB다.

## 운영자 읽기 전용 계정
- `grafana_reader` 역할: stats·incidents·notifications·apps(이름 제외) SELECT만. Grafana Cloud는 Supabase 공유 연결(IPv4, 세션 모드)로 연결.
