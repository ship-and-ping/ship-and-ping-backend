# Supabase

## 로컬 실행

Docker 엔진을 실행한 뒤 Node.js 22 이상 환경에서 레포 루트에서 실행한다. CI도 같은 CLI와 PostgreSQL 17 이미지를 사용한다. 처음 실행할 때 Docker 이미지를 내려받는다.

```sh
npx --yes supabase@2.75.0 db start
npx --yes supabase@2.75.0 migration up --local
npx --yes supabase@2.75.0 test db --local
npx --yes supabase@2.75.0 stop
```

각 pgTAP 파일은 테스트 회원과 기록을 트랜잭션 안에서 만들고 롤백한다. 로컬 테스트 DB를 처음부터 다시 만들려면 `npx --yes supabase@2.75.0 db reset --local`을 실행한다. 이 명령은 해당 로컬 DB의 데이터를 지운다.

## Worker → ingest_batch

Worker는 `POST /rest/v1/rpc/ingest_batch`로 다음 JSON을 보낸다. `apikey` 헤더에는 Worker의 Supabase 비밀 키를 넣는다. `app_key_hash`는 수집 키 또는 서버 키 원문의 UTF-8 바이트를 SHA-256으로 해시한 소문자 16진수 64자리다. 예시의 자리표시자를 실제 해시로 바꿔야 한다.

```json
{
  "app_key_hash": "<SHA-256 hex>",
  "payload": {
    "batch_id": "10000000-0000-4000-8000-000000000001",
    "app_version": "release-7",
    "platform": "server",
    "sent_at": "2026-11-25T01:04:00Z",
    "stats": [{
      "method": "POST", "route": "/meetings/:id/join", "bucket": "2026-11-25T01:00:00Z",
      "total": 2, "failures": 1, "client_errors": 0, "duration_sum_ms": 125,
      "hist": [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    }],
    "attempts": [
      {"type":"attempt_start","feature_key":"join","attempt_id":"20000000-0000-4000-8000-000000000002","ts":"2026-11-25T01:03:00Z"},
      {"type":"attempt_result","feature_key":"join","attempt_id":"20000000-0000-4000-8000-000000000002","ts":"2026-11-25T01:03:02Z","source":"server","result":"success","step":null,"error_kind":null,"error_message":null}
    ],
    "error_samples": [{"method":"POST","route":"/meetings/:id/join","at":"2026-11-25T01:02:00Z","error_kind":"Timeout","message":"upstream timeout"}]
  }
}
```

| 필드 | 의미 |
|---|---|
| `batch_id`, `app_version` | 앱별 UUID로 중복을 막고 배포 버전을 등록한다. 앱은 키 해시에서 결정한다. |
| `stats` | UTC 5분 시작 시각·HTTP 메서드·정제한 주소 형태별 합계. `total`은 4xx 포함 전체, `failures`는 실패, `client_errors`는 4xx, `duration_sum_ms`는 전체 소요 시간 합이다. |
| `hist` | 상한(ms) 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000과 초과 구간. 각 상한을 포함하며 16칸의 합은 `total`이다. |
| `attempts` | 등록된 깊게 보기 기능의 시작·결과. 결과는 `success`, `failure`, `abandon` 중 하나다. `source=server`에는 서버 키가 필요하다. |
| `error_samples` | 정제한 오류 예시. 같은 앱·기능·버전의 최근 20건을 남긴다. |
| `platform`, `sent_at` | Worker가 전달하는 묶음 메타데이터. DB에는 집계와 시도, 정제한 예시만 보관한다. |

예시에서 `join`이 등록되어 있으면 응답은 `{"accepted":4,"dropped":0}`이다. 요청 합계와 반영한 시도만 건수에 포함한다. 미등록 기능의 시도는 `dropped`에 포함하고, 중복 묶음은 두 값 모두 0을 돌려준다. Worker에서 시간 범위를 벗어나 제외한 기록은 Worker가 최종 응답의 `dropped`에 더한다. 키가 없거나 폐기·만료되면 RPC가 HTTP 401(`PT401`)을 반환한다.

