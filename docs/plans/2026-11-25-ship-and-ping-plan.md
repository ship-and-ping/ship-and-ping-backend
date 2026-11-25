---
title: 쉽앤핑 구현 계획
date: 2026-11-25
근거: PRD v1.1, 기능명세서 v1.0, db.md v1.0
---

# 쉽앤핑 구현 계획

## 레포 구조 (한 레포)
```
ship-and-ping-backend/
  PRD.md  README.md  CLAUDE.md  AGENTS.md  db.md
  prompts/           # v1, v2 …
  docs/specs/        # 기능명세서
  docs/research/     # 조사
  docs/위임로그/김태형.md
  worker/            # Rust, Cloudflare Workers (수집·판정·슬랙 콜백·키 발급)
  supabase/          # migrations, RPC 함수, RLS 테스트
  web/               # React (Cloudflare Pages)
  examples/          # 연결 확인용 예제 웹앱 2개(서버 있음/없음)
  .github/workflows/ # 테스트, 비밀값 검사
```

## 작업
| id | 작업 | 기능명세서 | 맡은 폴더 | 선행 | 병렬 |
|---|---|---|---|---|---|
| T1 | 레포 뼈대 + 제출 산출물 뼈대 + CI(비밀값 검사) | 10장·PRD 10장 | 루트 문서, `.github/` | — | — |
| T2 | Rust Worker PoC: JSON 묶음 수신·정제·합산, CPU 시간 측정 | 5장, C5 | `worker/` | T1 | T3과 병렬 |
| T3 | DB 스키마·RLS·RPC 함수·RLS 테스트 | db.md, C1 | `supabase/` | T1 | T2와 병렬 |
| T4 | 수집 Worker 완성(키 확인, 한도, 중복 방지, feature-map) | 2·4·5장, C3·C4 | `worker/` | T2, T3 | T5와 병렬 |
| T5 | 웹: 로그인·앱 등록·연결·기능 이름표 (S1~S4) — 디자인 가이드 절차 | 3장 | `web/` | T3 | T4와 병렬 |
| T6 | 판정 Worker(Cron) + `evaluate_all` 판정 함수 | 7장, C6~C8 | `worker/cron`, `supabase/` 판정 함수 | T4 | — |
| T7 | 웹: 앱 홈·기능 상세·문제 상세·AI 요청문 (S5~S7) | 3·6장 | `web/` | T5, T6 | — |
| T8 | 알림: 슬랙 OAuth·이메일(Resend) (S9, 8장) | 8장, C9 | `worker/notify`, `web/` 설정 화면 | T6, T7 | — |
| T9 | 깊게 보기 (S8, attempt) | 3·4·7장 | 전체 | T8 | — |
| T10 | 예제 웹앱 2개로 C1~C11 전체 확인, 정리 작업(C10) | 10장 | `examples/` | T9 | — |
| T11 | 제출 산출물 마무리(README 고른 메뉴 표·AI 사용 지도, 위임 로그) | PRD 10장, C12 | 루트 문서 | T10 | — |

## 사람이 해야 하는 일
| 일 | 언제까지 | 비고 |
|---|---|---|
| Cloudflare 계정(무료) + Workers·Pages 사용 | T2 측정 전 | 실제 CPU 시간 측정에 필요 |
| Supabase 프로젝트 생성(무료) | T3 배포 전 | 로컬 테스트는 계정 없이 |
| Resend 계정(무료) | T8 전 | |
| Google 로그인 설정(Google Cloud OAuth 클라이언트) | T5 배포 전 | |
| Slack 앱 생성 | T8 전 | |
| 비밀값은 Cloudflare·Supabase 비밀 설정에만 입력 | 각 단계 | 레포는 공개 |

## 위임 원칙
- 구현은 Codex(Astra 6.2 높음), 빌드·테스트가 무거운 Rust 작업은 Windows.
- 검증은 반대 모델(Claude reviewflow).
- 웹 화면 작업(T5·T7·T8 설정 화면)은 시작 전에 `docs/design-guide.md` 절차(시안 3개 → 사용자 선택).
- 작업마다 위임 로그 6칸과 `prompts/`에 지시문 저장.
