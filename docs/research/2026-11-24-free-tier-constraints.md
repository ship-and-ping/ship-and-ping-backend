---
title: 무료 플랜 기술 제약 조사
date: 2026-11-24
by: Claude Code 조사 에이전트 (공식 문서 직접 확인, URL 첨부)
---

# 무료 플랜 기술 제약 조사 (기능명세서 근거)

Rust 도구가 이 기기에 없어 wasm 빌드는 직접 시험하지 못했다. "확인 못 함"은 공식 문서에 없거나 커뮤니티 근거뿐인 항목.

## 1. Cloudflare Workers 무료
출처: https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/platform/pricing/
| 항목 | 한도 |
|---|---|
| 요청 | 하루 100,000건(UTC 0시 초기화, 넘으면 1027) — **계정 전체** |
| CPU | 요청당 **10ms**(Cron도). 네트워크·DB 대기는 제외 |
| 메모리 | 128MB |
| 서브요청 | 요청당 50개 |
| Cron Trigger | 계정당 5개 |
| Worker 크기 | 압축 전 64MiB, 시작 1초 이내 |
| waitUntil | 응답 후 30초 |
| KV | 읽기 하루 100k, 쓰기 하루 1k |
| D1 | 읽기 5M행/일, 쓰기 100k행/일, 5GB |
| Queues | 하루 10,000 operations |
| Hyperdrive | 무료 포함, 쿼리 하루 100k |

## 2. Rust on Workers
- `worker` 0.9.0, 1.0 전("rough edges"). Tokio 런타임 불가, `wasm32-unknown-unknown` crate만. `http` feature로 axum 연동 가능. https://github.com/cloudflare/workers-rs · https://developers.cloudflare.com/workers/languages/rust/
- OTLP/HTTP는 protobuf·JSON 둘 다 스펙에 있음(https://opentelemetry.io/docs/specs/otlp/). `opentelemetry-proto`(prost만)가 wasm32로 빌드되는지는 확인 못 함 → PoC 필요.

## 3. Rust Worker → Supabase
| 경로 | 판단 |
|---|---|
| Supabase REST(PostgREST) + `sb_secret_` 키, HTTP | wasm 위험 가장 낮음. 레거시 `anon`·`service_role` 키는 2026년 말 폐기 예정 → 새 키 사용. https://supabase.com/docs/guides/api/api-keys |
| Hyperdrive + tokio-postgres | 무료 포함이지만 Supabase 무료 Direct connection은 IPv6만, Hyperdrive의 IPv6 연결 여부 확인 못 함 |
| Supabase 무료 | DB 500MB, egress 5GB, MAU 50k, 프로젝트 2개, **1주 활동 없으면 일시정지** |

## 4. Grafana Cloud 무료
| 항목 | 한도 |
|---|---|
| 메트릭 | 활성 시리즈 10k, 14일 |
| 로그·트레이스 | 각 50GB/월, 14일 |
| 사용자 | 3명 |
| 알림 규칙 | 최대 500개 |
| 규칙 생성 API | `/api/v1/provisioning/...` — deprecated, `/apis/...`로 대체 예정 |
| webhook | HMAC-SHA256 서명 지원 |
| **이용약관** | 10조 "reverse engineer, **resell**, or duplicate the Service" 금지, 13.2조 라이선스는 "**personal use and/or internal business operations**". https://grafana.com/legal/terms/ → 무료 스택 하나에 여러 회원 앱을 받아 서비스로 제공하는 방식은 약관 위험 |

## 5. Slack
- `incoming-webhook` OAuth 설치 가능, URL은 비밀값. 무료 워크스페이스는 앱 10개 한도. 채널당 초당 1건. https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/ · https://slack.com/help/articles/115002422943

## 6. 이메일
| 수단 | 무료 조건 |
|---|---|
| Cloudflare Email Service | 무료 플랜은 **인증한 주소로만** 발송 → 회원 알림 불가 |
| Resend | 월 3,000건, **하루 100건** https://resend.com/pricing |
| Supabase Auth 기본 메일 | 시간당 2건, 팀원 주소만 → 운영 불가, 커스텀 SMTP 필요 |

## 7. Supabase Auth JWT
- ES256 비대칭 키 + JWKS(`/auth/v1/.well-known/jwks.json`), Edge 캐시 10분. 브라우저에는 `sb_publishable_` 키만. https://supabase.com/docs/guides/auth/signing-keys

## 설계 영향 요약
1. CPU 10ms → 수집 Worker는 가볍게(JSON, 작은 묶음), 무거운 계산은 DB 함수로.
2. 하루 10만 요청이 계정 전체 → 앱은 반드시 묶어 보내기, 앱별 상한.
3. **Grafana 무료 스택을 회원용 엔진으로 쓰면 약관 위험** → 결정 필요.
4. DB는 Supabase REST + 새 비밀 키.
5. 이메일은 Resend 무료(하루 100건) 외엔 무료 수단 없음.
6. Slack은 합쳐 보내기, 무료 워크스페이스 앱 10개 한도 안내.
7. Rust PoC를 첫 작업으로.
