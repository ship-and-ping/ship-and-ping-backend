create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), kinds(kind) as (values ('failure'),('slow')), auto as (
  select s.feature_id,k.kind,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(s.total-s.client_errors) timed,private.hist_percentile(private.sum_hist(s.success_hist),0.5) p50,
   sum(case when s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else (select coalesce(sum(n),0) from unnest(case when s.client_errors=0 then s.hist else s.success_hist end) with ordinality bins(n,pos)
          where pos>private.duration_bin(f.slow_threshold_ms)) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from private.speed_buckets s join public.features f on f.id=s.feature_id cross join kinds k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where f.kind='auto' and s.bucket between now()-interval '30 minutes' and now()
   and (c.closed_at is null or s.bucket>c.closed_at) group by s.feature_id,k.kind
 ), deep as (
  select a.feature_id,k.kind,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] streak,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version
  from public.attempts a join public.features f on f.id=a.feature_id cross join kinds k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where f.kind='deep' and ended_at between now()-interval '30 minutes' and now() and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), recent as (
  select *,false as consecutive from auto
  union all select feature_id,kind,results,failures,timed,p50,slow,latest,version,streak from deep
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then r.timed>=5 and case when b.p50_ms is null then r.slow*2>=r.timed else r.p50>=2*b.p50_ms end
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/f.slow_threshold_ms
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'slow',r.slow,'threshold',f.slow_threshold_ms)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';
