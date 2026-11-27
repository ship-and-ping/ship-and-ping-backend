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
select results_eq('select route,(metric->>''p50'')::int,breached from speeds order by route',
 $$values ('/below',5000,false),('/edge',5000,true),('/field',6300,true),('/long',6300,true),('/short',3300,false)$$,
 '30-sample medians and strict >5s on exactly half the requests');
select evaluate_all();
select is((select (metric_at_open->>'p50')::int from incidents join features on features.id=feature_id
 where route='/long' and incidents.kind='slow'),6300,'opening snapshot uses refined success p50');

-- Failed calls in the same bucket cannot move the success median.
select pg_temp.record('/long',array_fill(50,array[31]),'5 minutes',31);
select is((select (metric->>'p50')::int from speeds where route='/long'),6300,'only successes contribute');
select pg_temp.record('/baseline',array_fill(3300,array[30]),'4 days');
select pg_temp.record('/baseline',array_fill(6300,array[5]));
select evaluate_all();
select results_eq($$select p50_ms,p90_ms from baselines join features on features.id=feature_id where route='/baseline'$$,
 'select 3300,6300','seven-day baseline reads refined bins');
select is((select breached from speeds where route='/baseline'),false,'6300 is below twice 3300');
select pg_temp.record('/baseline',array_fill(6600,array[6]));
select is((select breached from speeds where route='/baseline'),true,'6600 reaches twice 3300');

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

-- Exercise the ingest path used before the optional field was recognized,
-- with the pre-T45 array constraint enforced on the newly inserted row.
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
