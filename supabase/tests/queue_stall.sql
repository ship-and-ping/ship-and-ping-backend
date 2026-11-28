begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000059');
insert into apps(id,owner_id,name) select id,id,'Trova' from auth.users;
insert into app_keys(app_id,kind,prefix,key_hash) select id,'srv','test',repeat('9',64) from apps;

-- Replay aggregate batches through the same RPC as the Worker. Each normal
-- second has four completions. The disturbance starts off the 10-second grid.
create temporary table replay as
with anchor as (select date_trunc('minute',now())-interval '23 seconds' stamp),
traffic as (
 select route, stamp+sec*interval '1 second' at_time,
   case when route='/quiet' then 1 else 4 end n,
   case when route='/legacy' then 127 when sec%16=0 then 1934 else 560 end ms, false interrupted
 from anchor cross join generate_series(-190,-1) sec
 cross join unnest(array['/places','/legacy','/quiet']) route
 where route<>'/quiet' or sec%5=0
 union all
 select route,stamp+sec*interval '1 second',case when route='/quiet' then 1 when sec=9 then 16 else 12 end,
   10001,true from anchor cross join generate_series(0,9) sec
 cross join unnest(array['/places','/quiet']) route where route<>'/quiet' or sec<3
), rows as (
 select *,date_bin('5 minutes',at_time,timestamptz 'epoch') bucket from traffic
)
select jsonb_build_object('batch_id',gen_random_uuid(),'app_version','3e66a68','platform','server',
 'attempts','[]'::jsonb,'error_samples','[]'::jsonb,'stats',jsonb_build_array(jsonb_build_object(
 'method','GET','route',route,'bucket',bucket,'total',n,'failures',case when interrupted then n else 0 end,
 'client_errors',0,'duration_sum_ms',n*ms,
 'hist',array(select case when i=private.duration_bin(ms,16) then n else 0 end from generate_series(1,16) i),
 'timings',(select jsonb_agg(jsonb_build_array(i,ms,not interrupted)) from generate_series(1,n) i),
 'queue_ms_sum',case when route='/places' and ms=560 then 433*n else 0 end,
 'queue_total_ms',case when route='/places' and ms=560 then ms*n else 0 end,
 'queue_count',case when route='/places' and ms=560 then n else 0 end,
 'flow',case when route='/legacy' then '{}'::jsonb else jsonb_build_object(
   extract(epoch from at_time)::bigint::text,jsonb_build_array(case when interrupted then 0 else n end,
   case when interrupted then n else 0 end)) end))) payload
from rows;
do $$declare b jsonb; begin for b in select payload from replay loop
 perform ingest_batch(repeat('9',64),b);
end loop; end$$;
select ingest_batch(repeat('9',64),payload) from replay limit 1;
update features set slow_threshold_ms=500 where route in ('/places','/legacy');
select evaluate_all();
select ok(not (select breached from private.evaluation_before_queue e join features f on e.feature_id=f.id
 where f.route='/places' and e.kind='failure'),'124 timeouts are below the original 30-minute failure threshold');
select is((select count(*) from incidents i join features f on f.id=i.feature_id where f.route='/legacy'),0::bigint,
 'handler-only measurements and missing disconnects leave legacy healthy');
select is((select (metric_at_open->>'interruptions')::int from incidents i join features f on f.id=i.feature_id
 where f.route='/places' and i.kind='failure'),124,'ten-second pause opens even across a bucket boundary');
select ok(exists(select from incidents i join features f on f.id=i.feature_id where f.route='/places' and i.kind='slow'
 and (metric_at_open->>'p50')::int=560 and (metric_at_open->>'queue_ms')::int=433
 and (metric_at_open->>'queue_pct')::int=77),'inclusive latency opens slow incident and records the paired queue share');
select is((select count(*) from incidents i join features f on f.id=i.feature_id where f.route='/quiet' and i.kind='failure'),
 0::bigint,'sparse traffic does not trigger a stall alert');
select ok(not has_table_privilege('authenticated','private.request_flow_seconds','select'),'short-lived flow counters stay private');
select * from finish();
rollback;
