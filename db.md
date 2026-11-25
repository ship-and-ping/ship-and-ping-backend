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

### stats_5m — 5분 요약 (30일)
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
stats_5m과 같은 열, bucket = 1시간. 매일 Cron이 30일 지난 5분 요약을 합쳐 옮긴다.

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
| 열 | 형식 |
|---|---|
| id, incident_id, channel(`slack`/`email`), event(`open`/`worse`/`resolved`), sent_at, ok, error | |

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
| `cleanup_daily()` | 30일 지난 5분 요약 → stats_1h, 오래된 행 삭제 |
| `issue_key(app_id, kind)` | 회원 호출 가능(본인 앱만): 키 생성, 해시 저장, 원문은 한 번만 반환 |

## 용량 어림 (무료 500MB)
- stats_5m 한 행 약 150바이트. 앱 20개 × 활성 기능 15개 × 하루 288칸(계속 쓰일 때 최댓값) × 30일 ≈ 260만 행 ≈ 390MB → **최댓값 기준으로 빠듯하다.** 실제 소규모 앱은 사용이 없는 5분 칸이 많아 훨씬 적지만, 운영자 경보를 DB 300MB에 둔다. 넘으면 5분 요약 보관을 14일로 줄이는 것을 사용자에게 묻는다.

## 운영자 읽기 전용 계정
- `grafana_reader` 역할: stats·incidents·notifications·apps(이름 제외) SELECT만. Grafana Cloud는 Supabase 공유 연결(IPv4, 세션 모드)로 연결.
