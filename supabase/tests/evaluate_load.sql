begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(4);
insert into auth.users(id) select gen_random_uuid() from generate_series(1,20);
insert into apps(owner_id,name)
 select id,'load' from auth.users;
insert into features(app_id,kind,method,route,name)
 select id,'auto','GET','/f/'||n,'feature-'||n from apps cross join generate_series(1,15) n;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into stats_5m
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch')-n*interval '5 minutes',5,0,0,5*(60+n%40),
 array[0,5]||array_fill(0,array[14]) from features cross join generate_series(0,2015) n;
insert into private.evaluation_buckets(app_id,feature_id,version,bucket,success_hist,min_ms,max_ms,result_count,slow_count,threshold_ms,duration_counts)
 select app_id,feature_id,version,bucket,hist,(duration_sum_ms/5)::int,(duration_sum_ms/5)::int,5,0,5000,
 jsonb_build_object(duration_sum_ms/5,5) from stats_5m;
analyze private.evaluation_buckets;
analyze features;
analyze stats_5m;
create function pg_temp.measure() returns numeric language plpgsql as $$
declare started timestamptz := clock_timestamp();
begin
 perform evaluate_all();
 return round(extract(epoch from clock_timestamp()-started)*1000,2);
end $$;
create temp table times as select pg_temp.measure() cold;
select ok(cold<30000,'cold evaluation under 30 s') from times;
select is((select count(*) from baselines where p50_ms is not null and sample_count=10065),300::bigint,'seven-day baselines exclude three current buckets');
alter table times add column warm numeric;
update times set warm=pg_temp.measure();
select ok(warm<30000,'warm evaluation under 30 s') from times;
do $$ begin raise warning 'evaluate_all 300 features x 2016 buckets: cold % ms, warm % ms',
 (select cold from times),(select warm from times); end $$;
select is((select count(*) from incidents),0::bigint,'healthy traffic stays quiet');
select * from finish();
rollback;
