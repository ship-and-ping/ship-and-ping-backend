begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set local time zone 'UTC';
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002');
insert into apps(owner_id,name) select id,'daily' from auth.users;
insert into features(app_id,kind,feature_key,name) select id,'deep','daily','Daily' from apps;
insert into app_versions(app_id,version) select id,'v1' from apps;
create temp view dates as select
 date_trunc('day',now(),'Asia/Seoul') - interval '32 days' as midnight,
 date_trunc('hour',now()-interval '30 days') as cutoff_hour,
 date_trunc('day',now() at time zone 'Asia/Seoul' - interval '1 year')
   at time zone 'Asia/Seoul' as cutoff_day;
insert into stats_1h
select app_id,id,'v1',stamp,3,1,1,75,array[1,2] || array_fill(0,array[14])
from features cross join dates cross join lateral (values
 (midnight-interval '1 hour'),(midnight),(midnight+interval '1 hour'),
 (cutoff_hour-interval '1 hour'),(cutoff_hour+interval '1 hour'),
 (cutoff_day),(cutoff_day-interval '1 day')) as hours(stamp);
select cleanup_daily();
select results_eq('select distinct bucket from stats_1h','select cutoff_hour+interval ''1 hour'' from dates',
 'only the hour within 30 days remains');
select results_eq('select total,failures,client_errors,duration_sum_ms,hist from stats_1d,dates where bucket=midnight',
 'select 6,2,2,150::bigint,array[2,4] || array_fill(0,array[14]) from features',
 'hours from KST midnight combine across all counters for each app');
select is((select count(*) from stats_1d,dates where bucket=midnight-interval '1 day' and total=3),
 2::bigint,'23:00 KST belongs to the preceding date');
select results_eq('select distinct min(bucket) from stats_1d','select cutoff_day from dates',
 'the KST anniversary remains and the preceding date expires');
insert into stats_1h select app_id,id,'v1',midnight+interval '2 hours',1,0,0,10,
 array[1] || array_fill(0,array[15]) from features cross join dates;
select cleanup_daily();
select cleanup_daily();
select results_eq('select total,failures,client_errors,duration_sum_ms,hist from stats_1d,dates where bucket=midnight',
 'select 7,2,2,160::bigint,array[3,4] || array_fill(0,array[14]) from features',
 'late hour contributes exactly once across repeated cleanups');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select results_eq('select distinct app_id from stats_1d','select id from apps',
 'member sees only own daily summaries');
select throws_ok('insert into stats_1d default values','42501',null,'member cannot write summaries');
select * from finish();
rollback;
