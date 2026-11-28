begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000049'),('00000000-0000-0000-0000-000000000048');
insert into auth.sessions(id,user_id) select gen_random_uuid(),id from auth.users;
select set_config('test.first_claims',jsonb_build_object('sub',user_id,'session_id',id)::text,true)
 from auth.sessions where user_id='00000000-0000-0000-0000-000000000049';
select set_config('test.second_claims',jsonb_build_object('sub',user_id,'session_id',id)::text,true)
 from auth.sessions where user_id='00000000-0000-0000-0000-000000000048';
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000049','push');
select set_config('test.app',id::text,true) from apps;
select set_config('request.jwt.claims',current_setting('test.first_claims'),true);
set local role authenticated;
select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/fixture','B'||repeat('A',86),repeat('A',22),'iPhone');
select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/fixture','B'||repeat('A',86),repeat('A',22),'iPhone');
select is((select count(id) from push_subscriptions),1::bigint,'one device on retry');
select throws_ok($$select register_push(current_setting('test.app')::uuid,'http://example.invalid/device','B'||repeat('A',86),repeat('A',22),'PC')$$,'23514',null,'reject insecure endpoint');
select set_config('request.jwt.claims',current_setting('test.second_claims'),true);
select is_empty('select id from push_subscriptions','other member cannot see devices');
delete from push_subscriptions;
select throws_ok($$select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/other','B'||repeat('A',86),repeat('A',22),'PC')$$,'42501',null,'cannot subscribe another app');
select set_config('request.jwt.claims',current_setting('test.first_claims'),true);
select ok(queue_test_push(current_setting('test.app')::uuid,id),'test button queues delivery') from push_subscriptions;
select ok(not queue_test_push(current_setting('test.app')::uuid,id),'test cooldown') from push_subscriptions;
reset role;
create temp table first_push as select * from claim_notifications(1);
select is((select push_target->>'endpoint' from first_push),'https://web.push.apple.com/fixture','claim carries subscription');
select complete_push(id,claim_token,'retry') from first_push;
select is((select failures from push_subscriptions),1,'failed device tracked');
select ok((select sent_at is null and available_at>now() from notifications),'failed row retries later');
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/','example' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch'),15,10,1,1500,array[0,15]||array_fill(0,array[14]) from features;
select ok(evaluate_all()->0->'channels' @> '["email","push"]'::jsonb,'open event queues push and email');
select set_push_enabled(current_setting('test.app')::uuid,false);
create temp table disabled as select * from claim_notifications(5);
select is((select push_target from disabled where channel='push'),null::jsonb,'turning off before claim suppresses delivery');
select complete_push(id,claim_token,'disabled') from disabled where channel='push';
select complete_notification(id,claim_token,true,null) from disabled where channel='email';
select set_push_enabled(current_setting('test.app')::uuid,true);
update notifications set available_at=now() where sent_at is null;
select complete_push(id,claim_token,'gone') from claim_notifications(1);
select is_empty('select id from push_subscriptions','expired subscription removed');
select ok((select ok from notifications where channel='email'),'email sent independently');
select ok(not has_function_privilege('authenticated','complete_push(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','claim_notifications(integer)','execute')
 and has_function_privilege('service_role','claim_notifications(integer)','execute'),'delivery isolated');
select * from finish();
rollback;
