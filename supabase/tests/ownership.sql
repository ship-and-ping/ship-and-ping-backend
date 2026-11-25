begin;
-- Both members must be able to read their own row in every relation.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
-- Independent apps deliberately share every natural key (version, route and batch).
do $$
declare
  account uuid;
  app uuid;
  feature uuid;
  incident uuid;
begin
  for i in 1..2 loop
    account := ('00000000-0000-0000-0000-00000000000' || i)::uuid;
    insert into auth.users(id) values(account);
    insert into apps(owner_id,name) values(account,'demo') returning id into app;
    insert into features(app_id,kind,method,route,name) values(app,'auto','GET','/a','A') returning id into feature;
    insert into app_keys(app_id,kind,prefix,key_hash) values(app,'pub','sample',repeat(i::text,64));
    insert into app_versions(app_id,version) values(app,'v1');
    insert into stats_5m values(app,feature,'v1',date_trunc('hour',now()),1,0,0,1,array[1] || array_fill(0,array[15]));
    insert into stats_1h select * from stats_5m where app_id=app;
    insert into attempts(app_id,feature_id,attempt_id,version,started_at,status) values(app,feature,gen_random_uuid(),'v1',now(),'pending');
    insert into error_samples(app_id,feature_id,version,at,error_kind,message) values(app,feature,'v1',now(),'test','masked');
    insert into baselines(feature_id,sample_count) values(feature,0);
    insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version) values(app,feature,'slow','open',now(),'v1') returning id into incident;
    insert into notifications(incident_id,channel,event,ok) values(incident,'email','open',true);
    insert into alert_channels(owner_id,app_id) values(account,app);
    insert into ingest_batches(app_id,batch_id) values(app,account);
    insert into feature_map_suggestions(app_id,method,route,name) values(app,'GET','/a','A');
  end loop;
end $$;

create function pg_temp.check_visibility() returns setof text language plpgsql as $$
declare
  t text;
  identity_predicate text;
begin
  foreach t in array array['apps','app_keys','app_key_list','features','app_versions','stats_5m','stats_1h',
      'attempts','error_samples','baselines','incidents','notifications','alert_channels','ingest_batches','feature_map_suggestions'] loop
    identity_predicate := case
      when t in ('apps','alert_channels') then 'owner_id=auth.uid()'
      when t='baselines' then 'feature_id in (select id from features)'
      when t='notifications' then 'incident_id in (select id from incidents)'
      else 'app_id in (select id from apps)' end;
    return next results_eq(format('select count(*), count(*) filter (where %s) from %I',identity_predicate,t),
      'values (1::bigint,1::bigint)', t || ' visible rows belong to current member');
  end loop;
end $$;
-- Column grants on app_keys intentionally make SELECT * unavailable.

select set_config('test.other_app',(select id::text from apps where owner_id='00000000-0000-0000-0000-000000000002'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select * from pg_temp.check_visibility();
select is_empty($q$update apps set name='changed' where id=current_setting('test.other_app')::uuid returning id$q$,'other app update affects zero rows');
select is_empty($q$update features set hidden=true where app_id=current_setting('test.other_app')::uuid returning id$q$,'other feature update affects zero rows');
select is_empty($q$update alert_channels set email_enabled=false where owner_id='00000000-0000-0000-0000-000000000002' returning owner_id$q$,'other settings update affects zero rows');
select throws_ok($q$delete from features where app_id=current_setting('test.other_app')::uuid$q$,'42501',null,'feature deletion denied');
select throws_ok($q$delete from alert_channels where owner_id='00000000-0000-0000-0000-000000000002'$q$,'42501',null,'settings deletion denied');
select is_empty($q$delete from apps where id=current_setting('test.other_app')::uuid returning id$q$,'other app deletion affects zero rows');
select throws_ok('select key_hash from app_keys','42501',null,'hash hidden');
select ok(not exists(select from information_schema.columns where table_name='app_key_list' and column_name='key_hash'),'view omits hash');
select throws_ok('select issue_key(gen_random_uuid(),''pub'')','42501',null,'unowned app key denied');
select throws_ok(format('select issue_key(%L,''pub'')',current_setting('test.other_app')),'42501',null,'other member key denied');
select throws_ok('insert into stats_5m default values','42501',null,'direct ingest denied');
select ok(not has_table_privilege('authenticated',rel,'INSERT, UPDATE, DELETE'),rel || ' denies member writes')
from unnest(array['stats_5m','stats_1h','attempts','baselines','error_samples','incidents','notifications','ingest_batches','app_versions','app_keys','feature_map_suggestions']) rel;
select ok(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute'),p.proname || ' worker only')
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('ingest_batch','suggest_feature_map','record_notification','cleanup_daily');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select * from pg_temp.check_visibility();
select * from finish();
rollback;
