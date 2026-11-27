begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000006','auto');
insert into app_keys(app_id,kind,prefix,key_hash) select id,'pub','fixture',repeat('0',64) from apps;
create function pg_temp.batch(v text,good int,bad int,age interval) returns jsonb language sql as $$
 with events as (
  select now()-age-n*interval '1 millisecond' stamp,good+bad-n position,n>good failed,case when n>good then 7100 else 7000 end ms
  from generate_series(1,good+bad) n
 ), bins as (
  select date_bin('5 minutes',stamp,'epoch') bucket,count(*) total,count(*) filter(where failed) failures,
   sum(ms) duration_sum_ms,array_fill(0,array[11])||array[count(*)::int,0,0,0,0] hist,
   jsonb_agg(jsonb_build_array(position,ms,not failed) order by position) timings from events group by 1
 )
 select jsonb_build_object('batch_id',gen_random_uuid(),'app_version',v,'stats',
  (select jsonb_agg(to_jsonb(bins)||jsonb_build_object('method','GET','route','/f','client_errors',0)) from bins))
$$;
select ingest_batch(repeat('0',64),pg_temp.batch('old',81,19,'5 minutes'));
update features set slow_threshold_ms=8000;
select is(evaluate_all(),'[]'::jsonb,'19 percent below failure threshold');
select is((select p95_ms from baselines),7500,'81 recent successes establish a one-day baseline');
select results_eq('select sample_count,observed_min_ms,observed_max_ms from baselines','select 81,7000,7000','failed durations excluded');
select ingest_batch(repeat('0',64),pg_temp.batch('old',81,21,'4 minutes'));
-- Legacy mixed data must produce only the auto signal even when both inputs breach.
insert into attempts(app_id,feature_id,attempt_id,version,started_at,ended_at,status,source)
 select app_id,id,gen_random_uuid(),'old',now()-interval '1 second',now(),'failure','browser'
 from features cross join generate_series(1,5);
select is((select count(*) from private.evaluation_signals where kind='failure'),1::bigint,'one failure signal per mixed feature');
-- 40 / 202 < 20%; two more failures cross the threshold.
select ingest_batch(repeat('0',64),pg_temp.batch('old',0,2,'3 minutes'));
select is(evaluate_all()->0->>'kind','failure','mixed bucket crosses threshold');
insert into app_versions(app_id,version,first_seen_at,last_seen_at)
select id,'new',now()-interval '7 days',now()-interval '6 days' from apps;
update incidents set opened_at=now()-interval '2 minutes';
select ingest_batch(repeat('0',64),pg_temp.batch('new',4,1,'30 seconds'));
select is(evaluate_all(),'[]'::jsonb,'new version ends with only four successes');
select ingest_batch(repeat('0',64),pg_temp.batch('new',1,0,'10 seconds'));
select is(evaluate_all()->0->>'event','resolved','fifth success in reappearing older release proves recovery');
select ingest_batch(repeat('0',64),pg_temp.batch('new',0,5,'10 minutes'));
select results_eq($q$select count(*),bool_or(success) from
 (select success from private.latest_results where version='new' order by received_at desc,position desc limit 5) r$q$,
 'select 5::bigint,false','later receipt wins despite earlier client clocks');
select is((select count(*) from private.latest_results where version='old'),20::bigint,'per-version tail capped');
update private.latest_results set received_at=now()-interval '31 days' where version='old';
select cleanup_daily();
delete from incidents;
insert into attempts(app_id,feature_id,attempt_id,version,status,started_at,ended_at)
 select app_id,id,gen_random_uuid(),'old','failure',now(),now() from features cross join generate_series(1,3);
select lives_ok('select evaluate_all()','auto feature with attempts and failing stats evaluated once');
select is((select count(*) from private.evaluation_signals where kind='failure'),1::bigint,'auto feature has one failure signal');
select is((select count(*) from private.latest_results where version='old'),0::bigint,'tail expires by receipt');
select * from finish();
rollback;
