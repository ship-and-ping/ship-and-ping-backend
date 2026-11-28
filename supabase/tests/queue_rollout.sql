begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000005901');
insert into apps(id,owner_id,name) select id,id,'rollout' from auth.users;
insert into app_keys(app_id,kind,prefix,key_hash) select id,'srv','test',repeat('9',64) from apps;

create function pg_temp.traffic(path text,release text,stamp timestamptz,ms int,n int,has_queue boolean)
returns void language sql as $$
 select ingest_batch(repeat('9',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version',release,
  'platform','server','attempts','[]'::jsonb,'error_samples','[]'::jsonb,'stats',jsonb_build_array(jsonb_build_object(
  'method','GET','route',path,'bucket',date_bin('5 minutes',stamp,timestamptz 'epoch'),
  'total',n,'failures',0,'client_errors',0,'duration_sum_ms',n*ms,
  'hist',array(select case when i=private.duration_bin(ms,16) then n else 0 end from generate_series(1,16) i),
  'timings',(select jsonb_agg(jsonb_build_array(i,ms,true,has_queue)) from generate_series(1,n) i),
  'queue_count',case when has_queue then n else 0 end,'queue_ms_sum',case when has_queue then n*600 else 0 end,
  'queue_total_ms',case when has_queue then n*ms else 0 end))));
$$;
select pg_temp.traffic('/basis','same',now()-interval '1 day',127,80,false);
select private.refresh_baselines();
select pg_temp.traffic('/basis','same',now(),727,12,true);
select private.refresh_baselines();
select is((select p50_ms from baselines),null::integer,'old 127ms baseline is unavailable to inclusive samples');
select is((select breached from private.method_slow_signals),false,'727ms inclusive cannot breach against old 127ms');
update features set slow_threshold_ms=700 where route='/basis';
select is((select breached from private.method_slow_signals),true,'absolute cap remains enabled during warmup');
update features set slow_threshold_ms=5000 where route='/basis';
select pg_temp.traffic('/basis','same',now()-interval '1 day',727,29,true);
select private.refresh_baselines();
select is((select n from private.latency_baselines where inclusive),29::bigint,'only matching successful samples count');
select is((select p50 from private.latency_baselines where inclusive),null::integer,'29 inclusive successes still warming');
select pg_temp.traffic('/basis','same',now()-interval '1 day',727,1,true);
select private.refresh_baselines();
select results_eq($q$select inclusive,p50,p95 from private.latency_baselines order by inclusive$q$,
 'select * from (values(false,127,127),(true,727,727)) expected','same version and bucket retain independent baselines');
select pg_temp.traffic('/basis','same',now(),1327,40,true);
select ok((select breached and metric->>'timing_basis'='inclusive' and (metric->>'baseline')::int=727
 from private.method_slow_signals),'new inclusive slowdown compares with inclusive p95');

create temporary table gap as select date_bin('5 minutes',now()-interval '4 minutes',timestamptz 'epoch')
 +interval '1 minute' stamp;
select pg_temp.traffic('/reopen','v1',stamp,127,1,false) from gap;
select pg_temp.traffic('/reopen','v2',stamp,127,1,false) from gap;
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version)
 select f.app_id,f.id,'failure','resolved',stamp-interval '2 minutes',stamp-interval '15 seconds','v1'
 from features f cross join gap where route='/reopen';
select ok((select s.version is null from private.evaluation_before_queue s join features f on f.id=s.feature_id
 where f.route='/reopen' and s.kind='failure'),'T46 excludes the five-minute bucket of the closed incident');

create function pg_temp.feed(path text,start_at timestamptz) returns void language sql as $$
 insert into private.request_flow_seconds(feature_id,stamp,completed,interrupted,version)
 select f.id,start_at+sec*interval '1 second',1,0,'v1' from features f
 cross join generate_series(-185,-1) sec where f.route=path
 union all select f.id,start_at+interval '10 seconds',1,0,'v1' from features f where f.route=path
 union all select f.id,start_at+interval '5 seconds',0,1,'v1' from features f where f.route=path
 union all select f.id,start_at+interval '5 seconds',0,10,'v2' from features f where f.route=path;
$$;
select pg_temp.feed('/reopen',stamp) from gap;
select evaluate_all();
select results_eq($q$select opened_version,(metric_at_open->>'interruptions')::int from incidents i
 join features f on f.id=i.feature_id where f.route='/reopen' and i.status='open'$q$,
 $$select 'v2'::text,11$$,'same-bucket reopening uses the interrupted release');
select ok(exists(select from incidents i join features f on f.id=i.feature_id where route='/basis' and i.kind='slow'),
 'independent signal commits in same evaluation');

select pg_temp.traffic('/late','v2',now(),127,1,false);
select pg_temp.feed('/late',date_trunc('second',now())-interval '50 seconds');
select ok(not exists(select from private.stalled_features s join features f on f.id=s.feature_id where route='/late'),
 'fifty-second-old evidence waits for delayed batches');
-- Replay the identical candidate as mature, now with the delayed old-agent completion.
delete from private.request_flow_seconds where feature_id=(select id from features where route='/late');
select pg_temp.feed('/late',date_trunc('second',now())-interval '130 seconds');
insert into private.request_flow_seconds(feature_id,stamp,completed,interrupted,version)
 select id,date_trunc('second',now())-interval '125 seconds',1,0,'v0' from features where route='/late';
