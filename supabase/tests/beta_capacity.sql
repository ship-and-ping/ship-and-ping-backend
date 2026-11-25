begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
insert into auth.users(id) values('12000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
insert into apps(name) values('first'),('second');
insert into app_keys(app_id,kind,prefix,key_hash)
 select id,'pub','test',repeat(case name when 'first' then 'a' else 'b' end,64) from apps;
create function pg_temp.stats(request_path text) returns jsonb language sql as $$
 select jsonb_build_object('method','GET','route',request_path,'bucket',date_trunc('hour',now()),
  'total',1,'failures',0,'client_errors',0,'duration_sum_ms',1,'hist',array[1]||array_fill(0,array[15]),
  'timings',jsonb_build_array(jsonb_build_array(0,1,true)))
$$;
create function pg_temp.record(hash text, path text) returns jsonb language sql as $$
 select ingest_batch(repeat(hash,64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
   'stats',jsonb_build_array(pg_temp.stats(path))))
$$;
select matches(pg_get_functiondef('private.feature_admitted(uuid,uuid,timestamptz)'::regprocedure),
 'update\s+private\.settings\s+set\s+[^;]+\s+where\s+singleton\s*;',
 'quota update targets the singleton settings row as required by safeupdate');
select is(pg_temp.record('a','/route-1'), '{"accepted":1,"dropped":0}'::jsonb,
 'first admission accepts the record');
select pg_temp.record('a','/route-'||n) from generate_series(2,100) n;
select is(private.active_feature_count(),20::bigint,'one pub key can activate only 20 of 100 routes');
select is((select total from stats_5m join features on feature_id=id where method='*'),80,'80 routes share one overflow bucket');
-- Four other apps already occupy 79 slots.
insert into auth.users(id) select gen_random_uuid() from generate_series(1,4);
insert into apps(owner_id,name) select id,'seed' from auth.users where id<>auth.uid();
insert into features(app_id,kind,method,route,name,last_record_at)
 select id,'auto','GET','/seed-'||n,'seed',now() from
 (select id,row_number() over(order by id) pos from apps where name='seed') a
 cross join generate_series(1,20) n where pos<4 or n<20;
insert into features(app_id,kind,feature_key,name) select id,'deep','join','Join' from apps where name='first';
select ingest_batch(repeat('a',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
 'attempts',jsonb_build_array(jsonb_build_object('type','attempt_start','feature_key','join',
 'attempt_id',gen_random_uuid(),'ts',now()))));
select is(private.active_feature_count(),99::bigint,'deep activity leaves 99 auto slots occupied');
select suggest_feature_map(repeat('b',64),'[{"method":"GET","route":"/later","name":"Later"}]');
select is(private.active_feature_count(),99::bigint,'suggestion alone does not consume a slot');
select pg_temp.record('b','/hundred');
select is(private.active_feature_count(),100::bigint,'100th feature gets the last slot');
select pg_temp.record('b','/extra');
select pg_temp.record('b','/hundred');
select is(private.active_feature_count(),100::bigint,'101st route does not increase active count');
select is((select total from stats_5m join features on feature_id=id where method='*' and features.app_id=(select id from apps where name='second')),1,'overflow counts in 기타');
select is((select total from stats_5m join features on feature_id=id where route='/hundred'),2,'active traffic continues');
select is_empty($$select id from features where route='/extra'$$,'overflow route not created');
insert into features(app_id,kind,feature_key,name)
 select id,'deep',key,key from apps cross join (values('pay'),('cancel')) keys(key) where name='second';
create function pg_temp.deep(key text, event text) returns jsonb language sql as $$
 select ingest_batch(repeat('b',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
  'attempts',jsonb_build_array(jsonb_build_object('type',event,'feature_key',key,
  'attempt_id','20000000-0000-4000-8000-000000000002','ts',now(),'source','browser','result','success'))))
$$;
select is(pg_temp.deep('pay','attempt_start'),'{"accepted":1,"dropped":0}'::jsonb,'deep start accepted at global capacity');
select is(pg_temp.deep('cancel','attempt_result'),'{"accepted":0,"dropped":1}'::jsonb,'other deep key cannot finish this attempt');
select suggest_feature_map(repeat('b',64),'[{"method":"GET","route":"/extra","name":"Extra"}]');
select is_empty($$select id from feature_map_suggestions where route='/extra'$$,'full beta skips new suggestions');
select is(confirm_feature_names((select id from apps where name='second'),
 '[{"method":"GET","route":"/later","name":"Later","hidden":true}]'),
 '[{"method":"GET","route":"/later"}]'::jsonb,'confirm skips a previously suggested overflow route');
set local role authenticated;
select throws_ok($$insert into apps(name) values('third')$$,'PT409','beta capacity reached','registration refused');
reset role;
update features set last_record_at=now()-interval '7 days' where route='/hundred';
select is(private.active_feature_count(),100::bigint,'exactly seven days is active');
update features set last_record_at=last_record_at-interval '1 second' where route='/hundred';
select is(private.active_feature_count(),99::bigint,'older record releases its slot');
select is(pg_temp.deep('pay','attempt_result'),'{"accepted":1,"dropped":0}'::jsonb,'deep result remains paired');
select is((select feature_key from attempts join features on feature_id=id where attempt_id='20000000-0000-4000-8000-000000000002'),
 'pay','deep start and result stay on registered feature');
select lives_ok($$insert into apps(name) values('third')$$,'registration reopens');
select throws_ok($$insert into apps(name) values('fourth')$$,'23514','app limit reached','member quota still applies');
select pg_temp.record('b','/extra');
select pg_temp.record('b','/hundred');
select is((select total from stats_5m join features on feature_id=id where route='/hundred'),2,'dormant route over cap goes to 기타');
update features set last_record_at=now()-interval '8 days' where route='/extra';
select pg_temp.record('b','/hundred');
select is((select total from stats_5m join features on feature_id=id where route='/hundred'),3,'dormant route reactivates on original feature');
select is(private.active_feature_count(),100::bigint,'reactivation claims released slot');
update private.settings set active_feature_limit=101;
select ingest_batch(repeat('b',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
 'stats',jsonb_build_array(pg_temp.stats('/admitted'),pg_temp.stats('/still-full'))));
select is(private.active_feature_count(),101::bigint,'a larger configured cap admits exactly one more feature inside a batch');
select is_empty($$select id from features where route='/still-full'$$,'later item in same batch respects new cap');
select is((select size_alert_bytes from private.settings),300000000::bigint,'300 decimal MB threshold');
update private.settings set size_alert_bytes=9223372036854775807;
select cleanup_daily();
select is_empty('select * from private.ops_alerts','no alert below threshold');
update private.settings set size_alert_bytes=1;
select cleanup_daily();
select cleanup_daily();
select ok(has_table_privilege('grafana_reader','public.ops_alerts','select'),'Grafana role can read the view');
select is((select count(*) from public.ops_alerts),1::bigint,'Grafana reads one alert for repeated daily cleanup');
select ok((select database_bytes>threshold_bytes from public.ops_alerts),'alert records measured size and threshold');
select ok(not has_table_privilege('authenticated','public.ops_alerts','select'),'operator view restricted');
select * from finish();
rollback;
