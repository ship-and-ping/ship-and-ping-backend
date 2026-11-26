begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into apps(name) values('demo');
select set_config('test.hash',encode(sha256(convert_to(issue_key((select id from apps),'pub'),'UTF8')),'hex'),true);
insert into features(app_id,kind,feature_key,name) select id,'deep','deep'||i,'Deep' from apps,generate_series(1,5) i;
select throws_ok($q$insert into features(app_id,kind,feature_key,name) select id,'deep','six','Six' from apps$q$,'23514',null,'sixth deep feature rejected');
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/path'||i,'Auto' from apps,generate_series(1,200) i;
select throws_ok($q$insert into features(app_id,kind,method,route,name) select id,'auto','POST','/new','New' from apps$q$,'23514',null,'201st concrete route rejected');
select private.auto_feature((select id from apps),'GET','/overflow/123');
select private.auto_feature((select id from apps),'GET','/another/456');
select is((select count(*) from features where name='기타'),1::bigint,'overflow routes share one feature');

with fixture as (
 select jsonb_build_object('method','GET','route','/test','bucket',date_trunc('hour',now()),'total',1,'failures',0,
   'client_errors',0,'duration_sum_ms',40,'hist',array[1] || array_fill(0,array[15])) as row
)
select throws_ok(format('select ingest_batch(current_setting(''test.hash''),%L::jsonb)',
  jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v-invalid','stats',jsonb_build_array(bad))),
  code,null,description)
from fixture cross join lateral (values
  (row-'method','22023','missing aggregate field'),
  (row || '{"total":"1"}','22023','string count rejected'),
  (row || '{"duration_sum_ms":-1}','23514','negative duration rejected'),
  (row || jsonb_build_object('bucket',date_trunc('hour',now())+interval '1 second'),'23514','unaligned bucket rejected')
) examples(bad,code,description);
select is_empty($q$select version from app_versions where version='v-invalid'$q$,'invalid batches leave no version');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version',123,'stats','[]'::jsonb))$q$,'22023',null,'non-string version rejected');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version','v1'))$q$,'22023',null,'missing all record arrays');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version','v1','attempts','[{"type":"attempt_start"}]'::jsonb))$q$,
 '22023',null,'incomplete attempt is invalid rather than an unknown feature');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version','v1','error_samples',jsonb_build_array(jsonb_build_object('at',now(),'route','/path'))))$q$,
 '22023',null,'sample missing method rejected even after route limit reached');

create function pg_temp.attempt(kind text,source text,stamp timestamptz) returns jsonb language sql as $$
 select jsonb_build_object('app_version','v1','batch_id',gen_random_uuid(),'attempts',jsonb_build_array(jsonb_build_object(
   'type',kind,'feature_key','deep1','attempt_id','11111111-1111-4111-8111-111111111111','ts',stamp,
   'result','failure','source',source,'error_message','user@example.test','error_kind','Example')))
$$;
select throws_ok($q$select ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_result','server',now()))$q$,
  '22023',null,'public key cannot attest server result');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_start',null,now()) ||
  jsonb_build_object('app_id',gen_random_uuid()))$q$,'22023',null,'caller cannot select tenant');
select ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_start',null,now()-interval '11 minutes'));
select is(ingest_batch(current_setting('test.hash'),jsonb_set(pg_temp.attempt('attempt_start',null,now()),
  '{attempts,0,feature_key}','"unknown"')), '{"accepted":0,"dropped":1}'::jsonb,'unregistered feature counted as dropped');
select is(ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_start',null,now())),
  '{"accepted":0,"dropped":1}'::jsonb,'repeated start in another batch counted as dropped');
update attempts set status='unconfirmed';
select ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_result','browser',now()));
select results_eq('select status,source,duration_ms from attempts',$q$select 'failure'::text,'browser'::text,660000$q$,'late result completes unconfirmed attempt');
select is((select message from error_samples),'[가림]','attempt error sample masked');
select ingest_batch(current_setting('test.hash'),jsonb_set(pg_temp.attempt('attempt_start',null,now()-interval '10 minutes'),
 '{attempts,0,attempt_id}','"22222222-2222-4222-8222-222222222222"'));
