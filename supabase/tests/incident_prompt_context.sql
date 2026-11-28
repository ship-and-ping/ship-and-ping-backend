begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create temporary table anchor as select date_bin('5 minutes',now()-interval '1 hour','epoch') t;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000052');
insert into apps(owner_id,name,first_record_at) select id,'Trova',t-interval '30 minutes' from auth.users,anchor;
insert into features(app_id,kind,name,method,route)
 select id,'auto',f.name,'GET','/'||f.name from apps cross join (values ('place'),('bookmark')) f(name);
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,server_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t+minutes*interval '1 minute',n,0,clients,0,(n-clients)*ms,
 array[clients,case when ms=80 then n-clients else 0 end,0,0,0,case when ms=600 then n-clients else 0 end,0,0,0,0,0,0,0,0,0,0]
 from features,anchor,(values
  ('place',-30,20,0,80),('place',-20,800,0,80),('place',-5,900,0,80),
  ('place',0,3000,0,600),('bookmark',0,2000,0,80),
  ('place',5,5000,1,80),('place',10,5000,0,80),('place',15,1,1,80)
 ) v(feature,minutes,n,clients,ms) where name=feature;
insert into error_samples(app_id,feature_id,version,at,http_status,error_kind)
 select app_id,id,'v1',t+interval '18 minutes',401,'UNAUTHORIZED' from features,anchor where name='place';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version)
 select app_id,id,'failure',status,t+beg*interval '1 minute',t+stop*interval '1 minute','v1'
 from features,anchor,(values ('quiet',-20,-15),('open',-5,null::int)) prior(status,beg,stop) where name='bookmark';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'slow','quiet',t+interval '65 seconds',t+interval '15 minutes 20 seconds','v1',
 '{"baseline":80,"baseline_p50":80,"baseline_p95":100,"window":10,"threshold":5000}'
 from features,anchor where name='place';
select set_config('test.issue',(select id::text from incidents where kind='slow'),true);
select set_config('test.start',(select t::text from anchor),true);
select ok(not has_function_privilege('anon','incident_prompt_context(uuid)','execute'),'anonymous access denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000053',true);
select throws_ok($$select incident_prompt_context(current_setting('test.issue')::uuid)$$,'42501',null,'other owner denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000052',true);
create temporary table report as select incident_prompt_context(current_setting('test.issue')::uuid) ctx;
select is((ctx->>'slow_start')::timestamptz,current_setting('test.start')::timestamptz,'first slow five-minute bucket') from report;
select is((ctx->>'usual_rpm')::numeric,1::numeric,'quiet minutes count; closed and still-open issues excluded') from report;
select is((ctx->>'incident_rpm')::numeric,1000::numeric,'all routes contribute over the elapsed complete buckets') from report;
select is((ctx->>'client_errors')::int,1,'401 after closure in the same bucket excluded') from report;
select is((ctx->>'server_errors')::int,0,'confirmed zero 5xx') from report;
select ok(not (ctx->>'client_partial')::boolean and not (ctx->>'server_partial')::boolean,'counts fully determined') from report;
select * from finish();
rollback;
