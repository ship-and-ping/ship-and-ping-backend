begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000045');
insert into apps(owner_id,name) select id,'duration' from auth.users;
insert into app_keys(app_id,kind,prefix,key_hash) select id,'pub','fixture',repeat('0',64) from apps;

-- Build the wire-format counts independently of the database binning helper.
create function pg_temp.record(route text, samples integer[], age interval default '5 minutes',
                              failed integer default 0, legacy boolean default false) returns jsonb language sql as $$
 with bounds as (
  select edge,i from unnest(array[50,100,200,300,500,750,1000,1500,2000,3000,
    3300,3600,3900,4200,4500,4800,5000,5100,5400,5700,6000,6300,6600,6900,7200,7500,
    10000,20000,30000,600000]) with ordinality as b(edge,i)
 ), events as (
  select ms,pos,(select min(i) from bounds where edge>=ms) bin from unnest(samples) with ordinality e(ms,pos)
 )
 select ingest_batch(repeat('0',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
  'stats',jsonb_build_array(jsonb_build_object('method','GET','route',route,
   'bucket',date_bin('5 minutes',now()-age,'epoch'),'total',cardinality(samples),'failures',failed,
   'client_errors',0,'duration_sum_ms',(select sum(ms) from events),
   'hist',array(select (select count(*) from events where ms>lower_ms and ms<=upper_ms)
     from (select edge upper_ms,lag(edge,1,-1) over(order by edge) lower_ms
           from unnest(array[50,100,200,300,500,750,1000,1500,2000,3000,5000,7500,10000,20000,30000,600000]) edge) legacy_bins
     order by upper_ms),
   'timings',(select jsonb_agg(jsonb_build_array(pos,ms,pos>failed) order by pos) from events))
   || case when legacy then '{}'::jsonb else jsonb_build_object('hist_30',
      array(select (select count(*) from events where bin=i) from bounds order by i)) end)));
$$;

select pg_temp.record('/long',array(select 6000+round(i*500.0/29)::int from generate_series(0,29) i));
select pg_temp.record('/short',array(select 3000+round(i*600.0/29)::int from generate_series(0,29) i));
-- A second 30-request fixture matches the reported 6350 ms mean (median 6300 ms).
select pg_temp.record('/field',array[6000,6000,6000,6100]||array_fill(6300,array[13])||array_fill(6500,array[13]));
select pg_temp.record('/edge',array[5000,5000,5000,5001,5001,5001]);
select pg_temp.record('/below',array[5000,5000,5000,5000,5001,5001]);
create temp view speeds as select f.route,s.metric,s.breached from private.evaluation_signals s
 join features f on f.id=s.feature_id where s.kind='slow';
select results_eq('select route,(metric->>''p50'')::numeric,breached from speeds order by route',
 $$values ('/below',5000,false),('/edge',5000.5,true),('/field',6300,true),('/long',6250,true),('/short',3300,false)$$,
 '30-sample medians and strict >5s on exactly half the requests');
select evaluate_all();
select is((select (metric_at_open->>'p50')::int from incidents join features on features.id=feature_id
 where route='/long' and incidents.kind='slow'),6250,'opening snapshot uses measured success p50');

-- Failed calls in the same bucket cannot move the success median.
select pg_temp.record('/long',array_fill(50,array[31]),'5 minutes',31);
select is((select (metric->>'p50')::int from speeds where route='/long'),6250,'only successes contribute');
select pg_temp.record('/baseline',array_fill(3300,array[30]),'4 days');
select pg_temp.record('/baseline',array_fill(6300,array[5]));
select evaluate_all();
select results_eq($$select p50_ms,p90_ms from baselines join features on features.id=feature_id where route='/baseline'$$,
 'select 3300,3300','recent load is excluded from the seven-day baseline');
select is((select breached from speeds where route='/baseline'),true,'6300 exceeds the absolute 5000ms cap');
select pg_temp.record('/baseline',array_fill(6600,array[6]));
select is((select breached from speeds where route='/baseline'),true,'6600 exceeds baseline p95 and the cap');

with h as (select array_fill(0,array[11])||array[3,0,0,0,0] old,
 array_fill(0,array[21])||array[2]||array_fill(0,array[8]) fine)
