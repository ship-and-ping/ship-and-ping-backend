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
update attempts set status='unconfirmed';
select ingest_batch(current_setting('test.hash'),pg_temp.attempt('attempt_result','browser',now()));
select results_eq('select status,source,duration_ms from attempts',$q$select 'failure'::text,'browser'::text,660000$q$,'late result completes unconfirmed attempt');
select is((select message from error_samples),'[가림]','attempt error sample masked');
select suggest_feature_map(current_setting('test.hash'),'[{"method":"GET","route":"/items/123?query=private","name":"Items"}]');
select results_eq('select route,applied from feature_map_suggestions',$q$select '/items/:id'::text,false$q$,'suggestions normalize route and await confirmation');
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
  select app_id,id,'slow','open',now()-interval '40 days','v1' from features where feature_key='deep1';
select record_notification((select id from incidents),'email','open',true);
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
