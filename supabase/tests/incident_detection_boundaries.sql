begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
set local timezone='UTC';
select plan(4);

-- Temporary mutation run. PostgreSQL rolls both changes back with this fixture.
do $mutation$
begin
 execute replace(pg_get_functiondef('public.incident_prompt_context(uuid)'::regprocedure),
  'select traffic_start since_at','select start_bucket since_at');
 execute replace(pg_get_functiondef('private.first_failure_at(public.incidents)'::regprocedure),
  'and a.result_received_at<issue.opened_at','');
end
$mutation$;

-- Use yesterday's 23:00 UTC so that the recorded incident is always in retention.
create temp table anchor as select date_trunc('day',now())-interval '1 hour' t;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000005202');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000005202',true);
insert into apps(owner_id,name,first_record_at) select auth.uid(),'boundary',t from anchor;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,name,feature_key) select id,'deep','save','save' from apps;
insert into features(app_id,kind,name,method,route) select id,'auto','requests','GET','/requests' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t+m*interval '1 minute',n,0,0,n*80,array[0,n]||array_fill(0,array[14])
 from features,anchor,(values (10,60),(15,10),(20,10)) traffic(m,n) where kind='auto';
insert into attempts(app_id,attempt_id,feature_id,version,status,ended_at,duration_ms)
 select app_id,gen_random_uuid(),id,'v1','success',t+interval '14 minutes 30 seconds'+n*interval '1 minute',600
 from features,anchor,generate_series(0,4) n where kind='deep';
update attempts set result_received_at=ended_at;
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'slow','quiet',t+interval '24 minutes',t+interval '25 minutes','v1',
  '{"window":10,"threshold":500,"total":5,"slow":5}' from features,anchor where kind='deep';
select is((incident_prompt_context(id)->>'slow_start')::timestamptz,t+interval '10 minutes',
 '23:14:30 still displays in the 23:10 slow bucket') from incidents,anchor where kind='slow';
select is((incident_prompt_context(id)->>'incident_rpm')::numeric,2::numeric,
 '23:24 detection counts 20 requests over 23:15-23:25 and excludes 60 in the 23:10 bucket')
 from incidents where kind='slow';

-- At 23:22 three of the eight known results were failures.
insert into attempts(app_id,attempt_id,feature_id,version,status,ended_at)
 select app_id,gen_random_uuid(),id,'v1','failure',t+m*interval '1 minute'
 from features,anchor,(values (18),(19),(21)) failures(m) where kind='deep';
update attempts set result_received_at=ended_at+interval '10 seconds' where status='failure';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'failure','quiet',t+interval '22 minutes',t+interval '25 minutes','v1',
  '{"total":8,"failures":3,"consecutive":false}' from features,anchor where kind='deep';
select is(first_failure_at,t+interval '18 minutes','23:18 was the earliest failure known at detection')
 from incidents,anchor where kind='failure';
-- A delayed upload ended earlier but only reached the server at 23:26.
insert into attempts(app_id,attempt_id,feature_id,version,status,ended_at)
 select app_id,gen_random_uuid(),id,'v1','failure',t+interval '12 minutes' from features,anchor where kind='deep';
update attempts set result_received_at=t+interval '26 minutes' from anchor where ended_at=t+interval '12 minutes';
select is(private.first_failure_at(i),t+interval '18 minutes','backfill ignores the 23:12 failure received at 23:26')
 from incidents i,anchor where kind='failure';
select * from finish();
rollback;
