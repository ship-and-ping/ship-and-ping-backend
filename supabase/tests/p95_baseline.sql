begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000046');
insert into apps(owner_id,name) select id,'T46' from auth.users;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,feature_key,name)
select id,'deep',label,label from apps cross join unnest(array['search','fast','cap','sparse','failure','slow']) label;

create function pg_temp.samples(label text, n int, ms int, age interval) returns void language sql as $$
 insert into attempts(app_id,feature_id,version,attempt_id,status,started_at,ended_at,duration_ms)
 select app_id,id,'v1',gen_random_uuid(),'success',now()-age-ms*interval '1 ms',now()-age,ms
 from features cross join generate_series(1,n) where name=label
$$;
select pg_temp.samples(name,27,case when name='fast' then 100 else 200 end,'12 hours') from features;
select pg_temp.samples(name,3,case when name='fast' then 100 else 400 end,'12 hours') from features;
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
 select app_id,id,name,'open',now()-interval '3 hours','v1' from features where name in ('failure','slow');
select pg_temp.samples(name,100,9000,'2 hours') from features where name in ('failure','slow');
select private.refresh_baselines();
select results_eq($$select sample_count,p50_ms,p95_ms from baselines join features on id=feature_id
 where name in ('search','failure','slow') order by name$$,
 'values (30,200,400),(30,200,400),(30,200,400)','one day suffices and both incident kinds exclude affected samples');
create temp view speeds as select name,breached,severity,metric from private.evaluation_signals s
 join features f on s.feature_id=f.id where s.kind='slow';
select pg_temp.samples('search',80,200,'20 minutes');
select pg_temp.samples('search',10,1400,'2 minutes');
select results_eq($$select breached,severity,(metric->>'baseline_p50')::int,(metric->>'baseline_p95')::int,
 (metric->>'window')::int,(metric->>'total')::int from speeds where name='search'$$,
 'select true,7::numeric,200,400,10,10','ten successes select the short window and report sevenfold severity');
update attempts set duration_ms=500 where duration_ms=1400;
select is((select breached from speeds where name='search'),false,'300 ms above baseline is insufficient');
update attempts set duration_ms=700 where duration_ms=500;
select is((select breached from speeds where name='search'),true,'exactly 500 ms above p50 qualifies');
select pg_temp.samples('fast',10,250,'1 minute');
select is((select breached from speeds where name='fast'),false,'100 to 250 ms remains normal');
update features set slow_threshold_ms=1000 where name='cap';
update baselines set p50_ms=1000,p95_ms=1500 where feature_id=(select id from features where name='cap');
select pg_temp.samples('cap',10,1100,'1 minute');
select is((select breached from speeds where name='cap'),true,'custom absolute limit overrides normal range');
select pg_temp.samples('sparse',9,1400,'2 minutes');
select pg_temp.samples('sparse',1,1400,'20 minutes');
select results_eq($$select breached,(metric->>'window')::int,(metric->>'total')::int from speeds where name='sparse'$$,
 'select true,30,10','nine recent successes use the longer window');
select * from finish();
rollback;
