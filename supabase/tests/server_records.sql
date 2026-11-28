begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000005401'),('00000000-0000-0000-0000-000000005402');
insert into apps(id,owner_id,name) select id,id,'test' from auth.users;
insert into app_keys(app_id,kind,prefix,key_hash) select id,'srv','test',repeat(right(id::text,1),64) from apps;
do $$
begin
 for i in 1..8 loop
   perform write_app_profile(repeat('1',64),jsonb_build_object('framework','Spring '||i));
 end loop;
 perform write_app_profile(repeat('1',64),'{"framework":"Spring 8"}');
end $$;
select is((select jsonb_array_length(history) from app_profiles),5,'only five previous versions survive');
select is((select history->0->'profile'->>'framework' from app_profiles),'Spring 7','identical profile preserves history');

select throws_ok($test$select write_app_profile(repeat('1',64),'{"metrics":"https://example.org"}')$test$,'22023','invalid profile','reject unsafe direct RPC');
select throws_ok($test$select write_app_profile(repeat('1',64),'{"services":[{"feature":"ok","name":"ok","kind":"ai","extra":0}]}')$test$,'22023','invalid profile','reject unknown nested fields');
select ok(not private.valid_resources('{"gc_pause_ms":-1}') and not private.valid_resources('{"mem_used_pct":101}'),'DB enforces resource bounds');

-- Same clock hour yesterday for one app, a different hour for its quiet neighbour.
insert into server_minutes select id,date_trunc('hour',now())-interval '1 day'
 -case right(id::text,1) when '2' then interval '6 hours' else interval '0' end,
 now()-interval '1 day','v1','{"mem_used_pct":81}' from apps;
insert into server_minutes select id,date_trunc('minute',now()-interval '9 minutes 59 seconds'),now()-interval '9 minutes 59 seconds','v1',null from apps;
select evaluate_silence();
select is((select count(*) from incidents where kind='silent'),0::bigint,'nine minutes and 59 seconds cannot open an incident');
update server_minutes set bucket=date_trunc('minute',now()-interval '10 minutes'),last_received=now()-interval '10 minutes'
  where last_received=now()-interval '9 minutes 59 seconds';
select evaluate_silence();
select evaluate_silence();
select is((select count(*) from incidents where kind='silent'),1::bigint,'opens once at ten minutes only during a historically active hour');
select is((select right(app_id::text,1) from incidents),'1','normally quiet app stays quiet');
select is((select count(*) from notifications where event='open'),1::bigint,'one opening notification');
create temporary table batch as select jsonb_build_object('batch_id',gen_random_uuid(),'platform','server',
 'app_version','v1','resources',jsonb_build_object('process_cpu_pct',0),'stats','[]'::jsonb,'attempts','[]'::jsonb,
 'error_samples','[]'::jsonb) payload;
select is((select ingest_batch(repeat('1',64),payload)->>'accepted' from batch),'1','resource-only heartbeat accepted');
select is((select ingest_batch(repeat('1',64),payload)->>'accepted' from batch),'0','retry ignored');
select is((select status from incidents),'resolved','heartbeat resolves without release change');
select is((select count(*) from notifications where event='resolved'),1::bigint,'one recovery notification');
select is((select ingest_batch(repeat('1',64),payload||jsonb_build_object('batch_id',gen_random_uuid(),
 'resources','{"process_cpu_pct":99}'::jsonb))->>'dropped' from batch),'1','excess minute sample reported as dropped');
select is((select resources->>'process_cpu_pct' from server_minutes where resources ? 'process_cpu_pct'),'0','second resource sample cannot overwrite first');
create temporary table timed_batch as select payload || jsonb_build_object('batch_id',gen_random_uuid(),
 'stats',jsonb_build_array(jsonb_build_object('method','GET','route','/status','total',2,'failures',0,'client_errors',0,
 'duration_sum_ms',40,'hist',array[2]||array_fill(0,array[15]),'bucket',date_bin('5 minutes',now(),'epoch'),
 'db_ms_count',1,'db_ms_sum',0,'external_ms_count',2,'external_ms_sum',15))) as payload from batch;
select ingest_batch(repeat('1',64),payload) from timed_batch;
select ingest_batch(repeat('1',64),payload) from timed_batch;
select is((select array[db_ms_sum,db_ms_count,external_ms_sum,external_ms_count] from feature_timing_5m),
 array[0,1,15,2]::bigint[],'timing totals count measured requests only and survive retries');
select is((select count(*) from feature_timing_5m t join features f on f.id=t.feature_id and f.route='/status'),1::bigint,
 'timings use the same feature as the request bucket');
insert into server_minutes select id,date_trunc('hour',now())-interval '8 days',now()-interval '8 days','v0','{"steal_pct":3}' from apps;
select rollup_server_hours();
select rollup_server_hours();
select is((select count(*) from server_hours),2::bigint,'hourly retention idempotent');

select ok(not has_function_privilege('authenticated','write_app_profile(text,jsonb)','execute')
 and not has_function_privilege('anon','server_series(uuid,timestamptz,timestamptz,integer)','execute')
 and not has_function_privilege('authenticated','evaluate_silence()','execute'),'write, read and cron roles restricted');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000005402';
select is((select count(*) from app_profiles),0::bigint,'other profile hidden');
delete from app_profiles;
select is((select count(*) from server_hours),1::bigint,'only own hourly row visible');
select is((select count(*) from feature_timing_5m),0::bigint,'other feature timing is hidden');
select is((select peaks->>'steal_pct' from server_series('00000000-0000-0000-0000-000000005402',
 now()-interval '9 days',now()-interval '7 days',1)),'3','owner reads an hourly peak');
select is((select count(*) from server_series('00000000-0000-0000-0000-000000005401',now()-interval '9 days',now(),1)),0::bigint,'cross-app series hidden');
select is((select count(*) from server_minutes where right(app_id::text,1)='1'),0::bigint,'cross-app minutes hidden');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000005401';
select is((select count(*) from app_profiles),1::bigint,'owner can read after foreign delete');
delete from app_profiles;
select is((select count(*) from app_profiles),0::bigint,'owner deletes profile and history together');
select * from finish();
rollback;
