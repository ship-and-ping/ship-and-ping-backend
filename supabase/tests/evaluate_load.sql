begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(2);
insert into auth.users(id) select gen_random_uuid() from generate_series(1,20);
insert into apps(owner_id,name)
 select id,'load' from auth.users;
insert into features(app_id,kind,method,route,name)
 select id,'auto','GET','/f/'||n,'feature-'||n from apps cross join generate_series(1,15) n;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into stats_5m
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch')-n*interval '5 minutes',5,0,0,500,
 array[0,5]||array_fill(0,array[14]) from features cross join generate_series(0,2015) n;
analyze features;
analyze stats_5m;
create function pg_temp.measure() returns text language plpgsql as $$
declare started timestamptz := clock_timestamp();
begin
 perform evaluate_all();
 return round(extract(epoch from clock_timestamp()-started)*1000,2)||' ms';
end $$;
select diag('20 apps x 15 features x 2016 buckets, first evaluation: '||pg_temp.measure());
select is((select count(*) from baselines where p50_ms is not null and sample_count=10080),300::bigint,'seven-day baselines computed');
select diag('same data, next evaluation: '||pg_temp.measure());
select is((select count(*) from incidents),0::bigint,'healthy traffic stays quiet');
select * from finish();
rollback;
