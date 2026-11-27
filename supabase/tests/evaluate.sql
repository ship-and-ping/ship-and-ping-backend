begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000006','T6');
insert into app_versions(app_id,version,first_seen_at) select id,'old',now()-interval '5 days' from apps;
insert into features(app_id,kind,feature_key,name)
select id,'deep',label,label from apps cross join unnest(array['fail','slow','missing','learn','streak']) label;
create function pg_temp.results(f text,v text,s text,n int,ms int,age interval) returns void language sql as $$
 insert into attempts(app_id,feature_id,version,attempt_id,status,started_at,ended_at,duration_ms)
 select app_id,id,v,gen_random_uuid(),s,now()-age-i*interval '1 millisecond'-ms*interval '1 millisecond',
 case when s<>'pending' then now()-age-i*interval '1 millisecond' end,case when s<>'pending' then ms end
 from features cross join generate_series(1,n) i where name=f
$$;
create view pg_temp.problems as select f.name,i.* from incidents i join features f on f.id=i.feature_id;
select pg_temp.results('fail','old','success',3,100,'2 minutes');
select pg_temp.results('fail','old','failure',1,100,'1 minute');
select pg_temp.results('slow','old','success',30,100,'3 days');
select private.refresh_baselines();
select pg_temp.results('slow','old','success',10,600,'1 minute');
select pg_temp.results('missing','old','pending',5,0,'10 minutes');
select pg_temp.results('missing','old','success',5,100,'12 minutes');
select pg_temp.results('learn','old','success',29,77,'4 days');
select pg_temp.results('streak','old','failure',3,100,'1 minute');
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'old',date_bin('5 minutes',now(),'epoch'),5,5,0,100,array[5]||array_fill(0,array[15]) from features where name='streak';
select is(jsonb_array_length(evaluate_all()),3,'C6 p95 and 500ms delta, ten attempts half missing, three consecutive failures');
select results_eq('select name,kind from pg_temp.problems order by name',
 $q$values ('missing','unconfirmed'),('slow','slow'),('streak','failure')$q$,'C6 kinds and features');
select is((select count(*) from pg_temp.problems where name='fail'),0::bigint,'four results below minimum');
select is((select count(*) from attempts where status='unconfirmed'),5::bigint,'timeout at ten minutes');
select is((select metric_at_open->>'consecutive' from pg_temp.problems where name='streak'),'true','incident retains three consecutive failures');
select is((select p50_ms from baselines join features on id=feature_id where name='learn'),null::int,'C8 29 successes');
select results_eq($q$select sample_count,observed_min_ms,observed_max_ms from baselines join features on id=feature_id where name='learn'$q$,'select 29,77,77','observations before learning');
select pg_temp.results('learn','old','success',1,77,'1 minute');
select pg_temp.results('fail','old','success',1,100,'1 minute');
select is(jsonb_array_length(evaluate_all()),1,'fifth result opens at exactly 20 percent');
select is((select p50_ms from baselines join features on id=feature_id where name='fail'),null::int,'recent feature has no baseline');
select ok((select p50_ms is not null from baselines join features on id=feature_id where name='learn'),'C8 30 successes after three days');
select is(evaluate_all(),'[]'::jsonb,'same incident once');
select is((select count(*) from notifications where channel='email'),4::bigint,'new app queues email for each incident');
select pg_temp.results('fail','old','success',3,100,'10 seconds');
select pg_temp.results('fail','old','failure',2,100,'10 seconds');
update incidents set last_notified_at=now()-interval '6 hours';
select is(evaluate_all(),'[]'::jsonb,'six hours alone insufficient at 30 percent');
update attempts set status='failure' where attempt_id=(select attempt_id from attempts a join features f on f.id=a.feature_id
 where f.name='fail' and status='success' order by ended_at limit 1);
update incidents set last_notified_at=now()-interval '5 hours';
select is(evaluate_all(),'[]'::jsonb,'no repeat within six hours');
update incidents set last_notified_at=now()-interval '6 hours';
select is(evaluate_all()->0->>'event','worse','doubled and six hours elapsed');
update incidents set last_notified_at=now()-interval '6 hours';
select is(evaluate_all(),'[]'::jsonb,'unchanged severity is not a new worsening');
update incidents set status='dismissed',dismissed_until=now()+interval '24 hours' where kind='unconfirmed';
select is(evaluate_all(),'[]'::jsonb,'dismissed incident suppressed');
update incidents set dismissed_until=now()-interval '1 second' where status='dismissed';
select is(evaluate_all()->0->>'event','open','dismissal expires');
delete from attempts where feature_id=(select id from features where name='streak');
select evaluate_all();
update incidents set below_since=now()-interval '119 minutes' where feature_id=(select id from features where name='streak');
select evaluate_all();
select is((select status from pg_temp.problems where name='streak'),'open','before two hours');
update incidents set below_since=now()-interval '2 hours' where feature_id=(select id from features where name='streak');
select is(evaluate_all(),'[]'::jsonb,'quiet produces no delivery');
select is((select status from pg_temp.problems where name='streak'),'quiet','two continuous hours below threshold');
update incidents set opened_at=now()-interval '30 minutes';
insert into app_versions(app_id,version,first_seen_at) select id,'new',now()-interval '5 minutes' from apps;
select is(evaluate_all(),'[]'::jsonb,'C7 waits for new version usage');
update incidents set below_since=now()-interval '2 hours' where kind='failure' and status='open';
delete from attempts where feature_id=(select id from features where name='fail');
select pg_temp.results('fail','old','success',5,100,'2 minutes');
select evaluate_all();
select is((select status from pg_temp.problems where name='fail'),'open','new version blocks quiet and original version cannot resolve');
select pg_temp.results('fail','new','success',4,100,'2 minutes');
select is(evaluate_all(),'[]'::jsonb,'four new successes insufficient');
select pg_temp.results('fail','new','failure',1,100,'1 minute');
select pg_temp.results('fail','new','success',5,100,'10 seconds');
select is(evaluate_all()->0->>'event','resolved','C7 five consecutive new successes after failure');
select is((select resolved_version from pg_temp.problems where name='fail'),'new','resolved version');
update incidents set closed_at=now()-interval '5 seconds' where status='resolved';
select pg_temp.results('fail','new','success',1,100,'1 second');
select is(evaluate_all(),'[]'::jsonb,'a new healthy result cannot reopen a resolved window using old failures');
select pg_temp.results('slow','new','success',5,601,'1 minute');
select is(evaluate_all(),'[]'::jsonb,'601ms exceeds the recovery limit');
select pg_temp.results('slow','new','success',5,600,'10 seconds');
select is(evaluate_all()->0->>'event','resolved','five results at p95 plus 500 ms');
select pg_temp.results('learn','new','success',40,900,'10 seconds');
select evaluate_all();
select is((select p50_ms from baselines join features on id=feature_id where name='learn'),77,'baseline stays fixed for six hours');
update baselines set computed_at=now()-interval '6 hours' where feature_id=(select id from features where name='learn');
select evaluate_all();
select results_eq($q$select p50_ms,p90_ms from baselines join features on id=feature_id where name='learn'$q$,
 'select 900,900','six-hour refresh updates both interpolated percentiles');
select ok(not has_function_privilege('authenticated','evaluate_all()','execute')
 and not has_function_privilege('anon','evaluate_all()','execute')
 and has_function_privilege('service_role','evaluate_all()','execute'),'Worker-only RPC');
select * from finish();
rollback;
