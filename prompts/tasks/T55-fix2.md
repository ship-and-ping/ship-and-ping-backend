# 쉽앤핑 T55 마무리 — PR #49 (브랜치 feat/T55-incident-types, f7f971e 이후)
너는 Orca 작업 에이전트(Codex)다. 이전 작업자가 사용량 한도로 멈춰서 이어받는다. 아래 PR 브랜치에서 고치고 `git push origin HEAD:<브랜치>`로 올린다(강제 push 금지). **머지 금지.** Windows — Rust·DB는 CI(`gh pr checks`), 웹은 로컬.
명령은 경로를 그대로 하나씩(셸 변수·명령 치환·인터프리터 한 줄 실행 금지), 파일은 Read·Write(편집) 도구로. 먼저 `git log -5 --oneline`과 `prompts/tasks/`의 해당 지시문을 읽어 맥락을 잡는다.

## 남은 수정
1. [중간] web/src/issue-prompt.ts:155 — HTTP_500·502에 LookupError가 함께 있으면 ③ 분류는 맞지만 복사문 오류 표본에 상태 코드만 남음 → 클래스 이름 우선 표시(가림 규칙 유지). 이름·메시지 없는 401/403(⑦)은 표본이 '(내용 저장 안 함)'만 → 상태 코드·건수·시각 표시. 회귀 테스트.
2. [병합 차단] 최신 origin/main을 이 브랜치에 병합(rebase 아님). docs/위임로그/김태형.md 충돌 해결 — 547행부터의 T52 기록 4개가 595행부터 중복, 중복 제거. main에 들어간 T57·T58과 issue-prompt·Monitor 쪽 충돌도 정리.

## 끝나면
CI 통과 확인 후 `orca orchestration worker_done`.

## T56 병합

T55 최종 통과 — main(T56) 병합만

PR #49 60d6df1 최종 검수 통과. 그 사이 main에 T56(PR #50)이 들어가 web/src/issue-prompt.ts:45와 위임 로그가 충돌합니다. 최신 origin/main을 이 브랜치에 병합(rebase·강제 push 금지)해 충돌 해결: T56의 silent(기록 끊김) 조기 반환을 유지하되 web/src/Monitor.tsx:663이 읽는 diagnosis(T55 문제 종류)도 silent에서 보존되게. 두 쪽 테스트 모두 통과, PR CI 통과 후 push·worker_done(병합 커밋과 충돌 해결 요약).