select ok(private.hist_percentile(old,0.5)=7500
 and private.hist_percentile(private.add_hist(old,fine),0.5)=7500
 and private.add_hist(old,fine)=private.add_hist(fine,old)
 and private.hist_percentile(private.add_hist(old,fine),0.25)=6300,
 'mixed rollups retain old upper bounds and fine counts in either order') from h;
select is(private.hist_percentile(array_fill(0,array[30]),0.5),null::int,'empty histogram');
select is(private.hist_above(array_fill(0,array[10])||array[3,0,0,0,0,0],3300),0::bigint,
 'changed custom threshold stays conservative with old counts');
select is(private.hist_above(array_fill(0,array[10])||array[2,3]||array_fill(0,array[18]),3300),3::bigint,
 'changed custom threshold excludes the boundary itself with refined counts');
select pg_temp.record('/mixed',array_fill(3200,array[5]),legacy=>true);
select pg_temp.record('/mixed',array[3200]);
update features set slow_threshold_ms=3300 where route='/mixed';
select results_eq($$select (metric->>'slow')::int,(metric->>'total')::int,breached from speeds where route='/mixed'$$,
 'select 0,6,false','five legacy and one refined success below the new threshold stay below it');
select pg_temp.record('/mixed',array[3301,4900]);
select is((select (metric->>'slow')::int from speeds where route='/mixed'),2,
 'refined observations above the custom threshold remain countable after another merge');
update features set slow_threshold_ms=3000 where route='/mixed';
select is((select (metric->>'slow')::int from speeds where route='/mixed'),8,
 'legacy observations count when their entire interval exceeds the new threshold');
-- Old clients can contribute a histogram without exact timings to the same bucket.
select pg_temp.record('/partial',array[4900]);
update stats_5m set total=6,duration_sum_ms=20900,
 hist=private.add_hist(hist,array_fill(0,array[10])||array[5,0,0,0,0,0])
 where feature_id=(select id from features where route='/partial');
update features set slow_threshold_ms=3300 where route='/partial';
select is((select breached from speeds where route='/partial'),false,
 'one exact timing cannot certify that the other five legacy requests exceeded a custom cap');
select pg_temp.record('/upper-mixed',array[6400,7300]);
select pg_temp.record('/upper-mixed',array_fill(6100,array[5]),legacy=>true);
select is((select (metric->>'slow')::int from speeds where route='/upper-mixed'),7,
 'the exact original threshold count survives mixing in reverse order');
update features set slow_threshold_ms=6300 where route='/upper-mixed';
select is((select (metric->>'slow')::int from speeds where route='/upper-mixed'),2,
 'changing to 6.3s counts only the two refined observations known to exceed it');
select throws_ok(format('select ingest_batch(%L,%L::jsonb)',repeat('0',64),
 jsonb_build_object('stats',jsonb_build_array(jsonb_build_object('hist',array_fill(0,array[32]))))),
 '22023','invalid histogram layout','32-counter mixed layout is reserved for stored aggregates');
select throws_ok(format('select ingest_batch(%L,%L::jsonb)',repeat('0',64),
 jsonb_build_object('stats',jsonb_build_array(jsonb_build_object('hist_30',array_fill(0,array[16]))))),
 '22023','invalid histogram layout','optional refined array requires exactly 30 counters');

-- First evaluation must learn only from traffic before the detection window.
select pg_temp.record('/review',array_fill(200,array[27])||array[400,400,400],'2 hours');
select pg_temp.record('/review',array_fill(1400,array[10]),'2 minutes');
select evaluate_all();
select results_eq($$select sample_count,p50_ms,p95_ms from baselines join features on id=feature_id where route='/review'$$,
 'select 30,200,400','startup load cannot raise the normal p95');
select results_eq($$select (metric_at_open->>'p50')::int,(metric_at_open->>'severity')::numeric
 from incidents join features on features.id=feature_id where route='/review' and incidents.kind='slow'$$,
 'select 1400,7::numeric','automatic and deep report the same 1400 ms and sevenfold slowdown');
select pg_temp.record('/normal',array_fill(200,array[27])||array[400,400,400],'2 hours');
select private.refresh_baselines();
select pg_temp.record('/normal',array_fill(600,array[10]),'2 minutes');
select results_eq($$select breached,(metric->>'p50')::int from speeds where route='/normal'$$,
 'select false,600','600 ms is below the 700 ms opening boundary');
