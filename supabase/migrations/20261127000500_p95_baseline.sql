-- Automatic features retain T45's histogram precision. Deep features have exact timings.
alter table public.baselines add column p95_ms integer;

create or replace function private.refresh_baselines() returns void
language sql set search_path='' as $$
 with due as materialized (
  select f.id,f.kind,b.first_sample_at from public.features f left join public.baselines b on b.feature_id=f.id
  where b.p95_ms is null or b.computed_at<=now()-interval '6 hours'
 ), outages as (
  select i.feature_id,i.opened_at,i.closed_at from public.incidents i join due on due.id=i.feature_id
  where i.kind in ('slow','failure') and (i.closed_at is null or i.closed_at>=now()-interval '7 days')
 ), deep as (
  select a.feature_id,count(*)::int n,min(a.ended_at) stamp,min(a.duration_ms) lo,max(a.duration_ms) hi,
   percentile_cont(array[0.5,0.9,0.95]) within group(order by a.duration_ms) quantiles
  from public.attempts a join due d on a.feature_id=d.id and d.kind='deep'
  where a.status='success' and a.duration_ms is not null and a.ended_at between now()-interval '7 days' and now()
   and not exists(select from outages i where i.feature_id=a.feature_id and a.ended_at>=i.opened_at
    and (i.closed_at is null or a.ended_at<i.closed_at))
  group by 1
 ), auto as (
  select s.feature_id,private.sum_hist(s.success_hist) h,min(s.min_ms) lo,max(s.max_ms) hi,min(s.bucket) stamp
  from private.speed_buckets s join due d on d.id=s.feature_id and d.kind='auto'
  where s.bucket between now()-interval '7 days' and now() and s.success_hist is not null
   -- Individual times within a five-minute bucket cannot be separated after ingestion.
   and not exists(select from outages i where i.feature_id=s.feature_id and s.bucket+interval '5 minutes'>i.opened_at
    and (i.closed_at is null or s.bucket<i.closed_at))
  group by 1
 ), observations as (
  select d.id,least(d.first_sample_at,a.stamp,s.stamp) first_stamp,coalesce(a.n,(select sum(n) from unnest(s.h) n),0)::int n,
   coalesce(a.lo,s.lo) lo,coalesce(a.hi,s.hi) hi,a.quantiles,s.h
  from due d left join deep a on a.feature_id=d.id left join auto s on s.feature_id=d.id
 )
 insert into public.baselines(feature_id,first_sample_at,sample_count,observed_min_ms,observed_max_ms,p50_ms,p90_ms,p95_ms,computed_at)
 select id,first_stamp,n,lo,hi,
  case when n>=30 then coalesce(round(quantiles[1])::int,private.hist_percentile(h,0.5)) end,
  case when n>=30 then coalesce(round(quantiles[2])::int,private.hist_percentile(h,0.9)) end,
  case when n>=30 then coalesce(round(quantiles[3])::int,private.hist_percentile(h,0.95)) end,now()
 from observations
 on conflict(feature_id) do update set first_sample_at=excluded.first_sample_at,sample_count=excluded.sample_count,
  observed_min_ms=excluded.observed_min_ms,observed_max_ms=excluded.observed_max_ms,
  p50_ms=excluded.p50_ms,p90_ms=excluded.p90_ms,p95_ms=excluded.p95_ms,computed_at=excluded.computed_at
$$;

