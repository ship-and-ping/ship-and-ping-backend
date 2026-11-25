begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000006');
insert into apps(owner_id,name) select id,'boundaries' from auth.users;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,feature_key,name) select id,'deep',n,n from apps cross join
 unnest(array['speed','missing','majority']) n;
create function pg_temp.results(f text,s text,n int,ms int,age interval) returns void language sql as $$
 insert into attempts(app_id,feature_id,version,attempt_id,status,started_at,ended_at,duration_ms)
 select app_id,id,'v1',gen_random_uuid(),s,now()-age,case when s<>'pending' then now()-age end,ms
 from features cross join generate_series(1,n) i where name=f
$$;
select pg_temp.results('speed','success',4,6000,'1 minute');
select pg_temp.results('missing','pending',9,0,'11 minutes');
select is(evaluate_all(),'[]'::jsonb,'four slow successes and nine missing attempts');
select pg_temp.results('missing','pending',1,0,'9 minutes');
select pg_temp.results('missing','success',10,100,'1 minute');
select evaluate_all();
select is((select count(*) from attempts where status='pending'),1::bigint,'less than ten minutes stays pending');
select pg_temp.results('missing','pending',40,0,'11 minutes');
select pg_temp.results('missing','success',40,100,'1 minute');
select is(evaluate_all(),'[]'::jsonb,'49 missing out of 100');
select pg_temp.results('speed','success',1,6000,'1 minute');
select is(evaluate_all()->0->>'kind','slow','slow opens before learning');
update incidents set last_notified_at=now()-interval '7 hours';
insert into baselines(feature_id,p50_ms,sample_count) select id,3000,30 from features where name='speed'
 on conflict(feature_id) do update set p50_ms=3000;
select is(evaluate_all(),'[]'::jsonb,'learning baseline cannot double unchanged latency');
update attempts set duration_ms=5700 where feature_id=(select id from features where name='speed');
select is((select breached from private.evaluation_signals s join features f on f.id=s.feature_id where f.name='speed' and s.kind='slow'),false,'1.9x is below threshold');
select pg_temp.results('speed','failure',7,20000,'1 minute');
select is((select breached from private.evaluation_signals s join features f on f.id=s.feature_id where f.name='speed' and s.kind='slow'),false,'failed durations excluded from median');
select pg_temp.results('majority','failure',3,100,'1 minute');
select pg_temp.results('majority','success',2,100,'1 minute');
select evaluate_all();
update incidents set last_notified_at=now()-interval '7 hours';
select pg_temp.results('majority','failure',3,100,'1 minute');
select is(evaluate_all()->0->>'event','worse','opening above 50 percent uses doubled failure count');
select pg_temp.results('majority','success',15,60,'4 days');
select pg_temp.results('majority','success',15,80,'4 days');
delete from attempts where feature_id=(select id from features where name='majority') and duration_ms=100;
select evaluate_all();
select is((select p50_ms from baselines b join features f on f.id=b.feature_id where f.name='majority'),70,'median interpolates between successful samples inside one bin');
select * from finish();
rollback;
