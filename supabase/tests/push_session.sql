begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000049');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000049','session push');
select set_config('test.app',id::text,true) from apps;
select set_config('test.member',owner_id::text,true) from apps;

create function pg_temp.login(session_id uuid, issued integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.member'),
  'session_id',$1,'iat',$2,'exp',$2+3600)::text,true)
$$;
create function pg_temp.enable(suffix text) returns uuid language sql as $$
 select register_push(current_setting('test.app')::uuid,'https://web.push.apple.com/'||suffix,
  'B'||repeat('A',86),repeat('A',22),'PC')
$$;

select pg_temp.login(null,1);
select throws_ok($$select pg_temp.enable('no-session')$$,'42501',null,'a login without a session claim cannot register');
insert into auth.sessions(id,user_id) values
 ('10000000-0000-0000-0000-000000000049',current_setting('test.member')::uuid);
select pg_temp.login('10000000-0000-0000-0000-000000000049',1);
select set_config('test.live',pg_temp.enable('live')::text,true);
select is((select session_id from push_subscriptions),'10000000-0000-0000-0000-000000000049'::uuid,
 'registration stores the signed session claim');
select is(pg_temp.enable('live'),current_setting('test.live')::uuid,'repeat registration under the same session is idempotent');
select pg_temp.login('10000000-0000-0000-0000-000000000049',3600);
select ok((select current_session from list_push_devices()),'a refreshed JWT sees the original device enabled');

create function pg_temp.subscribed() returns boolean language sql as $$
 select (notification_settings(current_setting('test.app')::uuid)->>'subscribed')::boolean
$$;
select ok(pg_temp.subscribed(),'enabled app has a deliverable device');
select set_push_enabled(current_setting('test.app')::uuid,false);
select is(pg_temp.subscribed(),false,'disabled app has no deliverable device despite a live session');
select set_push_enabled(current_setting('test.app')::uuid,true);
update auth.sessions set not_after=now()-interval '1 second';
select is(pg_temp.subscribed(),false,'only device has expired');
select is((select current_session from list_push_devices()),false,'expired device must opt in again');
update auth.sessions set not_after=null;

-- Simulate client cleanup leaving both the endpoint and DB row intact. End only
-- the affected Auth session, either before the new job or after its claim.
create function pg_temp.blocks_delivery(after_claim boolean, expired boolean) returns boolean language plpgsql as $$
declare
 login_id uuid := gen_random_uuid();
 device uuid;
 job record;
 blocked boolean;
begin
 insert into auth.sessions(id,user_id) values(login_id,current_setting('test.member')::uuid);
 perform pg_temp.login(login_id,1);
 device := pg_temp.enable(login_id::text);
 if after_claim then
  insert into notifications(test_app,channel,event,ok,sent_at,push_device)
   values(current_setting('test.app')::uuid,'push','test',null,null,device);
  select * into strict job from claim_notifications(1);
  if job.push_target->>'device' is distinct from device::text then return false; end if;
 end if;
 if expired then
  update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id=login_id;
 else
  delete from auth.sessions where id=login_id;
 end if;
 if after_claim then
  blocked := prepare_push_delivery(job.id,job.claim_token,job.app) is null;
 else
  insert into notifications(test_app,channel,event,ok,sent_at,push_device)
   values(current_setting('test.app')::uuid,'push','test',null,null,device);
  select * into strict job from claim_notifications(1);
  blocked := job.push_target is null;
 end if;
 return blocked and not exists(select from push_subscriptions p where p.id=device);
end $$;

select ok(pg_temp.blocks_delivery(false,false),'logout before a new job suppresses its claim target and deletes the orphan');
select ok(pg_temp.blocks_delivery(true,false),'logout after claim cancels final delivery and deletes the orphan');
select ok(pg_temp.blocks_delivery(false,true),'claim rejects and prunes an expired session still present in Auth');
select ok(pg_temp.blocks_delivery(true,true),'final preparation rejects and prunes a session that expired after claim');

