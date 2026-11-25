begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000006','auto');
insert into app_keys(app_id,kind,prefix,key_hash) select id,'pub','fixture',repeat('0',64) from apps;
create function pg_temp.batch(v text,good int,bad int,age interval) returns jsonb language sql as $$
 with events as (
  select now()-age-n*interval '1 millisecond' stamp,n>good failed,case when n>good then 7100 else 7000 end ms
  from generate_series(1,good+bad) n
 ), bins as (
  select date_bin('5 minutes',stamp,'epoch') bucket,count(*) total,count(*) filter(where failed) failures,
   sum(ms) duration_sum_ms,array_fill(0,array[11])||array[count(*)::int,0,0,0,0] hist,
   jsonb_agg(jsonb_build_array(stamp,ms,not failed)) timings from events group by 1
 )
 select jsonb_build_object('batch_id',gen_random_uuid(),'app_version',v,'stats',
  (select jsonb_agg(to_jsonb(bins)||jsonb_build_object('method','GET','route','/f','client_errors',0)) from bins))
$$;
select ingest_batch(repeat('0',64),pg_temp.batch('old',81,19,'5 minutes'));
update features set slow_threshold_ms=8000;
select is(evaluate_all(),'[]'::jsonb,'19 percent below failure threshold');
select is((select p50_ms from baselines),null::int,'81 successes before three days');
select results_eq('select sample_count,observed_min_ms,observed_max_ms from baselines','select 81,7000,7000','failed durations excluded');
select ingest_batch(repeat('0',64),pg_temp.batch('old',81,21,'4 minutes'));
-- 40 / 202 < 20%; two more failures cross the threshold.
select ingest_batch(repeat('0',64),pg_temp.batch('old',0,2,'3 minutes'));
select is(evaluate_all()->0->>'kind','failure','mixed bucket crosses threshold');
update incidents set opened_at=now()-interval '2 minutes';
select ingest_batch(repeat('0',64),pg_temp.batch('new',4,1,'30 seconds'));
select is(evaluate_all(),'[]'::jsonb,'new version ends with only four successes');
select ingest_batch(repeat('0',64),pg_temp.batch('new',1,0,'10 seconds'));
select is(evaluate_all()->0->>'event','resolved','fifth success in mixed bucket proves recovery');
select * from finish();
rollback;
