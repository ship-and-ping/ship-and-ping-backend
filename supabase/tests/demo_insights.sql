begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000048');
insert into apps(owner_id,name) select id,'T48 demo' from auth.users;
insert into app_versions(app_id,version,first_seen_at)
 select id,v,now()-age from apps cross join (values ('v2',interval '1 hour'),('v1',interval '1 day')) versions(v,age);
insert into features(app_id,kind,feature_key,name) select id,'deep','search','검색' from apps;
insert into baselines(feature_id,sample_count,p50_ms,p95_ms) select id,30,200,300 from features;
insert into attempts(app_id,feature_id,version,attempt_id,status,started_at,ended_at,duration_ms)
 select app_id,id,v,gen_random_uuid(),status,now()-age-ms*interval '1 ms',now()-age,ms
 from features cross join (values
 ('v1','success',1400,10,interval '1 day'),('v2','success',300,9,interval '2 minutes'),
 ('v2','success',301,1,interval '2 minutes'),('v2','failure',50,2,interval '3 minutes')
 ) r(v,status,ms,n,age) cross join lateral generate_series(1,n);
insert into features(app_id,kind,name,route,method) select id,'auto','목록','/list','GET' from apps;
insert into baselines(feature_id,sample_count,p50_ms,p95_ms) select id,30,240,240 from features where kind='auto';
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v2',date_bin('5 minutes',now(),'epoch'),23,12,1,3750,
 array[13,0,0,9,1,0,0,0,0,0,0,0,0,0,0,0] from features where kind='auto';
insert into private.evaluation_buckets(app_id,feature_id,version,bucket,success_hist,min_ms,max_ms,result_count,slow_count,threshold_ms,duration_counts)
 select app_id,feature_id,version,bucket,array[0,0,0,9,1,0,0,0,0,0,0,0,0,0,0,0],240,500,22,0,5000,'{"240":9,"500":1}' from stats_5m;
select set_config('test.app',(select id::text from apps),true);
select ok(not has_function_privilege('anon','demo_insights(uuid)','execute'),'anonymous access denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000049',true);
select throws_ok($$select * from demo_insights(current_setting('test.app')::uuid)$$,'42501',null,'another member cannot read the app');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000048',true);
select results_eq($$select fast,measured,failures,previous_ms,current_ms,previous_n,current_n
 from demo_insights(current_setting('test.app')::uuid) join features on id=feature_id where kind='deep'$$,
 'select 9::bigint,10::bigint,2::bigint,1400::numeric,300::numeric,10::bigint,10::bigint',
 'p95 is inclusive, failed requests stay separate and the prior day only affects version comparison');
select results_eq($$select fast,measured,failures,current_ms from demo_insights(current_setting('test.app')::uuid)
 join features on id=feature_id where kind='auto'$$,'select 9::bigint,10::bigint,12::bigint,240::numeric',
 'automatic timings include exact p95 inside a T45 bin even when failures dominate');
select * from finish();
rollback;
