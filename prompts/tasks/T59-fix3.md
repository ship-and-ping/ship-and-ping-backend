# 쉽앤핑 T59 마무리 — PR #54 (브랜치 feat/T59-queue-time, 7dae8ef 이후, 기준 T54)
너는 Orca 작업 에이전트(Codex)다. 이전 작업자가 사용량 한도로 멈춰서 이어받는다. 아래 PR 브랜치에서 고치고 `git push origin HEAD:<브랜치>`로 올린다(강제 push 금지). **머지 금지.** Windows — Rust·DB는 CI(`gh pr checks`), 웹은 로컬.
명령은 경로를 그대로 하나씩(셸 변수·명령 치환·인터프리터 한 줄 실행 금지), 파일은 Read·Write(편집) 도구로. 먼저 `git log -5 --oneline`과 `prompts/tasks/`의 해당 지시문을 읽어 맥락을 잡는다.

## 남은 수정
1. [높음] supabase/migrations/20261128005905_scoped_evaluation.sql:74 — 대기 표본 없이 열린 사건에 timing_basis가 빠져 05903_stall_recovery.sql:75가 현재 공용 기준선을 읽음. 재현: 핸들러 기준선 127ms에서 v1 700ms 10회로 개설 → 대기 포함 성공 1건 + v2 핸들러 700ms 5건 → 05904_scoped_baselines.sql:118이 공용 p95를 NULL로 바꾸고 05903:84가 5000ms 상한만 적용해 거짓 해결. 개설 당시 방식·기준선 값을 사건에 저장하고 해결 판정은 그것만 쓰게. 재현 테스트.
2. [중간] supabase/tests/evaluate_load.sql:38 — 30초 기준·단일 세션 → 서비스 RPC 기본 8초 시간 제한 안(첫 판정 5.19초 포함)인지, 동시 수집 쓰기와 겹칠 때 잠금 대기 확인 테스트. worker/src/cron.rs:28 순차 호출로 무응답 판정·알림이 늦어지면 판정 단계 시간 상한·로그.
3. origin/feat/T54-profile-resources의 최신 변경이 있으면 병합(rebase 아님)해 따라가기.
아직 미배포인 0059xx 파일 안에서 고쳐도 됨.

## 끝나면
CI 통과 확인 후 `orca orchestration worker_done`.
