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
select * from finish();
rollback;