## 권한과 운영 적용

회원은 로그인 세션으로 자기 앱·기록을 읽고 `issue_key(app_id,kind)`를 호출한다. 키 목록은 `app_key_list`에서 조회한다. 동일 종류의 키를 다시 발급하면 기존 키의 유예 기간은 24시간이다. 회원이 편집할 수 있는 열은 앱 이름·주소, 기능 이름·숨김·느림 기준, 이메일 알림 설정이다. Slack OAuth 연동 시 서버에서 Vault에 webhook을 저장하고 설정 행에는 Vault UUID만 연결한다.

Worker 역할에 허용된 RPC는 `ingest_batch`, `suggest_feature_map(app_key_hash,items)`, `record_notification(incident_id,channel,event,ok,error)`, `cleanup_daily()`다. 매일 정리 작업이 마지막 함수를 호출해야 7일 지난 5분 요약이 시간별로, 30일 지난 시간별 요약이 한국 날짜별로 합쳐진다. 하루 요약은 1년간 보관한다. 운영자 지표는 로그인 권한을 별도로 할당하는 그룹 역할 `grafana_reader`로 읽는다.

운영자가 무료 Supabase 프로젝트를 만든 뒤 아래 순서로 적용한다. `PROJECT_REF`를 대시보드의 실제 프로젝트 참조로 바꾼다. dry run에서 대상과 네 개의 마이그레이션을 확인한 뒤 마지막 명령을 실행한다. [Supabase 마이그레이션 안내](https://supabase.com/docs/guides/deployment/database-migrations)

```sh
npx --yes supabase@2.75.0 login
npx --yes supabase@2.75.0 link --project-ref PROJECT_REF
npx --yes supabase@2.75.0 db push --dry-run
npx --yes supabase@2.75.0 db push
```

브라우저에는 `sb_publishable_` 키와 로그인 세션을 사용한다. `sb_secret_` 키는 Worker 비밀 설정에 둔다. [Supabase API 키 문서](https://supabase.com/docs/guides/getting-started/api-keys)
## T38 기능 지도 적용

1. `20261126500000_feature_map_names.sql`을 적용한다. 이름 출처 제약과 트리거를 바꾸고, 이전 값을 담을 비공개 표와 건수를 반환하는 RPC를 설치한다.
2. 별도 트랜잭션에서 `20261126500100_feature_map_backfill.sql`을 적용한다. 제안이 있는 앱에서 일치하는 `route` 자동 기능을 잠그고 이전 이름·출처를 백업한 뒤 이름을 바꾼다. 기존 `suggested`는 이전 스키마가 허용했던 제안 출처다. 기존 RPC는 제안을 별도 표에 저장했으며 기능의 출처를 `suggested`로 설정하지 않았다. 해당 출처가 이미 있는 행은 이름과 출처를 모두 보존한다.
3. `20261126500200_feature_map_lengths.sql`로 정제된 제안의 길이 제약을 적용한다. 앱별 제안이 최대 300개인지 확인하고 Worker, 웹 순서로 배포한다. 새 Worker는 DB의 건수 응답을 사용한다.

백필 검증에는 다음 두 조회를 사용한다. 두 번째 조회에서 상한을 넘긴 앱은 0개여야 한다.

```sql
select count(*) as backed_up_features from private.feature_map_name_backup;
select app_id,count(*) from public.feature_map_suggestions group by app_id having count(*)>300;
```

백필 이름을 되돌릴 때는 DB 관리자로 아래 갱신을 실행한다. 현재 이름과 출처가 백필 결과와 여전히 같은 행만 복구하므로 이후 회원이 바꾼 이름과 다른 AI 이름을 보존한다. 운영 확인을 마치면 별도의 정리 명령으로 7일이 지난 백업을 삭제할 수 있다.

```sql
update public.features f set name=b.previous_name,name_source=b.previous_source
from private.feature_map_name_backup b
where f.id=b.feature_id and f.name_source='ai' and f.name=b.applied_name;
```

```sql
delete from private.feature_map_name_backup where backed_up_at < now()-interval '7 days';
```
