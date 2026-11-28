begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) select id,'verification' from auth.users;
insert into app_versions(app_id,version) select id,'old' from apps;
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/f','f' from apps;
insert into baselines(feature_id,sample_count,p50_ms,p95_ms) select id,30,100,100 from features;
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open)
 select f.app_id,f.id,'slow','open',now()-interval '10 minutes','old',
  jsonb_build_object('baseline_p50',b.p50_ms,'baseline_p95',b.p95_ms,'threshold',f.slow_threshold_ms)
 from features f join baselines b on b.feature_id=f.id;
select set_config('test.issue',(select id::text from incidents),true);
select ok(not has_function_privilege('anon','incident_verification(uuid)','execute'),'anonymous verification denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
select throws_ok($$select incident_verification(current_setting('test.issue')::uuid)$$,'42501',null,'foreign issue verification denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select is(incident_verification(current_setting('test.issue')::uuid),
 '{"version":null,"consecutive_successes":0,"latest_duration_ms":null,"latest_success":null}'::jsonb,'empty verification');
reset role;
insert into app_versions(app_id,version,first_seen_at) select id,'rollback',now()-interval '5 days' from apps;
insert into private.latest_results select app_id,id,'rollback',now(),n,ms,true from features
 cross join (values (1,99),(2,601),(3,149),(4,150)) t(n,ms);
set local role authenticated;
select is(incident_verification(current_setting('test.issue')::uuid),
 '{"version":"rollback","consecutive_successes":2,"latest_duration_ms":150,"latest_success":true}'::jsonb,'slow success breaks streak, following two qualify');
reset role;
insert into private.latest_results select app_id,id,'rollback',now(),5,80,false from features;
select is(incident_verification(current_setting('test.issue')::uuid),
 '{"version":"rollback","consecutive_successes":0,"latest_duration_ms":80,"latest_success":false}'::jsonb,'latest failure clears streak');
select * from finish();
rollback;
