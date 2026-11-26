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
- 무료 500MB를 지키려고 요청 원본은 저장하지 않고 5분·시간·하루 단위로 요약한다.

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
| create_request_id | uuid null | 깊게 보기 등록을 재시도할 때 같은 기능을 찾는 클라이언트 요청 ID. 앱 안에서 유일 |
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

### stats_1h — 시간별 요약 (기록 후 30일까지)
stats_5m과 같은 열, bucket = 1시간. 매일 Cron이 7일 지난 5분 요약을 앱·기능·버전·시간별로 합친다. 옮긴 행의 판정 입력(`private.evaluation_buckets`)은 외래 키로 함께 삭제한다. 평소 속도 계산은 경계 시각을 포함한 최근 7일의 성공 기록을 쓰고, 이전 성공 건수는 시간별 요약에서도 읽는다.

### stats_1d — 하루 요약 (한국 날짜 기준 1년)
stats_1h와 같은 집계 열·기본 키·조회 인덱스를 쓴다. 30일이 지난 시간별 행을 삭제하면서 반환받은 행만 앱·기능·버전·한국 날짜별로 더한다. bucket은 한국 시간 자정이며 1년 전 같은 날짜까지 포함한다. 회원은 자기 앱의 요약만 조회한다.

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
| metric_at_open, metric_worst | jsonb | 실패 판정은 total·failures·consecutive를 저장한다. 개설 당시 최근 3건이 연속 실패했는지는 metric_at_open.consecutive로 확인한다. 느림 판정에는 p50·baseline 등이 들어간다. |
| last_notified_at | timestamptz | |
| dismissed_until | timestamptz null | 문제 아님 → 24시간 |

### notifications — 알림 이력 (30일)
활성 채널마다 한 행을 만든다. 설정이 없으면 문제는 화면에서 확인한다. 대기와 완료 모두 등록 후 30일이면 정리한다.

| 열 | 형식 |
|---|---|
| id, incident_id, channel(`slack`/`email`), event(`open`/`worse`/`resolved`), queued_at, claimed_at, sent_at, ok, error | 선점 전 claimed_at은 null, 완료 전 sent_at·ok는 null |

`private.latest_results`는 해결 판정용 예외로 기능·버전별 최근 요청 결과 20건의 서버 수신 시각·묶음 내 순서·소요 시간·성공 여부를 최대 30일 보관한다. 깊게 보기 결과의 수신 시각은 `attempts.result_received_at`에 기록한다.

시험 알림은 incident_id 대신 test_app을 사용한다. claim_token은 매 선점마다 바뀌며 retries, available_at, digest에 재시도 횟수, 다음 선점 가능 시각, 묶음 여부를 기록한다.

### alert_channels — 알림 받을 곳 (회원 소유 앱 단위)
| 열 | 형식 | 설명 |
|---|---|---|
| app_id PK, owner_id | uuid | 기존 회원 설정은 소유한 각 앱에 복사 |
| slack_webhook_secret_id | uuid null | Vault에 암호화 저장된 webhook 주소 |
| slack_channel_name | text null | |
| slack_destination, broken, tested_at | text, bool, timestamptz | 워크스페이스·채널 식별자, 연결 끊김, 마지막 시험 요청 |
| email_enabled | bool default true | 새 앱에는 이메일을 켠 행을 생성하고, 기존 앱에서 누락된 행도 같은 값으로 보정 |

### ingest_batches — 중복 방지 (24시간)
| 열 | 형식 |
|---|---|
| app_id, batch_id PK, received_at | |

### feature_map_suggestions — 이름표 제안
| 열 | 형식 |
|---|---|
| id, app_id, method, route, name, received_at, applied bool | |

앱 등록은 회원당 3개로 제한한다. [20261126000000](supabase/migrations/20261126000000_feature_admission_settings_row.sql)은 자동 기능을 새로 수용할 때 설정 갱신 대상을 단일 정원 행으로 한정한다. [20261126100000](supabase/migrations/20261126100000_revoke_app_key.sql)은 아래 단일 키 폐기 RPC를 추가한다.