select evaluate_all();
select is((select status from attempts where attempt_id='22222222-2222-4222-8222-222222222222'),'unconfirmed','pending at exactly ten minutes becomes unconfirmed');
select ingest_batch(current_setting('test.hash'),jsonb_set(jsonb_set(pg_temp.attempt('attempt_result','browser',now()),
 '{attempts,0,attempt_id}','"22222222-2222-4222-8222-222222222222"'),'{attempts,0,result}','"success"'));
select is((select status from attempts where attempt_id='22222222-2222-4222-8222-222222222222'),'success','late success replaces unconfirmed');
select is(private.mask('a%40example.test ?token=aaa&key=bbb&ACCESS_TOKEN=ccc&status=ok'),
  '[가림] ?[가림]','encoded email and complete query string masked');
select ingest_batch(current_setting('test.hash'),jsonb_build_object('batch_id',gen_random_uuid(),'app_version',' v1 ','stats','[]'::jsonb));
select results_eq('select version from app_versions',$q$select 'v1'::text$q$,'version trimmed before storage');
select suggest_feature_map(current_setting('test.hash'),'[{"method":"GET","route":"/items/123?query=private","name":"Items"}]');
select results_eq('select route,applied from feature_map_suggestions',$q$select '/items/:id'::text,false$q$,'suggestions normalize route and await confirmation');
select throws_ok(format('select suggest_feature_map(current_setting(''test.hash''),%L::jsonb)',items),'22023',null,description)
from (values
  ('{}'::jsonb,'map requires array'), ('[123]'::jsonb,'map requires objects'),
  ('[{"route":"/x","method":"GET"}]'::jsonb,'name required'),
  ('[{"route":"/x","method":"GET","name":true}]'::jsonb,'name must be a string'),
  ('[{"route":"x","method":"GET","name":"X"}]'::jsonb,'route requires leading slash'),
  ('[{"route":"/x","method":"GET","name":" "}]'::jsonb,'name must contain text'),
  (jsonb_build_array(jsonb_build_object('route','/'||repeat('r',200),'method','GET','name','X')),'route length limit'),
  (jsonb_build_array(jsonb_build_object('route','/x','method',repeat('A',33),'name','X')),'method length limit'),
  (jsonb_build_array(jsonb_build_object('route','/x','method','GET','name',repeat('a',301))),'name length limit'),
  ((select jsonb_agg(jsonb_build_object('method','GET','route','/path'||i,'name','X')) from generate_series(1,201) i),'201 suggestions rejected')
) examples(items,description);
select lives_ok($q$select suggest_feature_map(current_setting('test.hash'),
 (select jsonb_agg(jsonb_build_object('method','GET','route','/path'||i,'name','X')) from generate_series(1,200) i))$q$,'200 suggestions accepted');
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
  select app_id,id,'slow','open',now()-interval '40 days','v1' from features where feature_key='deep1';
select record_notification((select id from incidents),'email','open',true);
select record_notification((select id from incidents),'slack','open',false,
  'POST https://hooks.slack.com/services/example/fixture/placeholder returned 410');
select is((select error from notifications where not ok),'POST [가림] returned 410','notification omits webhook URL');
update notifications set sent_at=now()-interval '31 days';
update attempts set ended_at=now()-interval '31 days',started_at=now()-interval '32 days';
update error_samples set at=now()-interval '31 days';
update ingest_batches set received_at=now()-interval '25 hours';
select cleanup_daily();
select is((select count(*) from incidents),1::bigint,'old open incident remains');
select is_empty('select id from notifications','old notifications expire');
select is_empty('select attempt_id from attempts','old attempts expire');
select is_empty('select id from error_samples','old samples expire');
select is_empty('select batch_id from ingest_batches','old deduplication rows expire');
select * from finish();
rollback;
