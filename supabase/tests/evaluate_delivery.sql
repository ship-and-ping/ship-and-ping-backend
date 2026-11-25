begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) select id,'delivery' from auth.users;
insert into alert_channels(owner_id,slack_webhook_secret_id,email_enabled)
 select owner_id,vault.create_secret('fixture'),true from apps;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/','test' from apps;
insert into stats_5m select app_id,id,'v1',date_bin('5 minutes',now(),'epoch'),15,1,10,1500,array[0,15]||array_fill(0,array[14]) from features;
\getenv db_test_password PGPASSWORD
select format('hostaddr=%s port=%s dbname=%L user=%L password=%L',inet_server_addr(),inet_server_port(),current_database(),current_user,:'db_test_password') as db_test_connection \gset
select dblink_connect('evaluator',:'db_test_connection');
select dblink_exec('evaluator','begin');
select * from dblink('evaluator','select public.evaluate_all()') as t(events jsonb);
select is(evaluate_all(),'[]'::jsonb,'another evaluator holds transaction lock');
select dblink_exec('evaluator','rollback');
select dblink_disconnect('evaluator');
select is(evaluate_all()->0->>'kind','failure','4xx excluded from denominator');
select results_eq('select channel from notifications order by channel',$$values ('email'),('slack')$$,'one pending delivery per enabled channel');
create temp table first_claim as select * from claim_notifications(1);
select is((select count(*) from first_claim),1::bigint,'claim limit');
select is((select count(*) from claim_notifications(5)),1::bigint,'active lease excluded');
update notifications set claimed_at=now()-interval '20 minutes' where id in (select id from first_claim);
select results_eq('select id from claim_notifications(5)','select id from first_claim','expired lease reclaimed');
select complete_notification(id,false,'failed https://example.invalid/path') from first_claim;
select is((select error from notifications where ok=false),'failed [가림]','completion masks URL');
select is((select count(*) from claim_notifications(5)),0::bigint,'completed delivery excluded');
update notifications set queued_at=now()-interval '31 days';
select cleanup_daily();
select is((select count(*) from notifications),0::bigint,'expired pending and completed deleted');
select ok(bool_and(has_function_privilege('service_role',fn,'execute') and not has_function_privilege('anon',fn,'execute')
 and not has_function_privilege('authenticated',fn,'execute')),'delivery RPCs restricted')
 from unnest(array['claim_notifications(integer)','complete_notification(uuid,boolean,text)']) fn;
select * from finish();
rollback;