select pg_temp.record('/custom',array_fill(1000,array[30]),'1 day');
update features set slow_threshold_ms=1100 where route='/custom';
select pg_temp.record('/custom',array[30,40]||array_fill(1050,array[4])||array_fill(1200,array[6]),failed=>2);
select private.refresh_baselines();
select results_eq($$select breached,(metric->>'p50')::int from speeds where route='/custom'$$,
 'select true,1200','six of ten successes exceed 1100 ms regardless of two fast failures');
create temp table display_bucket as select s as stored from stats_5m s join features f on f.id=s.feature_id
 where f.route='/custom' order by s.bucket desc limit 1;
grant select on display_bucket to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000045',true);
select is((select success_durations(stored) from display_bucket),'{"1050":4,"1200":6}'::jsonb,
 'owner dashboard uses the same successes as evaluation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000046',true);
select is((select success_durations(stored) from display_bucket),'{}'::jsonb,'another member cannot read durations even with the bucket key');
reset role;
select pg_temp.record('/boundary',array_fill(200,array[30]),'1 day');
select pg_temp.record('/boundary',array_fill(200,array[80]),'22 minutes');
select pg_temp.record('/boundary',array_fill(1400,array[10]),'10 minutes');
select private.refresh_baselines();
select results_eq($$select breached,(metric->>'window')::int,(metric->>'total')::int from speeds where route='/boundary'$$,
 'select true,10,10','the overlapping start bucket remains in the ten-minute window');
-- CI mutation experiment, scoped to this test's rolled-back transaction.
create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), windows(kind,minutes) as (values ('failure',30),('slow',30),('slow',10)), active as materialized (
  select s.*,f.slow_threshold_ms from private.speed_buckets s join public.features f on f.id=s.feature_id and f.kind='auto'
  where s.bucket between date_bin('5 minutes',now()-interval '30 minutes',timestamptz 'epoch') and now()
 ), window_buckets as materialized (
  select s.*,k.kind,k.minutes from active s cross join windows k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket>=date_bin('5 minutes',now()-k.minutes*interval '1 minute',timestamptz 'epoch')
   and (c.closed_at is null or s.bucket>c.closed_at)
 ), points as (
  select s.feature_id,s.minutes,p.ms,sum(p.n)::bigint n
  from window_buckets s cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
  where s.kind='slow' group by 1,2,3
 ), medians as (
  select feature_id,minutes,sum(n) successes,
   (private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5]))[1] p50
  from points group by 1,2
 ), totals as (
  select s.feature_id,s.kind,s.minutes,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(case when s.threshold_ms=s.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else coalesce(private.hist_above(case when s.client_errors=0 then s.hist else s.success_hist end,s.slow_threshold_ms),0) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from window_buckets s group by 1,2,3
 ), auto as (
  select t.feature_id,t.kind,t.minutes,t.results,t.failures,t.results timed,coalesce(m.successes,0) successes,m.p50,t.slow,
   t.latest,t.version,false as consecutive from totals t left join medians m
   on t.kind='slow' and m.feature_id=t.feature_id and m.minutes=t.minutes
 ), deep as (
  select a.feature_id,k.kind,k.minutes,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,count(duration_ms) filter(where status='success') successes,
   percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] consecutive
  from public.attempts a join public.features f on f.id=a.feature_id and f.kind='deep' cross join windows k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where ended_at between now()-interval '30 minutes' and now() and ended_at>=now()-k.minutes*interval '1 minute'
   and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind,k.minutes,f.slow_threshold_ms
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), recent as (
  select distinct on (r.feature_id,r.kind) r.* from (select * from auto union all select * from deep) r
  join public.features f on f.id=r.feature_id left join public.baselines b on b.feature_id=r.feature_id
  where r.minutes=30 or (r.successes>=10 and (b.p95_ms is not null or f.method='*'))
  order by r.feature_id,r.kind,r.minutes
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then (r.timed>=5 and f.method is distinct from '*' and b.p95_ms is null and r.slow*2>=r.timed)
    or (r.successes>=5 and (r.p50>f.slow_threshold_ms or (b.p95_ms is not null and r.p50>b.p95_ms and r.p50>=b.p50_ms::bigint+500)))
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/nullif(coalesce(b.p50_ms,f.slow_threshold_ms),0)
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures,'consecutive',r.consecutive)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'baseline_p50',b.p50_ms,
    'baseline_p95',b.p95_ms,'window',coalesce(r.minutes,30),'slow',r.slow,'threshold',f.slow_threshold_ms)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';