## 깊게 보기·앱 설정 회원 RPC

로그인한 소유자만 자기 앱의 기능을 관리한다.

| 함수 | 동작 |
|---|---|
| `save_deep_feature(p_app,p_feature,p_name,p_start,p_success,p_request_id)` | 추가할 때 p_feature는 null이며 같은 앱·요청 ID로 재시도하면 기존 기능과 feature_key를 반환한다. 수정할 때는 기능 ID를 지정하며 feature_key는 유지한다. |
| `delete_deep_feature(p_app,p_feature)` | 지정한 깊게 보기 기능과 종속 기록을 삭제한다. |
| `revoke_app_key(p_app,p_key)` | 로그인한 소유자의 앱 행을 잠그고 지정한 키의 폐기 시각을 기록한다. 이미 폐기한 키는 첫 폐기 시각을 유지한다. |

S11은 Worker의 `POST /v1/account/delete`를 호출한다. Worker는 Supabase Auth에서 세션 사용자를 확인하고 그 회원의 JWT와 RLS로 앱을 지운다. 앱 삭제의 외래 키와 알림 연결 삭제 트리거가 기록·키·알림 설정·Vault 비밀값을 함께 지운다. 이어서 Worker 비밀 설정의 관리자 키로 해당 Auth 사용자를 지운다. 마지막 단계가 실패해도 같은 회원이 다시 요청하면 남은 계정을 지울 수 있다.

## 수집·판정·알림 RPC
| 함수 | 하는 일 |
|---|---|
| `ingest_batch(app_key_hash, payload jsonb)` | 키 확인, 중복 묶음 무시, 버전·기능 등록, stats_5m upsert, 시도·오류 예시 저장. 결과 `{accepted, dropped}` |
| `suggest_feature_map(app_key_hash, items jsonb)` | 이름표 제안 저장 |
| `evaluate_all()` | 미확인 처리, 평소 속도 갱신(6시간마다), 문제 열기·다시 알림·해결·잠잠 판정 → 알림 보낼 목록 반환 |
| `record_notification(...)` | 알림 결과 기록 |
| `claim_notifications(limit)` | 등록 순으로 대기 행 선점. 잠긴 행은 건너뛰며 10분 지난 선점은 재시도 가능 |
| `complete_notification(id, token, ok, error)` | 현재 토큰으로만 완료. 일시 오류는 1·2·4분 후 재시도하고 오류의 URL·키를 가린다 |
| `slack_failed`, `connect_slack` | 현재 연결의 폐기를 확인해 이메일로 대체하거나 새 webhook을 Vault에 저장한다. 복호화 값은 서비스 전용 선점 RPC에서만 전달한다 |
| `reserve_mail(app)`, `defer_mail` | 앱 소유자를 기준으로 UTC 하루 회원 20건·전체 90건을 함께 예약한다. 초과분은 다음 UTC 자정(한국 오전 9시)부터 묶어 보낸다 |
| `notification_settings`, `set_notification_email`, `disconnect_slack`, `queue_test_notification` | 회원 세션으로 자기 앱의 설정 조회·변경 및 분당 한 번 시험 알림 예약 |
| `start_slack_state`, `consume_slack_state` | 로그인 회원의 앱에 일회용 OAuth state 발급 및 소비 |
| `dismiss_incident(incident_id)` | 회원이 자기 앱의 열린 문제를 24시간 숨기고 선점 전 대기 알림을 취소한다. 이미 닫힌 문제에 다시 호출하면 기존 상태를 유지한다 |
| `incident_verification(incident_id)` | 회원이 자기 앱의 문제 이후 버전과 연속 성공 수(0~5), 마지막 결과의 소요 시간·성공 여부를 조회한다. 느려짐 문제는 해결 속도 기준을 충족한 성공만 연속 횟수에 포함한다 |
| `cleanup_daily()` | 7일 지난 5분 요약 → stats_1h → 30일 후 stats_1d, 테이블별 보관 기간을 지난 행 삭제 |
| `issue_key(app_id, kind)` | 회원 호출 가능(본인 앱만): 키 생성, 해시 저장, 원문은 한 번만 반환 |