create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), windows(kind,minutes) as (values ('failure',30),('slow',30),('slow',10)), auto as (
  select s.feature_id,k.kind,k.minutes,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(s.total-s.client_errors) timed,sum(s.total-s.client_errors-s.failures) filter(where s.success_hist is not null) successes,
   private.hist_percentile(private.sum_hist(s.success_hist),0.5) p50,
   sum(case when s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else coalesce(private.hist_above(case when s.client_errors=0 then s.hist else s.success_hist end,f.slow_threshold_ms),0) end) slow,
   -- A bin straddling a custom limit cannot prove a breach. Prefer exact counts when available.
   sum(case when s.min_ms>f.slow_threshold_ms then s.total-s.client_errors-s.failures
    when s.max_ms<=f.slow_threshold_ms then 0
    when s.failures=0 and s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else coalesce(private.hist_above(s.success_hist,f.slow_threshold_ms),0) end)*2 >
    sum(s.total-s.client_errors-s.failures) filter(where s.success_hist is not null) over_cap,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version,false as consecutive
  from private.speed_buckets s join public.features f on f.id=s.feature_id and f.kind='auto' cross join windows k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket between now()-interval '30 minutes' and now() and s.bucket>=now()-k.minutes*interval '1 minute'
   and (c.closed_at is null or s.bucket>c.closed_at) group by s.feature_id,k.kind,k.minutes
 ), deep as (
  select a.feature_id,k.kind,k.minutes,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,count(duration_ms) filter(where status='success') successes,
   percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   percentile_cont(0.5) within group(order by duration_ms) filter(where status='success')>f.slow_threshold_ms over_cap,
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
  left join public.baselines b on b.feature_id=r.feature_id
  where r.minutes=30 or (b.p95_ms is not null and r.successes>=10)
  order by r.feature_id,r.kind,r.minutes
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then (r.timed>=5 and b.p95_ms is null and r.slow*2>=r.timed)
    or (r.successes>=5 and (r.over_cap or (b.p95_ms is not null and r.p50>b.p95_ms and r.p50>b.p50_ms::bigint+500)))
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
 left join public.baselines b on b.feature_id=f.id
 cross join lateral (
  select array_agg(success and (issue.kind<>'slow' or coalesce(ms<=least(f.slow_threshold_ms,b.p95_ms::bigint+500),false))
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

create or replace function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 signal record;
 issue public.incidents;
 recovered text;
 change text;
 comparison_severity numeric;
 metric jsonb;
 channels text[];
 events jsonb := '[]';
begin
 if not pg_try_advisory_xact_lock(62911006) then return events; end if;
 update public.attempts set status='unconfirmed' where status='pending' and ended_at is null
  and started_at<=now()-interval '10 minutes';
 perform private.refresh_baselines();
 for signal in select s.*,i.id open_id from private.evaluation_signals s
  left join public.incidents i on i.feature_id=s.feature_id and i.kind=s.kind and i.status='open'
  where s.breached or i.id is not null order by s.feature_id,s.kind loop
  change := null;
  metric := signal.metric || jsonb_build_object('severity',signal.severity);
  if signal.open_id is null then
   if exists(select from public.incidents i where i.feature_id=signal.feature_id and i.kind=signal.kind
    and (i.dismissed_until>now() or i.closed_at>=signal.latest)) then continue; end if;
   insert into public.incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open,metric_worst,last_notified_at)
    values(signal.app_id,signal.feature_id,signal.kind,'open',now(),signal.version,metric,metric,now()) returning * into issue;
   change := 'open';
  else
   select * into issue from public.incidents where id=signal.open_id and status='open' for update;
   if not found or issue.dismissed_until>now() then continue; end if;
   select p.version into recovered from private.verification_progress(issue) p where p.consecutive_successes=5;
   if recovered is not null then
    update public.incidents set status='resolved',resolved_version=recovered,closed_at=now(),last_notified_at=now()
     where id=issue.id;
    change := 'resolved';
   elsif signal.breached then
    if issue.kind='failure' and (issue.metric_at_open->>'severity')::numeric>0.5 then
     -- Express current failure count relative to its opening count on the original scale.
     signal.severity := (issue.metric_at_open->>'severity')::numeric *
      (signal.metric->>'failures')::numeric/(issue.metric_at_open->>'failures')::numeric;
    end if;
    metric := signal.metric || jsonb_build_object('severity',signal.severity);
    -- Compare repeat alerts on the opening scale, even across a baseline refresh
    -- or an incident opened by the previous threshold-based release.
    comparison_severity := case when issue.kind='slow' then
      (metric->>'p50')::numeric / nullif((issue.metric_at_open->>'p50')::numeric,0)
      * (issue.metric_at_open->>'severity')::numeric else signal.severity end;
    if comparison_severity>=2*(issue.metric_at_open->>'severity')::numeric
     and (issue.last_worse_severity is null or comparison_severity>issue.last_worse_severity)
     and issue.last_notified_at<=now()-interval '6 hours' then
     change := 'worse';
    end if;
    update public.incidents set below_since=null,
     last_worse_severity=case when change='worse' then comparison_severity else last_worse_severity end,
     metric_worst=case when (case when issue.kind='slow' then (metric->>'p50')::numeric>(metric_worst->>'p50')::numeric
       else signal.severity>(metric_worst->>'severity')::numeric end) then metric else metric_worst end,
     last_notified_at=case when change='worse' then now() else last_notified_at end where id=issue.id;
   elsif not exists(select from public.app_versions where app_id=issue.app_id and version<>issue.opened_version and last_seen_at>issue.opened_at) then
    if issue.below_since is null then
     update public.incidents set below_since=now() where id=issue.id;
    elsif issue.below_since<=now()-interval '2 hours' then
     update public.incidents set status='quiet',closed_at=now() where id=issue.id;
    end if;
   end if;
  end if;
  if change is not null then
   with queued as (
    insert into public.notifications(incident_id,channel,event,sent_at,ok)
    select issue.id,ch.name,change,null,null from public.apps a join public.alert_channels c on c.app_id=a.id
    cross join lateral (values ('slack',c.slack_webhook_secret_id is not null and not c.broken),('email',c.email_enabled or c.broken)) ch(name,enabled)
    where a.id=issue.app_id and ch.enabled returning channel
   ) select array(select channel from queued order by channel) into channels;
   events := events||jsonb_build_object('incident_id',issue.id,'app_id',issue.app_id,'feature_id',issue.feature_id,
    'kind',issue.kind,'event',change,'channels',channels);
  end if;
 end loop;
 return events;
end $$;
