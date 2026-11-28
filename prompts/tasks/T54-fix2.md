# 쉽앤핑 T54 마무리 — PR #51 (브랜치 feat/T54-profile-resources, 기준 ba04dd6 이후)
너는 Orca 작업 에이전트(Codex)다. 이전 작업자가 사용량 한도로 멈춰서 이어받는다. 아래 PR 브랜치에서 고치고 `git push origin HEAD:<브랜치>`로 올린다(강제 push 금지). **머지 금지.** Windows — Rust·DB는 CI(`gh pr checks`), 웹은 로컬.
명령은 경로를 그대로 하나씩(셸 변수·명령 치환·인터프리터 한 줄 실행 금지), 파일은 Read·Write(편집) 도구로. 먼저 `git log -5 --oneline`과 `prompts/tasks/`의 해당 지시문을 읽어 맥락을 잡는다.

## 남은 수정 (재현 테스트로 고정)
1. [중간] worker/src/telemetry.rs:69·76, supabase/migrations/20261128005400_server_records.sql:39·45 — 정상 이름 오탐(PyTorch·TensorFlow·NestJS·Socket.IO·spring-boot-starter-web·google-cloud-storage·Django REST framework). 대소문자 섞임·점·공백 이름 허용, 거부는 비밀값 모양(긴 무작위·알려진 접두사+충분한 길이·인코딩)일 때만. 흔한 패키지·프레임워크 이름 50개 이상 허용 테스트 + 기존 자격증명 거부 테스트 유지. Worker·DB 같은 규칙.
2. [중간] web/src/Chart.tsx:376·web/src/styles/dashboard.css:244 — 390px 주간 서버 카드 툴팁이 마지막 카드 위로 13px(200%에서 75px) 겹침 → T57 요약 카드 방식(390px은 카드 묶음 아래 고정 영역)과 같게.
3. [낮음] web/qa/fixtures.mjs:80 — server_series QA 모의 응답 추가.
(사건 구간 앞뒤 같은 분 측정값 포함은 분 해상도 설계로 수용 — 고치지 않음.)

## 끝나면
CI 6개 통과 확인 후 `orca orchestration worker_done`(커밋·바뀐 점).
