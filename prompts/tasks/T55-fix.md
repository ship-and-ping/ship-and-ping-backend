# 쉽앤핑 T55 수정 — PR #49 검수 미통과 (f00c7db)

너는 Orca 작업 에이전트(Codex)다. 브랜치 `feat/T55-incident-types`(PR #49)에서 고치고 push. **머지 금지.** 먼저 최신 origin/main(T52 병합됨)을 이 브랜치에 병합하고 시작. Windows — Rust·DB는 CI(`gh pr checks 49`), 웹은 로컬.
명령은 경로를 그대로 하나씩(셸 변수·명령 치환·인터프리터 한 줄 실행 금지), 파일은 Read·Write(편집) 도구로. 지시문 원본: `prompts/tasks/T55.md`.

## 검수 지적 (각각 재현 테스트로 고정)
- [높음] web/src/issue-prompt.ts:90 — 자원 부족 요청문의 k6 확인이 사건 요청률로 즉시 5분 부하, 오류·지연 중단 조건 없음, 83줄은 DELETE까지 재생 → 로컬/스테이징만 대상 명시, 단계적 증가(낮게 시작), `thresholds`+`abortOnFail`로 오류율·p95 초과 시 자동 중단, 읽기(GET)만 재생, 운영 대상 금지 문장.
- [중간] worker/src/ingest.rs:720, 20261128005500_incident_diagnosis.sql:42 — 이름·메시지 없는 401·403이 인증 표본 0건 → 상태 코드만으로 ⑦ 근거.
- [중간] 같은 SQL:60 — HTTP_500+LookupError 5xx 두 건에서 상태 코드가 오류 클래스보다 먼저 선택돼 ③ 누락 → 클래스 이름 우선.
- [중간] 같은 SQL:66 — 내부 DB 단계 시간 초과 1건+오래된 버전만으로 ④ 외부 서비스 → 외부 호출 근거(external_ms 등) 있을 때만, 1건으로 판정 금지.
- [중간] web/src/incident-diagnosis.ts:19 — 재시작 시각을 버전으로 쓰는 앱도 ② 업데이트 후 고장 → 버전 형식이 커밋·semver일 때만 ②, 시각형이면 '재시작 후'로 낮은 확신.
- [중간] web/src/issue-prompt.ts:244 — silent(⑨)에 '새 버전 정상 5회' 안내, 실제는 같은 버전 신호 1회로 복구 → 종류별 해결 조건 문구.
- [중간] web/src/issue-prompt.ts:203 — 주 기능 이름에 강함 규칙 지시형 문구가 있어도 기본 복사문에 남음 → 기존 가림 규칙 동일 적용.

## 끝나면
CI 통과 확인 후 `orca orchestration worker_done`.
