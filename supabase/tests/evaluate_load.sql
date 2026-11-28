begin;
create extension if not exists dblink with schema extensions;
create temp table load_owners as select gen_random_uuid() id from generate_series(1,20);
select id load_owner from load_owners order by id limit 1 \gset
insert into auth.users(id) select id from load_owners;
insert into public.apps(id,owner_id,name) select id,id,'load' from load_owners;
insert into public.app_keys(app_id,kind,prefix,key_hash) values (:'load_owner','srv','load',repeat('a',64));
insert into public.features(app_id,kind,method,route,name,last_record_at)
 select id,'auto','GET','/f/'||n,'feature-'||n,now() from load_owners cross join generate_series(1,15) n;
insert into public.app_versions(app_id,version) select id,'v1' from load_owners;
insert into stats_5m
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch')-n*interval '5 minutes',5,0,0,5*(60+n%40),
 array[0,5]||array_fill(0,array[14]) from features cross join generate_series(0,2015) n;
insert into private.evaluation_buckets(app_id,feature_id,version,bucket,success_hist,min_ms,max_ms,result_count,slow_count,threshold_ms,duration_counts)
 select app_id,feature_id,version,bucket,hist,(duration_sum_ms/5)::int,(duration_sum_ms/5)::int,5,0,5000,
 jsonb_build_object(duration_sum_ms/5,5) from stats_5m;
-- Five inclusive-only features per app run for the same seven days. Every
-- feature emits four minutes of per-second flow, including interleaved failures.
insert into private.queue_success_5m(app_id,feature_id,version,bucket,n,sum_ms,lo,hi,hist,counts,slow_count,threshold_ms)
 select s.app_id,f.id,s.version,s.bucket,s.total,s.duration_sum_ms,s.duration_sum_ms/5,s.duration_sum_ms/5,
 s.hist,jsonb_build_object(s.duration_sum_ms/5,5),0,5000 from stats_5m s join features f on f.id=s.feature_id
 where split_part(f.name,'-',2)::int<=5;
insert into private.request_flow_seconds(feature_id,stamp,version,completed,interrupted)
 select f.id,date_trunc('second',now())-n*interval '1 second','v1',1,(n%60=0)::int
 from features f cross join generate_series(1,240) n;
analyze private.queue_success_5m;
analyze private.request_flow_seconds;
analyze private.evaluation_buckets;
analyze features;
analyze stats_5m;
-- Release setup's foreign-key locks before opening the two RPC transactions.
commit;
\set ON_ERROR_STOP off
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(7);
select sum(total)::int expected_samples from stats_5m
 where feature_id=(select id from features where app_id=:'load_owner' and route='/f/1')
 and bucket>=now()-interval '7 days' and bucket<date_bin('5 minutes',now()-interval '10 minutes','epoch') \gset
\getenv db_test_password PGPASSWORD
select format('hostaddr=%s port=%s dbname=%L user=%L password=%L',inet_server_addr(),inet_server_port(),current_database(),current_user,:'db_test_password') as db_test_connection \gset
select dblink_connect('load_writer',:'db_test_connection');
select dblink_exec('load_writer',$$set lock_timeout='1s'$$);
select dblink_exec('load_writer','begin');
select is((result->>'accepted')::int,1,'second session has an uncommitted ingest batch')
 from dblink('load_writer',format('select public.ingest_batch(repeat(''a'',64),%L::jsonb)',jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version','concurrent','platform','server','stats',jsonb_build_array(jsonb_build_object(
 'method','GET','route','/f/1','bucket',date_bin('5 minutes',now(),'epoch'),'total',1,'failures',0,
 'client_errors',0,'duration_sum_ms',1,'hist',array[1]||array_fill(0,array[15])))))) as w(result jsonb);
create function pg_temp.measure() returns numeric language plpgsql as $$
declare started timestamptz := clock_timestamp();
begin
 perform evaluate_all();
 return round(extract(epoch from clock_timestamp()-started)*1000,2);
end $$;
create temp table times(cold numeric,warm numeric);
set local statement_timeout='8s';
set local lock_timeout='1s';
insert into times(cold) select pg_temp.measure();
select ok(cold<8000,'cold evaluation completes within the RPC deadline during ingest') from times;
select ok(exists(select from baselines b join features f on f.id=b.feature_id where f.app_id=:'load_owner' and f.route='/f/1' and b.sample_count=:expected_samples),
 'cold evaluation refreshed the app held by the writer');
select dblink_exec('load_writer','rollback');
select is((select count(*) from baselines where p50_ms is not null and sample_count=:expected_samples),300::bigint,'seven-day baselines exclude three current buckets');
update private.latency_baselines set computed_at=now()-interval '1 minute' where n=0;
update times set warm=pg_temp.measure();
select is((select count(*) from private.latency_baselines where n=0 and computed_at=now()-interval '1 minute'),
 100::bigint,'absent handler-only cohorts skip the warm seven-day scan');
select ok(warm<8000,'warm evaluation under the 8 s RPC deadline') from times;
do $$ begin raise warning 'evaluate_all 300 features x 2016 buckets: cold % ms, warm % ms',
 (select cold from times),(select warm from times); end $$;
select is((select count(*) from incidents),0::bigint,'healthy traffic stays quiet');
select * from finish();
rollback;
\set ON_ERROR_STOP on
select extensions.dblink_disconnect('load_writer')
 where 'load_writer'=any(extensions.dblink_get_connections());
delete from auth.users where id in (select id from load_owners);
