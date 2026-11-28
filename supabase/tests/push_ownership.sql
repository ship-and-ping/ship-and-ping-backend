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
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000049','first');
select set_config('test.app',id::text,true) from apps;
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000048','second');
select set_config('test.second',id::text,true) from apps where name='second';
select set_config('request.jwt.claims',current_setting('test.first_claims'),true);
set local role authenticated;
select set_config('test.device',register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/shared',
 'B'||repeat('A',86),repeat('A',22),'iPhone',repeat('1',64))::text,true);
select ok(queue_test_push(current_setting('test.app')::uuid,current_setting('test.device')::uuid),'old account queues a push');
select set_config('request.jwt.claims',current_setting('test.second_claims'),true);
select throws_ok($$select register_push(current_setting('test.second')::uuid,'https://web.push.apple.com/shared','B'||repeat('A',86),
 repeat('Z',22),'PC')$$,'42501',null,'endpoint alone cannot claim an existing subscription');
select throws_ok($$select register_push(current_setting('test.second')::uuid,'https://web.push.apple.com/shared',
 'B'||repeat('A',86),repeat('A',22),'iPhone')$$,'42501',null,'both device keys cannot transfer a subscription');
select throws_ok($$select register_push(null,'https://web.push.apple.com/removed','B'||repeat('A',86),repeat('A',22),'PC')$$,
 '42501',null,'login cannot register without explicit app opt-in');
select unregister_browser_push('https://web.push.apple.com/shared','B'||repeat('A',86),repeat('Z',22));
select is_empty('select id from push_subscriptions','second member sees no first-member devices');
reset role;
select is((select vapid_fingerprint from push_subscriptions),repeat('1',64),'failed transfer and wrong revocation proof leave the original row intact');
-- A mismatched queued job must never receive delivery credentials.
update notifications set test_app=current_setting('test.second')::uuid;
create temp table mismatched as select * from claim_notifications(1);
select is((select count(*) from mismatched),1::bigint,'mismatched job claimed for settlement');
select is((select push_target from mismatched),null::jsonb,'mismatched job has no delivery target');
select is_empty('select id from push_subscriptions','mismatched subscription deleted at dispatch');
select register_push(current_setting('test.second')::uuid,'https://web.push.apple.com/new','B'||repeat('A',86),repeat('Z',22),'PC');
select set_config('request.jwt.claims',current_setting('test.first_claims'),true);
set local role authenticated;
select unregister_browser_push('https://web.push.apple.com/new','B'||repeat('A',86),repeat('Z',22));
reset role;
select is_empty('select id from push_subscriptions','switch can revoke the exact old subscription');
select ok(not has_function_privilege('anon','unregister_browser_push(text,text,text)','execute'),'anonymous revocation denied');

select set_config('request.jwt.claims',current_setting('test.first_claims'),true);
select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/device'||n,
 'B'||repeat('A',86),repeat('A',22),'PC') from generate_series(1,11) n;
select is((select count(*) from push_subscriptions),10::bigint,'ten devices per account');
select is_empty($$select id from push_subscriptions where endpoint='https://web.push.apple.com/device1'$$,'oldest trimmed');
insert into notifications(test_app,channel,event,ok,sent_at,push_device,queued_at)
 select current_setting('test.app')::uuid,'push','test',null,null,id,now()-interval '5 minutes' from push_subscriptions;
insert into notifications(test_app,channel,event,ok,sent_at) values(current_setting('test.app')::uuid,'email','test',null,null);
select is((select channel from claim_notifications(1)),'email','a new email wins the last slot over older push rows');
create temp table claimed_pushes as select * from claim_notifications(10);
create temp table chosen as select c.*,n.push_device from claimed_pushes c join notifications n using(id)
 order by c.id limit 2;
select ok(prepare_push_delivery(id,claim_token,app)->>'endpoint'=push_target->>'endpoint',
 'active lease gets live credentials') from chosen;
select is(prepare_push_delivery(id,gen_random_uuid(),app),null::jsonb,'stale lease denied') from chosen;
select ok((select count(*) from chosen c join notifications n using(id) where n.claim_token=c.claim_token)=2,
 'stale lease cannot cancel a live delivery');
update push_subscriptions set user_id='00000000-0000-0000-0000-000000000048'
 where id=(select push_device from chosen order by id limit 1);
delete from push_subscriptions where id=(select push_device from chosen order by id desc limit 1);
select is(prepare_push_delivery(id,claim_token,app),null::jsonb,'removed or reassigned after claim') from chosen;
select is((select count(*) from chosen c join notifications n using(id) where n.sent_at is not null
 and n.ok=false and n.error='푸시 발송 취소' and n.retries=0 and n.claim_token is null),2::bigint,'both cancellations terminal');
select ok(not has_function_privilege('authenticated','prepare_push_delivery(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','prepare_push_delivery(uuid,uuid,uuid)','execute')
 and has_function_privilege('service_role','prepare_push_delivery(uuid,uuid,uuid)','execute'),'only worker can prepare delivery');
-- Use a fresh device as the two preceding cancellation targets were randomly ordered.
select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/revoke','B'||repeat('A',86),repeat('Z',22),'PC');
select set_config('test.proof',encode(extensions.digest(endpoint || chr(10) || p256dh || chr(10) || auth,'sha256'),'hex'),true)
 from push_subscriptions where endpoint='https://web.push.apple.com/revoke';
select set_config('request.jwt.claims',current_setting('test.second_claims'),true);
set local role authenticated;
select revoke_push_by_proof(repeat('0',64));
select is(cleanup_push_target('00000000-0000-0000-0000-000000000048','https://web.push.apple.com/revoke',
 current_setting('test.proof'),true),'other','matching proof cannot delete a different owner');
select is(cleanup_push_target('00000000-0000-0000-0000-000000000049','https://web.push.apple.com/revoke',
 repeat('0',64),true),'other','owner and endpoint cannot replace browser proof');
select is(cleanup_push_target('00000000-0000-0000-0000-000000000049','https://web.push.apple.com/different',
 current_setting('test.proof'),true),'missing','cleanup is bound to the captured endpoint');
select is(cleanup_push_target('00000000-0000-0000-0000-000000000049','https://web.push.apple.com/revoke',
 current_setting('test.proof'),false),'owned','next member may check the old browser proof');
reset role;
select ok(exists(select from push_subscriptions where endpoint='https://web.push.apple.com/revoke'),'incorrect proof preserves device');
set local role authenticated;
select revoke_push_by_proof(current_setting('test.proof'));
reset role;
select is_empty($$select from push_subscriptions where endpoint='https://web.push.apple.com/revoke'$$,'next account can replay exact revocation');
select ok(not has_function_privilege('anon','revoke_push_by_proof(text)','execute'),'anonymous revocation denied');
select register_push(current_setting('test.second')::uuid,'https://web.push.apple.com/revoke','B'||repeat('A',86),repeat('Z',22),'PC');
set local role authenticated;
select is(cleanup_push_target('00000000-0000-0000-0000-000000000049','https://web.push.apple.com/revoke',
 current_setting('test.proof'),true),'other','late cleanup preserves re-registration with identical endpoint and keys');
select is(cleanup_push_target('00000000-0000-0000-0000-000000000048',null,
 current_setting('test.proof'),true),'owned','legacy marker deletes only its recorded member and proof');
select is_empty($$select id from push_subscriptions where endpoint='https://web.push.apple.com/revoke'$$,'confirmed target deleted');
select ok(not has_function_privilege('anon','cleanup_push_target(uuid,text,text,boolean)','execute'),'anonymous cleanup denied');
select * from finish();
rollback;
