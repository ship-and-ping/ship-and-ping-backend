begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000049'),('00000000-0000-0000-0000-000000000048');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000049','first');
select set_config('test.app',id::text,true) from apps;
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000048','second');
select set_config('test.second',id::text,true) from apps where name='second';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000049',true);
set local role authenticated;
select set_config('test.device',register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/shared',
 'B'||repeat('A',86),repeat('A',22),'iPhone',repeat('1',64))::text,true);
select ok(queue_test_push(current_setting('test.app')::uuid,current_setting('test.device')::uuid),'old account queues a push');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000048',true);
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
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000049',true);
set local role authenticated;
select unregister_browser_push('https://web.push.apple.com/new','B'||repeat('A',86),repeat('Z',22));
reset role;
select is_empty('select id from push_subscriptions','switch can revoke the exact old subscription');
select ok(not has_function_privilege('anon','unregister_browser_push(text,text,text)','execute'),'anonymous revocation denied');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000049',true);
select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/device'||n,
 'B'||repeat('A',86),repeat('A',22),'PC') from generate_series(1,11) n;
select is((select count(*) from push_subscriptions),10::bigint,'ten devices per account');
select is_empty($$select id from push_subscriptions where endpoint='https://web.push.apple.com/device1'$$,'oldest trimmed');
insert into notifications(test_app,channel,event,ok,sent_at,push_device,queued_at)
 select current_setting('test.app')::uuid,'push','test',null,null,id,now()-interval '5 minutes' from push_subscriptions;
insert into notifications(test_app,channel,event,ok,sent_at) values(current_setting('test.app')::uuid,'email','test',null,null);
select is((select channel from claim_notifications(1)),'email','a new email wins the last slot over older push rows');
select * from finish();
rollback;
