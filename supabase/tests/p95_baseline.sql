begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000046');
insert into apps(owner_id,name) select id,label from auth.users cross join unnest(array['T46','outages']) label;
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,feature_key,name)
select id,'deep',label,label from apps cross join unnest(array['search','fast','cap','sparse','failure','slow']) label
where (name='outages')=(label in ('failure','slow'));

create function pg_temp.samples(label text, n int, ms int, age interval) returns void language sql as $$
 insert into attempts(app_id,feature_id,version,attempt_id,status,started_at,ended_at,duration_ms)
 select app_id,id,'v1',gen_random_uuid(),'success',now()-age-ms*interval '1 ms',now()-age,ms
 from features cross join generate_series(1,n) where name=label
$$;
select pg_temp.samples(name,27,case when name='fast' then 100 else 200 end,'12 hours') from features;
select pg_temp.samples(name,3,case when name='fast' then 100 else 400 end,'12 hours') from features;
insert into incidents(app_id,feature_id,kind,status,opened_at,opened_version)
 select app_id,id,name,'open',now()-interval '3 hours','v1' from features where name in ('failure','slow');
select pg_temp.samples(name,100,9000,'2 hours') from features where name in ('failure','slow');
select pg_temp.samples('search',10,1400,'2 minutes');
select private.refresh_baselines();
select results_eq($$select sample_count,p50_ms,p95_ms from baselines join features on id=feature_id
 where name in ('search','failure','slow') order by name$$,
 'values (30,200,400),(30,200,400),(30,200,400)','one day suffices and both incident kinds exclude affected samples');
create temp view speeds as select name,breached,severity,metric from private.evaluation_signals s
 join features f on s.feature_id=f.id where s.kind='slow';
select pg_temp.samples('search',80,200,'20 minutes');
select results_eq($$select breached,severity,(metric->>'baseline_p50')::int,(metric->>'baseline_p95')::int,
 (metric->>'window')::int,(metric->>'total')::int from speeds where name='search'$$,
 'select true,7::numeric,200,400,10,10','ten successes select the short window and report sevenfold severity');
update attempts set duration_ms=500 where duration_ms=1400;
select is((select breached from speeds where name='search'),false,'300 ms above baseline is insufficient');
update attempts set duration_ms=700 where duration_ms=500;
select is((select breached from speeds where name='search'),true,'exactly 500 ms above p50 qualifies');
select pg_temp.samples('fast',10,250,'1 minute');
select is((select breached from speeds where name='fast'),false,'100 to 250 ms remains normal');
update features set slow_threshold_ms=1000 where name='cap';
update baselines set p50_ms=1000,p95_ms=1500 where feature_id=(select id from features where name='cap');
select pg_temp.samples('cap',10,1100,'1 minute');
select is((select breached from speeds where name='cap'),true,'custom absolute limit overrides normal range');
update attempts set duration_ms=900 where attempt_id in
 (select attempt_id from attempts join features on id=feature_id where name='cap' and duration_ms=1100 limit 5);
update attempts set duration_ms=1050 where duration_ms=1100 and feature_id=(select id from features where name='cap');
select results_eq($$select breached,(metric->>'p50')::int,(metric->>'slow')::int from speeds where name='cap'$$,
 'select true,975,5','deep cap counts five of ten successes even with median below the threshold');
select pg_temp.samples('sparse',9,1400,'2 minutes');
select pg_temp.samples('sparse',1,1400,'20 minutes');
select results_eq($$select breached,(metric->>'window')::int,(metric->>'total')::int from speeds where name='sparse'$$,
 'select true,30,10','nine recent successes use the longer window');

-- Automatic timings are five-minute histograms. A closed outage continues to
-- exclude the overlapping bucket, while later healthy traffic can be learned.
insert into features(app_id,kind,name,route,method) select id,'auto','auto','/auto','GET' from apps where name='T46';
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch')-age,n,0,0,n*ms,
 array_fill(0,array[bin-1])||array[n]||array_fill(0,array[16-bin])
 from features cross join (values (interval '1 day',25,200,3),(interval '2 hours',100,2000,9),
 (interval '1 hour',5,500,5),(interval '8 days',50,3000,10)) b(age,n,ms,bin) where name='auto';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version)
 select app_id,id,'failure','resolved',date_bin('5 minutes',now(),'epoch')-interval '119 minutes',
 now()-interval '90 minutes','v1' from features where name='auto';
select private.refresh_baselines();
select results_eq($$select sample_count,p50_ms,p95_ms from baselines join features on id=feature_id where name='auto'$$,
 'select 30,200,500','auto excludes a partially overlapping bucket, resumes learning, and respects the seven-day cutoff');
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'v1',date_bin('5 minutes',now(),'epoch')-age,n,0,0,n*ms,
 array_fill(0,array[bin-1])||array[n]||array_fill(0,array[16-bin])
 from features cross join (values (interval '20 minutes',25,200,3),(interval '0 minutes',10,1400,8)) b(age,n,ms,bin)
 where name='auto';
select results_eq($$select breached,(metric->>'window')::int,(metric->>'p50')::int from speeds where name='auto'$$,
 'select true,10,1400','legacy one-bin data uses its measured mean for interpolation');
select * from finish();
rollback;
