-- A feature with measured queue times can receive old and new agents in the
-- very same version/bucket. Subtract matched successes from the full success
-- distribution for the handler-only cohort; never subtract their percentiles.
create view private.latency_profiles as
 with enrolled as (select distinct feature_id from private.queue_success_5m)
 select s.app_id,s.feature_id,s.bucket,s.version,p.*
 from enrolled e join private.speed_buckets s using(feature_id)
 left join private.queue_success_5m q using(app_id,feature_id,version,bucket)
 left join public.feature_timing_5m t using(app_id,feature_id,version,bucket)
 cross join lateral (
   select true inclusive,q.hist,q.counts,q.lo,q.hi,q.sum_ms::numeric/nullif(q.n,0) mean_ms,
     q.slow_count,q.threshold_ms where q.n>0
   union all
   select false,case when q.n is null then s.success_hist else private.add_hist(s.success_hist,
     array(select -v from unnest(q.hist) v)) end,
     case when q.n is null then s.duration_counts when s.duration_counts is not null and q.counts is not null
     then (select coalesce(jsonb_object_agg(key,n),'{}') from (
       select key,value::int-coalesce((q.counts->>key)::int,0) n from jsonb_each_text(s.duration_counts)
     ) d where n>0) end,
     case when q.n is null then s.complete_min end,case when q.n is null then s.complete_max end,
     case when q.n is null then s.mean_ms when s.failures+s.client_errors=0
       then (s.duration_sum_ms-q.sum_ms)::numeric/nullif(s.total-q.n,0) end,
     s.slow_count-coalesce(q.slow_count,0),
     case when s.result_count=s.total-s.client_errors
       and (q.n is null or q.threshold_ms=s.threshold_ms)
       and (s.failures=0 or s.slow_count=0 or s.duration_counts is distinct from '{}'::jsonb)
       then s.threshold_ms end
   where s.total-s.client_errors-s.failures>coalesce(q.n,0) and s.success_hist is not null
     -- Pre-upgrade mixed timing aggregates don't identify individual successes.
     and (q.n is not null or coalesce(t.queue_count,0)=0)
 ) p;

create table private.latency_baselines (
 feature_id uuid references public.features on delete cascade,inclusive boolean,
 n bigint not null,lo int,hi int,p50 int,p90 int,p95 int,first_at timestamptz,computed_at timestamptz not null,
 primary key(feature_id,inclusive)
);
revoke all on private.latency_profiles,private.latency_baselines from public,anon,authenticated,service_role;

alter function private.refresh_baselines() rename to refresh_before_latency_modes;
create function private.refresh_baselines() returns void language plpgsql set search_path='' as $$
begin
 perform private.refresh_before_latency_modes();
 with due as materialized (
   select e.feature_id,mode.inclusive from (select distinct feature_id from private.queue_success_5m) e
   join public.features f on f.id=e.feature_id and f.method<>'*'
   cross join (values(true),(false)) mode(inclusive)
   left join private.latency_baselines b using(feature_id,inclusive)
   where b.p95 is null or b.computed_at<=now()-interval '6 hours'
 ), points as (
   select p.feature_id,p.inclusive,d.ms,sum(d.n)::bigint n,min(p.bucket) first_at
   from due join private.latency_profiles p using(feature_id,inclusive)
   cross join lateral private.duration_points(p.hist,p.counts,p.lo,p.hi,p.mean_ms) d
   where p.bucket>=now()-interval '7 days' and p.bucket<date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch')
     and not exists(select from public.incidents i where i.feature_id=p.feature_id and i.kind in ('failure','slow')
       and p.bucket+interval '5 minutes'>i.opened_at and (i.closed_at is null or p.bucket<i.closed_at))
   group by p.feature_id,p.inclusive,d.ms
 ), summaries as (
   select feature_id,inclusive,sum(n) n,min(ms) lo,max(ms) hi,min(first_at) first_at,
     case when sum(n)>=30 then private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5,0.9,0.95]) end p
   from points group by feature_id,inclusive
 )
 insert into private.latency_baselines as b
 select d.feature_id,d.inclusive,coalesce(s.n,0),s.lo,s.hi,round(s.p[1]),round(s.p[2]),round(s.p[3]),s.first_at,now()
 from due d left join summaries s using(feature_id,inclusive)
 on conflict(feature_id,inclusive) do update set n=excluded.n,lo=excluded.lo,hi=excluded.hi,
   p50=excluded.p50,p90=excluded.p90,p95=excluded.p95,first_at=excluded.first_at,computed_at=excluded.computed_at;
 -- Dashboard and verification follow inclusive measurements once available.
 update public.baselines b set sample_count=m.n,p50_ms=m.p50,p90_ms=m.p90,p95_ms=m.p95,
   observed_min_ms=m.lo,observed_max_ms=m.hi,first_sample_at=m.first_at,computed_at=m.computed_at
 from private.latency_baselines m where m.feature_id=b.feature_id and m.inclusive
   and exists(select from private.queue_success_5m q where q.feature_id=b.feature_id)
   and (b.sample_count,b.p50_ms,b.p95_ms,b.computed_at) is distinct from (m.n,m.p50,m.p95,m.computed_at);
end $$;
revoke all on function private.refresh_baselines() from public,anon,authenticated,service_role;