-- Neither device re-registers before the next incident. The signed-out
-- browser has done no cleanup, and the other browser has refreshed its JWT.
insert into auth.sessions(id,user_id) values
 ('20000000-0000-0000-0000-000000000049',current_setting('test.member')::uuid);
select pg_temp.login('20000000-0000-0000-0000-000000000049',1);
select pg_temp.enable('ended');
delete from auth.sessions where id='20000000-0000-0000-0000-000000000049';
select ok(pg_temp.subscribed(),'another active device still receives pushes for this app');
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/','example' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch'),15,10,1,1500,array[0,15]||array_fill(0,array[14]) from features;
select evaluate_all();
create temp table incident_payloads as select * from claim_notification_payloads(10);
select is((select count(*) from incident_payloads p(payload) where payload->>'channel'='push'
 and payload->'push_target'<>'null'::jsonb),1::bigint,'only one device receives a target for the new incident');
select is_empty($$select from push_subscriptions where endpoint='https://web.push.apple.com/ended'$$,
 'claiming the new incident deletes the signed-out subscription');
create temp table live_job as select (payload->>'id')::uuid id,(payload->>'claim_token')::uuid claim_token,
 (payload->>'app')::uuid app,payload->'push_target' push_target from incident_payloads p(payload)
 where payload->>'channel'='push' and payload->'push_target'<>'null'::jsonb;
select is((select push_target->>'device' from live_job),current_setting('test.live'),
 'other device logout leaves this refreshed session eligible for a new incident');
select is((select prepare_push_delivery(id,claim_token,app)->>'endpoint' from live_job),
 'https://web.push.apple.com/live','the refreshed device can receive the incident');

-- Existing rows have no session. A new opt-in invalidates old notification IDs.
update push_subscriptions set session_id=null where id=current_setting('test.live')::uuid;
select is(pg_temp.subscribed(),false,'legacy row alone does not enable push');
select pg_temp.login('10000000-0000-0000-0000-000000000049',7200);
select is((select current_session from list_push_devices()),false,'legacy device needs explicit opt-in');
select isnt(pg_temp.enable('live'),current_setting('test.live')::uuid,'explicit re-enable gives the device a fresh id');
select is((select prepare_push_delivery(id,claim_token,app) from live_job),null::jsonb,'old lease cannot deliver after re-enable');
update push_subscriptions set session_id=null;
insert into notifications(test_app,channel,event,ok,sent_at,push_device)
 select current_setting('test.app')::uuid,'push','test',null,null,id from push_subscriptions;
select is((select push_target from claim_notifications(1)),null::jsonb,'a legacy device never receives credentials');
select is_empty('select from push_subscriptions','legacy target pruned');

select ok(not has_function_privilege('anon','private.push_session_active(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.push_session_active(uuid,uuid)','execute')
 and has_function_privilege('service_role','private.push_session_active(uuid,uuid)','execute'),
 'only the worker role can call the definer session check');
select ok(not has_column_privilege('authenticated','push_subscriptions','session_id','select'),
 'member device list does not expose raw Auth session ids');

-- Transaction-local mutation control. Run the same probes against the old
-- account-only rule. The other active login must not keep this device alive.
select pg_temp.enable('orphan-settings');
delete from auth.sessions where id=(auth.jwt()->>'session_id')::uuid;
insert into auth.sessions(id,user_id) values(gen_random_uuid(),current_setting('test.member')::uuid);
select is(pg_temp.subscribed(),false,'another login cannot make the only orphaned device deliverable');
create or replace function private.push_session_active(member uuid, login uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from auth.sessions s where s.user_id=member)
$$;
select ok(pg_temp.subscribed(),'member-only mutation incorrectly counts the same orphan device');
select ok(not pg_temp.blocks_delivery(false,false),'claim regression detects member-only mutation');
select ok(not pg_temp.blocks_delivery(true,false),'last-moment regression detects member-only mutation');

select * from finish();
rollback;
