begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
insert into auth.users(id) values('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into apps(name) values('A');
set local role authenticated;
select set_config('test.hash',encode(sha256(convert_to(issue_key((select id from apps),'pub'),'UTF8')),'hex'),true);
select issue_key((select id from apps),'pub') is not null;
reset role;
select is((select expires_at from app_keys where key_hash=current_setting('test.hash')),now()+interval '24 hours','rotation grace');
create function pg_temp.batch(batch uuid) returns jsonb language sql as $$
 select jsonb_build_object('batch_id',batch,'app_version','v1','stats',jsonb_build_array(jsonb_build_object(
  'method','GET','route','/demo','bucket',date_trunc('hour',now()),'total',21,'failures',21,
  'client_errors',0,'duration_sum_ms',42,'hist',array[21] || array_fill(0,array[15]))),
  'error_samples',(select jsonb_agg(jsonb_build_object('method','GET','route','/demo','at',now()-i*interval '1 second',
   'error_kind','Timeout','message','masked')) from generate_series(1,21) i))
$$;
set local role service_role;
select is(ingest_batch(current_setting('test.hash'),pg_temp.batch('00000000-0000-0000-0000-000000000011')),
  '{"accepted":21,"dropped":0}'::jsonb,'accepted aggregate');
select is(ingest_batch(current_setting('test.hash'),pg_temp.batch('00000000-0000-0000-0000-000000000011')),
  '{"accepted":0,"dropped":0}'::jsonb,'retry ignored');
select ingest_batch(current_setting('test.hash'),pg_temp.batch(gen_random_uuid()));
reset role;
select results_eq('select total,failures,duration_sum_ms,hist[1] from stats_5m','select 42,42,84::bigint,42','additive upsert');
select results_eq('select count(*),min(at) from error_samples',$q$select 20::bigint,now()-interval '10 seconds'$q$,'newest twenty samples');
update app_keys set revoked_at=now() where key_hash=current_setting('test.hash');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),pg_temp.batch(gen_random_uuid()))$q$,'PT401',null,'revoked key denied');
update app_keys set revoked_at=null,expires_at=now() where key_hash=current_setting('test.hash');
select throws_ok($q$select ingest_batch(current_setting('test.hash'),pg_temp.batch(gen_random_uuid()))$q$,'PT401',null,'expired key denied');

-- Choose an hour wholly before the cutoff, including on an exact clock tick.
insert into stats_5m select app_id,feature_id,version,date_trunc('hour',now()-interval '7 days')-interval '1 hour',total,failures,
 client_errors,duration_sum_ms,hist from stats_5m;
insert into stats_5m select app_id,feature_id,version,bucket+interval '5 minutes',3,1,1,37,array[1,2] || array_fill(0,array[14])
 from stats_5m where bucket < now()-interval '7 days';
insert into private.evaluation_buckets
 select app_id,feature_id,version,bucket,array_fill(0,array[16]),null,null,total,0,5000 from stats_5m;
select cleanup_daily();
select is((select count(*) from private.evaluation_buckets),1::bigint,'only recent evaluation inputs remain');
select results_eq('select total,failures,client_errors,duration_sum_ms,hist from stats_1h',
 'select 45,43,1,121::bigint,array[43,2] || array_fill(0,array[14])','expired five-minute buckets combine by hour');
-- A late 5m row reaches an hour already rolled up on an earlier run.
insert into stats_5m select app_id,feature_id,version,bucket+interval '10 minutes',3,1,1,37,array[1,2] || array_fill(0,array[14]) from stats_1h;
select cleanup_daily();
select is((select count(*) from stats_5m),1::bigint,'recent side retained');
select results_eq('select total,failures,client_errors,duration_sum_ms,hist from stats_1h',
 'select 48,44,2,158::bigint,array[44,4] || array_fill(0,array[14])','late bucket adds all metrics to existing hour');
select cleanup_daily();
select is((select total from stats_1h),48,'rerun leaves merged hour unchanged');

-- Exercise an aligned bucket with a deterministic clock on both sides of seven days.
select private.rollup_5m(bucket + interval '6 days 23 hours 59 minutes') from stats_5m;
select is((select count(*) from stats_5m),1::bigint,'6d 23h 59m remains available');
select private.rollup_5m(bucket + interval '7 days') from stats_5m;
select is((select count(*) from private.evaluation_buckets),1::bigint,'baseline window includes the exact cutoff');
select private.rollup_5m(bucket + interval '7 days 1 second') from stats_5m;
select is_empty('select bucket from stats_5m','older than seven days rolls up');
select is_empty('select bucket from private.evaluation_buckets','expired evaluation inputs follow their parent');
select * from finish();
rollback;
