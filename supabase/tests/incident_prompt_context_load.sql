begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(2);
create temp table anchor as select date_bin('5 minutes',now()-interval '10 minutes','epoch') t;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000005201');
insert into apps(owner_id,name,first_record_at)
 select '00000000-0000-0000-0000-000000005201','context load',t-interval '7 days' from anchor;
insert into features(app_id,kind,name,method,route)
 select id,'auto','route-'||n,'GET','/route-'||n from apps cross join generate_series(1,20) n;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t-n*interval '5 minutes',5,0,0,400,array[0,5]||array_fill(0,array[14])
 from features cross join anchor cross join generate_series(1,2016) n;
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
 select app_id,id,'failure','open',t,'v1' from features,anchor where name='route-1';
analyze stats_5m;
analyze features;
analyze incidents;
select set_config('test.issue',(select id::text from incidents),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000005201',true);
create temp table measurements(run int,rpm numeric,ms numeric);
do $$
declare
 started timestamptz;
 ctx jsonb;
begin
 for i in 1..6 loop
  started := clock_timestamp();
  ctx := incident_prompt_context(current_setting('test.issue')::uuid);
  insert into measurements values(i,(ctx->>'usual_rpm')::numeric,extract(epoch from clock_timestamp()-started)*1000);
 end loop;
 raise warning 'incident_prompt_context 20 features x 2016 buckets: first % ms, subsequent median % ms, max % ms',
  (select ms from measurements where run=1),
  (select percentile_cont(0.5) within group(order by ms) from measurements where run>1),
  (select max(ms) from measurements where run>1);
end $$;
select ok(bool_and(rpm=20) and count(rpm)=6,'all 40,320 buckets contribute to the seven-day comparison') from measurements;
select ok(max(ms)<2000,'owner RPC stays under two seconds on a shared runner') from measurements;
select * from finish();
rollback;