## 용량 어림 (무료 500MB)

`private.settings`의 단일 행에서 서비스 전체 활성 기능 상한(`active_feature_limit`, 기본 100)과 경보 기준(`size_alert_bytes`, 기본 300,000,000)을 조정한다. 수집한 기록의 DB 수신 시각을 `features.last_record_at`에 저장한다. 도입 시 최근 7일의 기록을 수신 시각순으로 정렬해 각 앱에서 최근 20개, 그중 전체 최근 100개 자동 기능의 활동 시각을 초기화한다. 이후 자동 기능의 새 기록은 같은 7일 기준으로 앱당 20개와 전역 100개 정원을 확인한다. 앱별 기타(`method='*'`)와 깊게 보기 기능은 이 정원에서 제외한다. 자동 기능의 정원 확인과 앱 등록은 같은 설정 행을 잠근다. 이름 제안이나 확인만으로는 자리를 쓰지 않는다. 깊게 보기 시도는 등록된 기능 ID로 시작과 결과를 짝짓는다.

`cleanup_daily()`는 정리 후 `pg_database_size(current_database())`를 측정한다. 기준을 넘으면 `private.ops_alerts`에 한국 날짜별로 측정 시각·사용 바이트·기준 바이트를 기록하고 같은 날 재실행하면 해당 행을 갱신한다. `grafana_reader`는 `public.ops_alerts` 뷰에서 조회한다.

앱 20개 × 기능 15개가 매 칸 쓰이고 기능당 버전은 `v1` 하나인 경우다. PostgreSQL 17에서 실제 테이블의 열·제약·인덱스를 복사한 빈 테이블에 시간순으로 300개 기능의 행을 삽입했다. 히스토그램은 정수 16칸이며 판정 행의 최솟값·최댓값도 채웠다. 표는 `pg_table_size`와 `pg_indexes_size` 실측값이다(1 MB = 1,000,000 B).

| 보관 데이터 | 행 수 | 테이블 MB | 인덱스 MB | 합계 MB |
|---|---:|---:|---:|---:|
| 5분 요약 7일 | 604,800 | 115.3 | 177.5 | 292.8 |
| 5분 판정 입력 7일 | 604,800 | 115.3 | 72.6 | 187.9 |
| 시간별 요약 (7~30일, 부분 시간 포함 최대 553칸/기능) | 165,900 | 31.6 | 36.3 | 67.9 |
| 하루 요약 (30일~1년, 윤년·부분 날짜 포함 최대 337칸/기능) | 101,100 | 19.3 | 20.5 | 39.8 |
| 일일 정리 직후 추정 | 1,476,600 | 281.5 | 306.9 | **588.4** |

다음 정리 직전까지 5분 요약과 판정 입력이 하루 더 쌓이면 같은 측정에서 **658.3 MB**였다. 기능 300개 상시 사용 조건에서는 정리 직후에도 무료 500 MB를 넘는다. 기타 테이블·삭제 후 남은 공간은 별도이며, 버전 길이·동시 버전 수·인덱스 페이지 점유율에 따라 실제 용량은 달라진다. 사용이 없는 칸은 행을 만들지 않으며 운영 경보는 300 MB다.

| 상시 사용 기능 수 | 일일 정리 직후 | 다음 정리 직전 |
|---|---:|---:|
| 300개 실측 | 588.4 MB | 658.3 MB |
| 상한 100개일 때 비례 추정 | 196.1 MB | 219.4 MB |

100개 행은 같은 기능·버전이 계속 쓰인다는 가정으로 300개 실측값을 3으로 나눴다. 기능 교체로 남는 과거 요약, 앱별 기타 묶음, 다른 테이블과 빈 페이지는 추가 공간을 쓴다.

## 운영자 읽기 전용 계정
- `public.ops_alerts`는 Grafana 운영자용 용량 경보 뷰다.
- `grafana_reader` 역할: stats·incidents·notifications·apps(이름 제외) SELECT만. Grafana Cloud는 Supabase 공유 연결(IPv4, 세션 모드)로 연결.
