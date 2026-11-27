begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000049'),('00000000-0000-0000-0000-000000000048');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000049','first');
select set_config('test.app',id::text,true) from apps;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000049',true);
set local role authenticated;
select set_config('test.device',register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/shared',
 'B'||repeat('A',86),repeat('A',22),'iPhone',repeat('1',64))::text,true);
select ok(queue_test_push(current_setting('test.app')::uuid,current_setting('test.device')::uuid),'old account queues a push');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000048',true);
select throws_ok($$select register_push(null,'https://web.push.apple.com/shared','B'||repeat('A',86),
 repeat('Z',22),'PC')$$,'42501',null,'endpoint alone cannot claim an existing subscription');
select isnt(register_push(null,'https://web.push.apple.com/shared','B'||repeat('A',86),repeat('A',22),'iPhone',repeat('1',64)),
 current_setting('test.device')::uuid,'authenticated session with both device keys receives a new delivery id');
select is((select vapid_fingerprint from push_subscriptions),repeat('1',64),'new owner sees fingerprint');
select is(register_push(null,'https://web.push.apple.com/removed','B'||repeat('A',86),repeat('A',22),'PC'),
 null::uuid,'login does not recreate an evicted or deleted device');
select ok(not has_function_privilege('anon','register_push(uuid,text,text,text,text,text)','execute'),'anonymous transfer denied');
reset role;
select is((select push_target from claim_notifications(1)),null::jsonb,'old queued alert cannot target the new owner');
select is_empty($$select id from push_subscriptions where user_id='00000000-0000-0000-0000-000000000049'$$,'previous owner removed');
delete from auth.users where id='00000000-0000-0000-0000-000000000048';
select is_empty('select id from push_subscriptions','withdrawal deletes transferred device');

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
