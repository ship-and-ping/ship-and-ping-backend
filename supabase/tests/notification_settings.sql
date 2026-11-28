begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000061','member@example.invalid'),
 ('00000000-0000-0000-0000-000000000062','other@example.invalid');
insert into apps(owner_id,name) select id,'fixture' from auth.users;
select set_config('test.app',id::text,true) from apps where owner_id='00000000-0000-0000-0000-000000000061';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000061',true);
select is(notification_settings(current_setting('test.app')::uuid)->>'email','true','new apps receive email by default');
select set_notification_email(current_setting('test.app')::uuid,false);
select connect_slack(current_setting('test.app')::uuid,'fixture','#fixture','T/C');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000061',true);
select is(notification_settings(current_setting('test.app')::uuid),
 '{"connected":true,"channel":"#fixture","email":false,"broken":false,"push":true,"subscribed":false}'::jsonb,'safe settings only');
select ok(queue_test_notification(current_setting('test.app')::uuid),'first test queued');
select ok(not queue_test_notification(current_setting('test.app')::uuid),'second test in the same minute denied');
select set_config('test.ticket',start_slack_state(current_setting('test.app')::uuid)::text,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000062',true);
select is(consume_slack_state(current_setting('test.ticket')::uuid),null::uuid,'other session cannot consume ticket');
select throws_ok($$select set_notification_email(current_setting('test.app')::uuid,true)$$,'42501',null,'cannot edit other app');
select throws_ok($$select notification_settings(current_setting('test.app')::uuid)$$,'42501',null,'cannot read other app');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000061',true);
select is(consume_slack_state(current_setting('test.ticket')::uuid),current_setting('test.app')::uuid,'matching session consumes ticket');
select is(consume_slack_state(current_setting('test.ticket')::uuid),null::uuid,'ticket cannot be replayed');
select set_config('test.ticket',start_slack_state(current_setting('test.app')::uuid)::text,true);
reset role;
update private.slack_states set expires_at=now()-interval '1 second';
select is(consume_slack_state(current_setting('test.ticket')::uuid),null::uuid,'expired ticket rejected');
create temp table slack_claim as select * from claim_notifications(1);
select is((select hook from slack_claim),'fixture','only delivery receives decrypted hook');
select slack_failed(id,claim_token,secret_id) from slack_claim;
select ok((notification_settings(current_setting('test.app')::uuid)->>'broken')::boolean,'revocation visible to member');
create temp table email_claim as select * from claim_notifications(1);
select is((select app_name from email_claim),'fixture','mail claim includes its app name');
select is((select is_overflow from email_claim),false,'test mail without a feature is not overflow');
select ok(has_function_privilege('service_role','public.claim_notifications(integer)','execute')
 and not has_function_privilege('authenticated','public.claim_notifications(integer)','execute')
 and not has_function_privilege('anon','public.claim_notifications(integer)','execute'),'only delivery may claim');
select is((select channel||' '||email from email_claim),'email member@example.invalid','revocation uses login email even with email off');
select is((select count(*) from generate_series(1,21) where reserve_mail(current_setting('test.app')::uuid)),20::bigint,'member daily cap');
select is((select used from private.mail_quota where day=(now() at time zone 'UTC')::date),20,'member overflow consumes no global slots');
update private.mail_quota set used=89;
select ok(reserve_mail((select id from apps where owner_id='00000000-0000-0000-0000-000000000062')),'another member can claim last global slot');
select ok(not reserve_mail((select id from apps where owner_id='00000000-0000-0000-0000-000000000062')),'global cap');
select defer_mail(id,claim_token) from email_claim;
select ok((select digest and claim_token is null and available_at=((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC' from notifications),'excess waits for next morning');
select is_empty('select * from claim_notifications(1)','digest not ready yet');
insert into notifications(test_app,channel,event,ok,sent_at,digest)
 select current_setting('test.app')::uuid,'email','test',null,null,true from generate_series(1,13);
create temp table digest_claim as select * from claim_notifications(1);
select is((select expand_mail_digest(id,claim_token) from digest_claim),12,'digest expands beyond claim limit for the same recipient');
select complete_notification(id,claim_token,true,null) from digest_claim;
select is((select count(*) from notifications where ok),13::bigint,'one completion settles all entries in the digest');
select disconnect_slack(current_setting('test.app')::uuid);
select is_empty($$select from vault.decrypted_secrets where decrypted_secret='fixture'$$,'disconnect removes secret');
insert into features(app_id,kind,method,route,name)
 values (current_setting('test.app')::uuid,'auto','GET','/search','기타'),
        (current_setting('test.app')::uuid,'auto','*','*','기타');
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
 select app_id,id,'failure','open',now(),'v1' from features where app_id=current_setting('test.app')::uuid;
insert into notifications(incident_id,channel,event,sent_at,ok)
 select id,'email','open',null,null from incidents where app_id=current_setting('test.app')::uuid;
select results_eq(
 $$select f.method,c.feature,c.is_overflow from claim_notifications(2) c
   join incidents i on i.id=c.incident join features f on f.id=i.feature_id order by f.method$$,
 $$values ('*','기타',true),('GET','기타',false)$$,
 'identically named features are distinguished by the overflow route');
select * from finish();
rollback;
