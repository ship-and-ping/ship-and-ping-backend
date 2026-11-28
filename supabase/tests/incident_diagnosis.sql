begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create temp table anchor as select date_bin('5 minutes',now()-interval '1 hour','epoch') t;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000055');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000055',true);
insert into apps(owner_id,name,first_record_at) select auth.uid(),'분류 시험',t-interval '1 day' from anchor;
insert into features(app_id,kind,name,method,route)
  select apps.id,'auto',f.name,'GET','/'||f.name from apps cross join (values('places'),('trips')) f(name);
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,server_errors,duration_sum_ms,hist)
  select app_id,id,'v1',t+mins*interval '1 minute',n,0,clients,0,n*10,array[n]||array_fill(0,array[15])
  from features,anchor,(values(-5,30,0),(0,300,20),(5,300,20)) s(mins,n,clients) where name='places';
insert into incidents(app_id,feature_id,kind,status,opened_version,opened_at,closed_at)
  select app_id,id,'failure','quiet','v1',t,t+interval '10 minutes' from features,anchor where name='places';
insert into app_keys(app_id,kind,prefix,key_hash,expires_at)
  select id,'srv','test',repeat('a',64),t+interval '24 hours'-interval '10 minutes' from apps,anchor;
insert into error_samples(app_id,feature_id,version,at,http_status,error_kind,message)
  select app_id,id,'v1',t+interval '1 minute',s.status,s.kind,s.class
  from features,anchor,(values(401,null,null),(401,null,null),(403,null,null),
    (502,'HTTP_502','LookupError'),(500,'HTTP_500','LookupError')) s(status,kind,class)
  where name='places';
insert into attempts(app_id,feature_id,attempt_id,version,status,ended_at,step,error_kind)
  select app_id,id,gen_random_uuid(),'v1','failure',t+interval '2 minutes','database','TimeoutError'
  from features,anchor where name='places';

create temp view report as select incident_prompt_context(id) ctx from incidents;
select is((ctx->>'feature_rpm')::numeric,60::numeric,'feature requests per minute in complete incident buckets') from report;
select ok((ctx->>'single_feature_spike')::bool and (ctx->>'client_spike')::bool,'single feature and client error rate spikes') from report;
select ok((ctx->>'key_changed')::bool and (ctx->>'auth_spike')::bool,'rotation time and auth rate independently observed') from report;
select ok((ctx->>'repeated_server_error')::bool,'two status-labelled 5xx share an exception class') from report;
select is((ctx->>'timeout_step')::bool,false,'one DB timeout cannot establish a repeated step') from report;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,server_errors,duration_sum_ms,hist)
  select app_id,id,'v1',t,200,0,0,0,2000,array[200]||array_fill(0,array[15]) from features,anchor where name='trips';
select is((ctx->>'single_feature_spike')::bool,false,'spike on a second route rules out a single-route surge') from report;
update error_samples set at=(select t+interval '11 minutes' from anchor) where http_status in (403,502);
select ok(not (ctx->>'auth_spike')::bool and not (ctx->>'repeated_server_error')::bool,'samples after closure cannot drive classification') from report;
select ok(not has_function_privilege('authenticated','private.incident_prompt_context(uuid)','execute'),'old function is private');

-- Simulate T54's optional storage on either side of the deployment order.
create table if not exists public.server_minutes(app_id uuid,bucket timestamptz,last_received timestamptz,version text,resources jsonb);
create table if not exists public.feature_timing_5m(app_id uuid,feature_id uuid,version text,bucket timestamptz,
  db_ms_sum bigint,db_ms_count bigint,external_ms_sum bigint,external_ms_count bigint);
create table if not exists public.app_profiles(app_id uuid,profile jsonb);
insert into app_profiles(app_id,profile) select id,'{"metrics":"CloudWatch Metrics"}' from apps;
insert into server_minutes(app_id,bucket,last_received,version,resources)
  select id,t+n*interval '1 minute',t+n*interval '1 minute','v1',jsonb_build_object('system_cpu_pct',90,'mem_used_pct',70+n*5)
  from apps,anchor,generate_series(1,3) n;
insert into feature_timing_5m(app_id,feature_id,version,bucket,db_ms_sum,db_ms_count,external_ms_sum,external_ms_count)
  select app_id,id,'v1',t+n*interval '1 minute',ms,1,10,1 from features,anchor,(values(-5,50),(0,200)) s(n,ms)
  where name='places';
select ok((ctx->>'cpu_high')::bool and (ctx->>'memory_rising')::bool and (ctx->>'db_slow')::bool,'incident-scoped T54 CPU, memory trend and weighted DB timing') from report;
select is(ctx->>'metrics_guide','CloudWatch Metrics','app metrics guide') from report;
update feature_timing_5m set db_ms_sum=50,external_ms_sum=300 where bucket=(select t from anchor);
select is((ctx->>'external_slow')::bool,false,'one external timing cannot establish an external incident') from report;
update feature_timing_5m set external_ms_count=2,external_ms_sum=600 where bucket=(select t from anchor);
select is((ctx->>'external_slow')::bool,true,'repeated external timings rose while DB timing held steady') from report;
update server_minutes set resources='{"mem_used_pct":85}';
select is((ctx->>'memory_rising')::bool,false,'one high level does not imply a rising trend') from report;
select * from finish();
rollback;
