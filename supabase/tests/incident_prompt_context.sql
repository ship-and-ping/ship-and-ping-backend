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
 '{"baseline":80,"baseline_p50":80,"baseline_p95":100,"window":10,"threshold":5000,"p50":600,"total":3000,"slow":0}'
 from features,anchor where name='place';
select set_config('test.issue',(select id::text from incidents where kind='slow'),true);
select set_config('test.start',(select t::text from anchor),true);
-- A 503 on a peer is in scope. Even two incidents on the peer count it once.
update stats_5m set failures=1,server_errors=1 where feature_id=(select id from features where name='bookmark') and bucket=(select t from anchor);
insert into error_samples(app_id,feature_id,version,at,http_status,error_kind)
 select app_id,id,'v1',t+interval '1 minute',503,'HTTP_503' from features,anchor where name='bookmark';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version)
 select app_id,id,'slow','quiet',t+interval '1 minute',t+interval '3 minutes','v1' from features,anchor where name='bookmark';
insert into features(app_id,kind,name,method,route) select id,'auto','other','GET','/other' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,server_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t-interval '5 minutes',2,2,0,2,160,array[0,2]||array_fill(0,array[14])
 from features,anchor where name='other';
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
select is((ctx->>'related_server_errors')::int,1,'peer 503 counted exactly once') from report;
select ok(not (ctx->>'client_partial')::boolean and not (ctx->>'server_partial')::boolean,'counts fully determined') from report;
reset role;
-- Opening in the middle of a busy bucket with new failures and older successes.
-- Only the next five complete minutes are measurable (5000 requests).
update stats_5m set total=6000,failures=3000,hist=array[0,0,0,0,0,6000]||array_fill(0,array[10]),duration_sum_ms=3600000
 where feature_id=(select id from features where name='place') and bucket=(select t from anchor);
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'failure','quiet',t+interval '4 minutes',t+interval '10 minutes','v1','{"total":7720,"failures":3000}'
 from features,anchor where name='place';
select is((incident_prompt_context(id)->>'incident_rpm')::numeric,1000::numeric,'23:24 to 23:30 excludes 23:20-24 traffic')
 from incidents where feature_id=(select id from features where name='place') and kind='failure';
-- A failure in the bucket of the preceding closure cannot anchor the rate.
update stats_5m set failures=2,server_errors=2 where feature_id=(select id from features where name='place') and bucket=(select t+interval '10 minutes' from anchor);
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'failure','quiet',t+interval '17 minutes',t+interval '20 minutes','v1','{"total":10,"failures":2}'
 from features,anchor where name='place';
-- Preceding closure was at +10m, so the detector cannot reuse its +10m bucket.
select is((incident_prompt_context(id)->>'incident_rpm')::numeric,null::numeric,'no complete traffic bucket after detection')
 from incidents where kind='failure' and opened_at=(select t+interval '17 minutes' from anchor);
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t+delta*interval '1 minute',n,fail,0,n*80,array[0,n]||array_fill(0,array[14])
 from features,anchor,(values(25,100,50),(30,50,0)) v(delta,n,fail) where name='place';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'failure','quiet',t+interval '32 minutes',t+interval '35 minutes','v1','{"total":150,"failures":50}'
 from features,anchor where name='place';
select is((incident_prompt_context(id)->>'incident_rpm')::numeric,15::numeric,'earlier abnormal failure bucket begins the rate window')
 from incidents where kind='failure' and opened_at=(select t+interval '32 minutes' from anchor);
-- Independent feature, with a 25-minute-old sample above the cap but below baseline p95.
insert into features(app_id,kind,name,method,route)
 select id,'auto','baseline','GET','/baseline' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t+delta*interval '1 minute',n,0,0,n*ms,
 case when delta=-25 then array[0,0,0,0,0,1]||array_fill(0,array[10])
 else array[0,0,0,0,0,0,0,5]||array_fill(0,array[8]) end
 from features,anchor,(values(-25,1,600),(-10,5,1200)) v(delta,n,ms) where name='baseline';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'slow','quiet',t,t+interval '1 minute','v1',
 '{"baseline_p50":300,"baseline_p95":900,"window":30,"threshold":500,"p50":1200,"total":6,"slow":6}'
 from features,anchor where name='baseline';
select is(first_slow_bucket,(select t-interval '10 minutes' from anchor),'30-minute baseline excludes an isolated fixed-cap breach')
 from incidents where feature_id=(select id from features where name='baseline');
-- The ten-minute cap won with exactly half the samples over 500 ms.
-- The -10 minute bucket is outside the automatic feature's short window.
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',t-interval '5 minutes',6,0,0,2400,array[0,3,0,0,0,3]||array_fill(0,array[10])
 from features,anchor where name='baseline';
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open)
 select app_id,id,'slow','open',t,'v1',
 '{"baseline_p50":300,"baseline_p95":900,"window":10,"threshold":500,"p50":400,"total":6,"slow":3}'
 from features,anchor where name='baseline';
select is(first_slow_bucket,(select t-interval '5 minutes' from anchor),'10-minute fixed cap preserves the tie and the opening window')
 from incidents where feature_id=(select id from features where name='baseline') and status='open';
-- When only the streak triggered, an older isolated failure is outside its evidence.
insert into features(app_id,kind,name,feature_key) select id,'deep','save','save' from apps;
insert into attempts(app_id,attempt_id,feature_id,version,status,ended_at)
 select app_id,gen_random_uuid(),id,'v1',case when n>=27 or n=0 then 'failure' else 'success' end,
  t+interval '10 minutes 10 seconds'+n*interval '1 minute'
 from features,anchor,generate_series(0,29) n where name='save';
-- The receipt trigger uses the wall clock. Replay receipts on the fixture's timeline.
update attempts set result_received_at=ended_at where feature_id=(select id from features where name='save');
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version,metric_at_open)
 select app_id,id,'failure','quiet',t+interval '40 minutes',t+interval '45 minutes','v1',
  '{"total":30,"failures":4,"consecutive":true}' from features,anchor where name='save';
select is(first_failure_at,(select t+interval '37 minutes 10 seconds' from anchor),'three consecutive deep failures start at the first of the last three')
 from incidents where feature_id=(select id from features where name='save');
select * from finish();
rollback;