create view private.method_slow_signals as
 with recent as materialized (
   select p.*,f.slow_threshold_ms,coalesce(p.bucket>cut.closed_at,true) eligible
   from private.latency_profiles p join public.features f on f.id=p.feature_id
   left join lateral (select max(i.closed_at) closed_at from public.incidents i where i.feature_id=p.feature_id
     and i.kind='slow' and i.status in ('quiet','resolved') and i.closed_at>=now()-interval '1 hour') cut on true
   where p.bucket between date_bin('5 minutes',now()-interval '30 minutes',timestamptz 'epoch') and now()
 ), points as materialized (
   select p.feature_id,p.inclusive,p.bucket,p.version,p.slow_threshold_ms,p.slow_count,p.threshold_ms,d.*
   from recent p cross join lateral private.duration_points(p.hist,p.counts,p.lo,p.hi,p.mean_ms) d where p.eligible
 ), windows as (
   select p.*,w.minutes from points p cross join (values(10),(30)) w(minutes)
   where w.minutes=30 or p.bucket>=date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch')+interval '5 minutes'
 ), samples as (
   select feature_id,inclusive,minutes,ms,sum(n)::bigint n,max(bucket) stamp,
     (array_agg(version order by bucket desc,version))[1] version,max(slow_threshold_ms) threshold
   from windows group by 1,2,3,4
 ), slow_counts as (
   select feature_id,inclusive,minutes,sum(over_limit) over_limit from (
     select feature_id,inclusive,minutes,bucket,version,
       case when threshold_ms=slow_threshold_ms then slow_count else coalesce(sum(n) filter(where ms>slow_threshold_ms),0) end over_limit
     from windows group by feature_id,inclusive,minutes,bucket,version,threshold_ms,slow_threshold_ms,slow_count
   ) buckets group by 1,2,3
 ), metrics as (
   select feature_id,inclusive,minutes,sum(n)::bigint total,max(stamp) latest,
     (array_agg(version order by stamp desc,version))[1] version,max(threshold) threshold,
     (private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5]))[1] p50
   from samples group by 1,2,3
 ), ranked as (
   select distinct on (m.feature_id,m.inclusive) m.*,b.p50 usual,b.p95 upper_ms,c.over_limit,
     (m.minutes=10 and total>=5 and c.over_limit*2>=total) absolute_breach
   from metrics m join slow_counts c using(feature_id,inclusive,minutes)
   left join private.latency_baselines b using(feature_id,inclusive)
   where m.minutes=10 or b.p95 is not null
   order by feature_id,inclusive,(minutes=10 and (total>=10 or (total>=5 and c.over_limit*2>=total))) desc,minutes desc
 ), signals as (
   select *,absolute_breach or coalesce(total>=5 and p50>upper_ms and p50>=usual::bigint+500,false) breached,
     p50::numeric/nullif(coalesce(usual,threshold),0) severity from ranked
 )
 select distinct on (feature_id) feature_id,breached,severity,version,latest,
   jsonb_build_object('total',total,'p50',p50,'baseline',usual,'baseline_p50',usual,'baseline_p95',upper_ms,
   'window',minutes,'slow',over_limit,'threshold',threshold,'timing_basis',case when inclusive then 'inclusive' else 'handler' end) metric
 from signals order by feature_id,breached desc,inclusive desc,severity desc;

create or replace view private.evaluation_signals as
 with enrolled as materialized (select distinct feature_id from private.queue_success_5m),
 signals as (
   select s.app_id,s.feature_id,s.kind,
     case when e.feature_id is not null then coalesce(m.breached,false) else s.breached end breached,
     case when e.feature_id is not null then m.severity else s.severity end severity,
     case when e.feature_id is not null then m.metric else s.metric end metric,
     case when e.feature_id is not null then m.version else s.version end version,
     case when e.feature_id is not null then m.latest else s.latest end latest
   from private.evaluation_before_queue s left join enrolled e on s.kind='slow' and e.feature_id=s.feature_id
   left join private.method_slow_signals m on m.feature_id=e.feature_id
 )
 select s.app_id,s.feature_id,s.kind,(s.breached and s.version is not null) or g.version is not null breached,
   case when g.version is not null then greatest(s.severity,1) else s.severity end severity,
   coalesce(s.metric,'{}') || jsonb_strip_nulls(jsonb_build_object('queue_ms',round(q.wait_ms/nullif(q.samples,0)),
     'queue_pct',round(100*q.wait_ms/nullif(q.total_ms,0)),'interruptions',g.interruptions,'stall_at',g.start_at))
     || case when g.version is null then '{}'::jsonb else jsonb_build_object(
       'failures',greatest((s.metric->>'failures')::bigint,g.interruptions),
       'total',greatest((s.metric->>'total')::bigint,g.interruptions)) end metric,
   coalesce(g.version,s.version) version,coalesce(g.start_at,s.latest) latest
 from signals s left join private.stalled_features g on g.feature_id=s.feature_id and s.kind='failure'
   and not exists(select from public.incidents i where i.feature_id=s.feature_id and i.kind='failure' and i.closed_at>=g.start_at)
 left join lateral (
   select sum(t.queue_ms_sum) wait_ms,sum(t.queue_total_ms) total_ms,sum(t.queue_count) samples
   from public.feature_timing_5m t where t.app_id=s.app_id and t.feature_id=s.feature_id
   and s.metric->>'timing_basis' is distinct from 'handler'
   and t.bucket between date_bin('5 minutes',now()-coalesce((s.metric->>'window')::int,30)*interval '1 minute',
     timestamptz 'epoch')+case when s.metric->>'window'='10' then interval '5 minutes' else interval '0' end and now()
 ) q on true;
revoke all on private.method_slow_signals from public,anon,authenticated,service_role;
