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
-- At 12:13, a request at 12:01 belongs to the third bucket (12:00).
select pg_temp.record('/boundary',array_fill(200,array[80]),'10 minutes');
select pg_temp.record('/boundary',array_fill(1400,array[5]),'5 minutes');
select pg_temp.record('/boundary',array_fill(1400,array[5]),'0 minutes');
select private.refresh_baselines();
select results_eq($$select breached,(metric->>'window')::int,(metric->>'total')::int from speeds where route='/boundary'$$,
 'select true,10,10','only the two most recent bucket starts contribute to the short window');
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
select ok((select max(ms)>630 and min(ms)<604 and sum(n)=34
 from private.speed_buckets b join features f on f.id=b.feature_id
 cross join lateral private.duration_points(b.success_hist,b.duration_counts,b.complete_min,b.complete_max,b.mean_ms) p
 where f.route='/many-times'),'interpolation retains the observed spread for estimating p95');

-- Existing Truva routes use a one-second cap before and after baseline activation.
select pg_temp.record(route,array_fill(900,array[80]),'10 minutes')
 from unnest(array['/places','/trips','/bookmarks']) route;
update features set slow_threshold_ms=1000 where route in ('/places','/trips','/bookmarks');
select pg_temp.record('/places',array_fill(700,array[5])||array_fill(1400,array[5]),'0 minutes');
select pg_temp.record('/trips',array_fill(900,array[5])||array_fill(1050,array[5]),'0 minutes');
select pg_temp.record('/bookmarks',array[1800,1900]||array_fill(900,array[6])||array_fill(1050,array[4]),'0 minutes',2);
create temp view truva as select route,breached,(metric->>'slow')::int slow,
 (metric->>'total')::int successes,(metric->>'window')::int minutes from speeds
 where route in ('/places','/trips','/bookmarks') order by route;
select results_eq('select * from truva',
 $$values ('/bookmarks',false,4,10,10),('/places',true,5,10,10),('/trips',true,5,10,10)$$,
 'one-second cap uses strict success exceedances, including ties, before learning');
-- Pre-T46 successes have the original counter and no exact-time dictionary.
update private.evaluation_buckets set duration_counts='{}' where feature_id in
 (select id from features where route in ('/places','/trips'));
insert into baselines(feature_id,p50_ms,p95_ms,sample_count)
 select id,1000,1500,30 from features where route in ('/places','/trips','/bookmarks');
select results_eq('select * from truva',
 $$values ('/bookmarks',false,4,10,10),('/places',true,5,10,10),('/trips',true,5,10,10)$$,
 'a learned baseline preserves the same one-second cap and excludes slow failures');

-- The short cap still wins with five successes amid healthy older traffic.
select pg_temp.record('/sparse-cap',array_fill(900,array[80]),'10 minutes');
update features set slow_threshold_ms=1000 where route='/sparse-cap';
insert into baselines(feature_id,p50_ms,p95_ms,sample_count)
 select id,1000,1500,30 from features where route='/sparse-cap';
select pg_temp.record('/sparse-cap',array[700,700,1050,1050,1050],'0 minutes');
select results_eq($$select breached,(metric->>'window')::int,(metric->>'total')::int from speeds where route='/sparse-cap'$$,
 'select true,10,5','30-minute baseline fallback cannot dilute a five-success cap breach');
update features set slow_threshold_ms=800 where route='/sparse-cap';
select pg_temp.record('/sparse-cap',array_fill(700,array[3]),'0 minutes');
select results_eq($$select breached,(metric->>'window')::int from speeds where route='/sparse-cap'$$,
 'select false,30','only the baseline can open from the fallback window despite 83 older and current exceedances');

-- The cap is inside a histogram bin. The 34 distinct successes exhaust the
-- dictionary and the bounded raw tail, and their measured median is below it.
select pg_temp.record('/many-cap',array[100],'1 day');
update features set slow_threshold_ms=1100 where route='/many-cap';
select pg_temp.record('/many-cap',array(select generate_series(1001,1017))||
 array(select generate_series(1101,1117)),'0 minutes');
select results_eq($$select b.duration_counts is null,b.slow_count,s.breached from speeds s
 join features f using(route) join private.evaluation_buckets b on b.feature_id=f.id
 where s.route='/many-cap' and b.bucket=date_bin('5 minutes',now(),'epoch')$$,
 'select true,17,true','uncapped distinct times retain an exact half above an in-bin limit');
select pg_temp.record('/many-cap',array[1100],'0 minutes');
select is((select breached from speeds where route='/many-cap'),false,'17 of 35 stays normal including one at the limit');

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
