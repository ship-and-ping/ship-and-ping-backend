begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) select id,'dismiss' from auth.users;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/f','f' from apps;
insert into stats_5m select app_id,id,'v1',date_bin('5 minutes',now(),'epoch'),5,5,0,50,
 array[5]||array_fill(0,array[15]) from features;
select evaluate_all();
select set_config('test.issue',(select id::text from incidents),true);
insert into notifications(incident_id,event,channel,ok,sent_at,claimed_at)
 select id,'open',channel,null,null,case when channel='slack' then now() end from incidents
 cross join unnest(array['email','slack']) channel;
select ok(not has_function_privilege('anon','dismiss_incident(uuid)','execute'),'anonymous execution denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
select throws_ok($$select dismiss_incident(current_setting('test.issue')::uuid)$$,'42501',null,'foreign incident denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select dismiss_incident(current_setting('test.issue')::uuid);
select results_eq('select status,closed_at,dismissed_until from incidents',$$select 'dismissed',now(),now()+interval '24 hours'$$,'owner dismisses for 24 hours');
select results_eq('select channel from notifications',$$values ('slack')$$,'only unclaimed delivery removed');
reset role;
update incidents set closed_at=now()-interval '23 hours 59 minutes',dismissed_until=now()+interval '1 minute';
set local role authenticated;
select dismiss_incident(current_setting('test.issue')::uuid);
select is((select dismissed_until from incidents),now()+interval '1 minute','repeat preserves original deadline');
reset role;
select is(evaluate_all(),'[]'::jsonb,'fresh breach before 24-hour deadline stays dismissed');
select * from finish();
rollback;