create or replace function private.verification_progress(issue public.incidents)
returns table(version text,consecutive_successes integer,latest_duration_ms integer,latest_success boolean)
language sql stable set search_path='' as $$
 select v.version,coalesce(array_position(proof.qualified,false)-1,cardinality(proof.qualified),0) as streak,
  proof.durations[1],proof.successes[1]
 from public.app_versions v join public.features f on f.id=issue.feature_id
 left join public.baselines b on b.feature_id=f.id and f.method is distinct from '*'
 cross join lateral (
  -- A qualifying result must also be on the healthy side of the opening rule.
  select array_agg(success and (issue.kind<>'slow' or coalesce(ms<=least(f.slow_threshold_ms,
    b.p95_ms::bigint+500),false))
    order by rank) qualified,array_agg(ms order by rank) durations,array_agg(success order by rank) successes
  from (
   select success,ms,row_number() over w as rank from (
    select a.result_received_at stamp,0::bigint position,a.status='success' success,a.duration_ms ms
    from public.attempts a where a.feature_id=f.id and a.version=v.version and a.status in ('success','failure')
     and a.result_received_at>issue.opened_at
    union all
    select r.received_at,r.position,r.success,r.ms
    from private.latest_results r
    where r.app_id=v.app_id and r.feature_id=f.id and r.version=v.version
     and r.received_at>issue.opened_at
   ) events window w as (order by stamp desc,position desc,success,ms desc)
   order by stamp desc,position desc,success,ms desc limit 5
  ) last_results
 ) proof
 where v.app_id=issue.app_id and v.version<>issue.opened_version and v.last_seen_at>issue.opened_at
  and (issue.resolved_version is null or v.version=issue.resolved_version)
 order by (cardinality(proof.qualified)=5 and array_position(proof.qualified,false) is null) desc nulls last,
  v.last_seen_at desc,v.version limit 1
$$;
insert into app_versions(app_id,version) select id,'v2' from apps;
update incidents set opened_at=now()-interval '1 minute' where feature_id=(select id from features where route='/review');
insert into private.latest_results select app_id,id,'v2',now(),n,800,true from features cross join generate_series(1,5) n where route='/review';
select evaluate_all();
select is((select status from incidents join features on features.id=feature_id where route='/review' and incidents.kind='slow'),
 'open','five 800 ms successes cannot resolve an incident with normal p50/p95 of 200/400 ms');
update features set method='*',route='*' where route='/boundary';
select is((select breached from speeds where route='*'),false,'composition changes in the overflow group cannot trigger baseline alerts');
update features set slow_threshold_ms=1100 where route='*';
select is((select breached from speeds where route='*'),true,'overflow still observes the absolute cap');

-- Once 33 distinct times exceed the bounded dictionary, use the measured
-- extrema and mean inside the bin, including on subsequent upserts.
select pg_temp.record('/many-times',array(select generate_series(601,633)));
select pg_temp.record('/many-times',array[617]);
select results_eq($$select (metric->>'p50')::int,breached from speeds where route='/many-times'$$,
 'select 617,false','high-cardinality traffic interpolates inside the original bin');

-- Exercise the old ingest path with the pre-T45 constraint on the new row.
alter table stats_5m add check (cardinality(hist)=16) not valid;
select private.ingest_duration_batch(repeat('0',64),jsonb_build_object('batch_id',gen_random_uuid(),'app_version','v1',
 'stats',jsonb_build_array(jsonb_build_object('method','GET','route','/old-db',
 'bucket',date_bin('5 minutes',now(),'epoch'),'total',1,'failures',0,'client_errors',0,'duration_sum_ms',3200,
 'hist',array_fill(0,array[10])||array[1]||array_fill(0,array[5]),
 'hist_30',array_fill(0,array[10])||array[1]||array_fill(0,array[19]),
 'timings',jsonb_build_array(jsonb_build_array(0,3200,true))))));
select results_eq($$select total,cardinality(hist),hist[11] from stats_5m join features on features.id=feature_id
 where route='/old-db'$$,'select 1,16,1','old storage accepts the dual-format batch exactly once');
select * from finish();
rollback;