select ok(not exists(select from private.stalled_features s join features f on f.id=s.feature_id where route='/late'),
 'old-version completion vetoes mature stall for the whole feature');
select pg_temp.traffic('/invalid','v2',now(),5100,10,false);
select pg_temp.traffic('/independent','v2',now(),5100,10,false);
create function pg_temp.reject_test_signal() returns trigger language plpgsql as $$
begin
 if new.feature_id=(select id from public.features where route='/invalid') then
  raise check_violation using message='test invalid incident';
 end if;
 return new;
end $$;
create trigger test_invalid_signal before insert on incidents for each row execute function pg_temp.reject_test_signal();
select evaluate_all();
select results_eq($q$select route from incidents i join features f on f.id=i.feature_id
 where route in ('/invalid','/independent') and i.kind='slow'$q$,$$select '/independent'::text$$,
 'one invalid signal rolls back only its incident and notification');
-- The larger closed gap must not hide a later, smaller one.
select pg_temp.traffic('/two-stalls','v1',now(),127,1,false);
create temporary table windows as select date_trunc('second',now())-interval '350 seconds' older,
 date_trunc('second',now())-interval '130 seconds' newer;
select pg_temp.feed('/two-stalls',older) from windows;
select pg_temp.feed('/two-stalls',newer) from windows;
update private.request_flow_seconds set interrupted=123 where feature_id=(select id from features where route='/two-stalls')
 and stamp=(select older+interval '5 seconds' from windows) and version='v2';
insert into incidents(app_id,feature_id,kind,status,opened_at,closed_at,opened_version)
 select app_id,id,'failure','resolved',older,older+interval '1 minute','v1' from features cross join windows where route='/two-stalls';
select evaluate_all();
select is((select (metric_at_open->>'interruptions')::int from incidents i join features f on f.id=i.feature_id
 where route='/two-stalls' and i.status='open'),11,'smaller post-resolution stall reopens');

select pg_temp.traffic('/recovery','v1',now()-interval '1 day',127,40,false);
select pg_temp.traffic('/recovery','v1',now()-interval '1 day',900,40,true);
select pg_temp.traffic('/recovery','v1',now(),700,10,false);
select evaluate_all();
select is((select metric_at_open->>'timing_basis' from incidents i join features f on f.id=i.feature_id
 where route='/recovery'),'handler','handler baseline opens 700ms slowdown');
update incidents set opened_at=now()-interval '1 second' where feature_id=(select id from features where route='/recovery');
select pg_temp.traffic('/recovery','v2',now(),700,5,false);
select evaluate_all();
select is((select status from incidents i join features f on f.id=i.feature_id where route='/recovery'),'open',
 'five equally slow successes cannot resolve against a larger inclusive baseline');
select pg_temp.traffic('/recovery','v2',now(),600,5,true);
select evaluate_all();
select is((select status from incidents i join features f on f.id=i.feature_id where route='/recovery'),'open',
 'five successes from the other measurement method cannot verify the fix');
select pg_temp.traffic('/recovery','v2',now(),127,5,false);
select evaluate_all();
select is((select status from incidents i join features f on f.id=i.feature_id where route='/recovery'),'resolved',
 'five healthy successes from the opening method verify the fix');

select pg_temp.traffic('/combined','v1',now(),5100,3,false);
select pg_temp.traffic('/combined','v1',now(),5200,3,true);
select evaluate_all();
select results_eq($q$select (metric_at_open->>'total')::int,(metric_at_open->>'slow')::int from incidents i
 join features f on f.id=i.feature_id where route='/combined' and i.kind='slow'$q$,
 'select 6,6','absolute cap uses all successes from both methods');

-- Corrupt only the first app. The second app must refresh and open its incident
-- whether the first one fails on historical data or when reading a recent signal.
insert into auth.users(id) values ('00000000-0000-0000-0000-000000005902');
insert into apps(id,owner_id,name) values ('00000000-0000-0000-0000-000000005902','00000000-0000-0000-0000-000000005902','independent app');
insert into app_keys(app_id,kind,prefix,key_hash) values ('00000000-0000-0000-0000-000000005902','srv','test',repeat('8',64));
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/other','other' from apps where name='independent app';
insert into app_versions(app_id,version) select id,'other-v1' from apps where name='independent app';
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'other-v1',date_bin('5 minutes',now(),timestamptz 'epoch'),6,6,0,60,array[6]||array_fill(0,array[15])
 from features where route='/other';
update private.queue_success_5m set counts='{"broken-key":1}' where feature_id=(select id from features where route='/basis')
 and bucket<now()-interval '1 hour';
delete from private.latency_baselines where feature_id=(select id from features where route='/basis');
select lives_ok('select evaluate_all()','bad historical counts are isolated during baseline refresh');
select is((select count(*) from incidents i join features f on f.id=i.feature_id where route='/other'),1::bigint,
 'independent app opens despite invalid historical counts');
delete from incidents where feature_id=(select id from features where route='/other');
update private.queue_success_5m set counts=null where counts ? 'broken-key';
select private.refresh_baselines();
update private.queue_success_5m set counts='{"broken-key":1}' where feature_id=(select id from features where route='/basis')
 and bucket>=now()-interval '10 minutes';
select lives_ok('select evaluate_all()','bad current counts are isolated during signal selection');
select is((select count(*) from incidents i join features f on f.id=i.feature_id where route='/other'),1::bigint,
 'independent app opens despite invalid recent counts');
select * from finish();
rollback;
