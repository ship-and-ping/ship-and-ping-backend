create function private.base_signals_for(target_app uuid) returns table(app_id uuid,feature_id uuid,kind text,breached boolean,severity numeric,metric jsonb,version text,latest timestamptz)
language sql stable set search_path='' as $$
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where app_id=target_app and closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), windows(kind,minutes) as (values ('failure',30),('slow',30),('slow',10)), active as materialized (
  select s.*,f.slow_threshold_ms from private.speed_buckets s join public.features f on f.id=s.feature_id and f.kind='auto'
  where s.app_id=target_app and s.bucket between date_bin('5 minutes',now()-interval '30 minutes',timestamptz 'epoch') and now()
 ), window_buckets as materialized (
  select s.*,k.kind,k.minutes from active s cross join windows k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket>=date_bin('5 minutes',now()-k.minutes*interval '1 minute',timestamptz 'epoch')
   + case when k.minutes=10 then interval '5 minutes' else interval '0' end
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
   sum(case when s.threshold_ms=s.slow_threshold_ms and s.result_count=s.total-s.client_errors
     and (s.failures=0 or s.slow_count=0 or s.duration_counts is distinct from '{}'::jsonb) then s.slow_count
    else coalesce((select coalesce(sum(value::int) filter(where key::int>s.slow_threshold_ms),0)
     from jsonb_each_text(s.duration_counts) having sum(value::int)=s.total-s.client_errors-s.failures),
     private.hist_above(s.success_hist,s.slow_threshold_ms),0) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from window_buckets s group by 1,2,3
 ), auto as (
  select t.feature_id,t.kind,t.minutes,t.results,t.failures,t.results-t.failures timed,coalesce(m.successes,0) successes,m.p50,t.slow,
   t.latest,t.version,false as consecutive from totals t left join medians m
   on t.kind='slow' and m.feature_id=t.feature_id and m.minutes=t.minutes
 ), deep as (
  select a.feature_id,k.kind,k.minutes,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) filter(where status='success') timed,count(duration_ms) filter(where status='success') successes,
   percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where status='success' and duration_ms>f.slow_threshold_ms) slow,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] consecutive
  from public.attempts a join public.features f on f.id=a.feature_id and f.kind='deep' cross join windows k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where a.app_id=target_app and ended_at between now()-interval '30 minutes' and now() and ended_at>=now()-k.minutes*interval '1 minute'
   and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind,k.minutes,f.slow_threshold_ms
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where a.app_id=target_app and started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), observations as (
  select r.*,(r.kind='slow' and r.minutes=10 and r.timed>=5 and r.slow*2>=r.timed) cap_breached
  from (select * from auto union all select * from deep) r
 ), recent as (
  select distinct on (r.feature_id,r.kind) r.* from observations r
  join public.features f on f.id=r.feature_id left join public.baselines b on b.feature_id=r.feature_id
  where r.minutes=10 or r.kind='failure' or (b.p95_ms is not null and f.method is distinct from '*')
  -- A sparse short-window cap breach has its own evidence and takes priority.
  order by r.feature_id,r.kind,(r.minutes=10 and (r.cap_breached or r.successes>=10)) desc,r.minutes desc
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then coalesce(r.cap_breached or
    (r.successes>=5 and b.p95_ms is not null and r.p50>b.p95_ms and r.p50>=b.p50_ms::bigint+500),false)
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/nullif(coalesce(b.p50_ms,f.slow_threshold_ms),0)
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures,'consecutive',r.consecutive)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'baseline_p50',b.p50_ms,
    'baseline_p95',b.p95_ms,'window',coalesce(r.minutes,10),'slow',r.slow,'threshold',f.slow_threshold_ms,
    'timing_basis',case when f.kind='deep' then 'deep' else 'handler' end,
    'slow_rule',case when r.successes>=5 and r.p50>b.p95_ms and r.p50>=b.p50_ms::bigint+500
      then 'relative' else 'absolute' end)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id and f.method is distinct from '*' left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where f.app_id=target_app and (k.kind<>'unconfirmed' or f.kind='deep');
$$;

create function private.method_signals_for(target_app uuid)
returns table(feature_id uuid,breached boolean,severity numeric,version text,latest timestamptz,metric jsonb)
language sql stable set search_path='' as $$
 with recent as materialized (
   select p.*,f.slow_threshold_ms,coalesce(p.bucket>cut.closed_at,true) eligible
   from private.latency_profiles p join public.features f on f.id=p.feature_id
   left join lateral (select max(i.closed_at) closed_at from public.incidents i where i.feature_id=p.feature_id
     and i.kind='slow' and i.status in ('quiet','resolved') and i.closed_at>=now()-interval '1 hour') cut on true
   where p.app_id=target_app and p.bucket between date_bin('5 minutes',now()-interval '30 minutes',timestamptz 'epoch') and now()
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
   select distinct on (m.feature_id,m.inclusive) m.*,b.p50 usual,b.p95 upper_ms,c.over_limit
   from metrics m join slow_counts c using(feature_id,inclusive,minutes)
   left join private.latency_baselines b using(feature_id,inclusive)
   where m.minutes=10 or b.p95 is not null
   order by m.feature_id,m.inclusive,(m.minutes=10 and total>=10) desc,m.minutes desc
 ), absolute_counts as (
   select m.feature_id,sum(total) total,sum(over_limit) over_limit,
     case when bool_and(m.inclusive) then 'inclusive' when bool_or(m.inclusive) then 'mixed' else 'handler' end basis
   from metrics m join slow_counts c using(feature_id,inclusive,minutes)
   where minutes=10 group by m.feature_id having sum(total)>=5 and sum(over_limit)*2>=sum(total)
 ), combined as (
   select s.feature_id,s.ms,sum(s.n)::bigint n,max(s.stamp) stamp,max(s.threshold) threshold,
     (array_agg(s.version order by s.stamp desc,s.version))[1] version
   from samples s join absolute_counts a on a.feature_id=s.feature_id where s.minutes=10 group by 1,2
 ), absolute_metrics as (
   select feature_id,max(stamp) latest,max(threshold) threshold,(array_agg(version order by stamp desc,version))[1] version,
     (private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5]))[1] p50
   from combined group by feature_id
 ), signals as (
   select feature_id,coalesce(total>=5 and p50>upper_ms and p50>=usual::bigint+500,false) breached,
     p50::numeric/nullif(coalesce(usual,threshold),0) severity,version,latest,total,p50,usual,upper_ms,minutes,over_limit,threshold,
     case when inclusive then 'inclusive' else 'handler' end basis,'relative' rule
   from ranked union all
   select a.feature_id,true,m.p50::numeric/nullif(m.threshold,0),m.version,m.latest,a.total,m.p50,null,null,10,
     a.over_limit,m.threshold,a.basis,'absolute' from absolute_counts a join absolute_metrics m using(feature_id)
 )
 select distinct on (feature_id) feature_id,breached,severity,version,latest,
   jsonb_build_object('total',total,'p50',p50,'baseline',usual,'baseline_p50',usual,'baseline_p95',upper_ms,
   'window',minutes,'slow',over_limit,'threshold',threshold,'timing_basis',basis,'slow_rule',rule) metric
 from signals order by feature_id,breached desc,(rule='relative') desc,(basis='inclusive') desc,severity desc;
$$;

create or replace view private.method_slow_signals as
 select s.* from public.apps a cross join lateral private.method_signals_for(a.id) s;

create function private.stalls_for(target_app uuid) returns table(feature_id uuid,start_at timestamptz,interruptions bigint,version text)
language sql stable set search_path='' as $$
 with candidates as materialized (
   select distinct r.feature_id,stamp-n*interval '1 second' start_at
   from private.request_flow_seconds r join public.features f on f.id=r.feature_id cross join generate_series(0,9) n
   where f.app_id=target_app and interrupted>0 and version<>'' and stamp between now()-interval '8 minutes' and now()-interval '90 seconds'
 ), gaps as (
   select c.*,g.n from candidates c cross join lateral (
     select sum(interrupted) n from private.request_flow_seconds
     where feature_id=c.feature_id and stamp>=c.start_at and stamp<c.start_at+interval '10 seconds'
     having sum(completed)=0 and sum(interrupted)>=3
   ) g where c.start_at+interval '100 seconds'<=now()
 )
 select distinct on (g.feature_id) g.feature_id,g.start_at,g.n::bigint interruptions,culprit.version
 from gaps g cross join lateral (
   select f.version from private.request_flow_seconds f
   where f.feature_id=g.feature_id and f.stamp>=g.start_at and f.stamp<g.start_at+interval '10 seconds'
     and f.interrupted>0 and f.version<>''
   group by f.version order by sum(f.interrupted) desc,max(f.stamp) desc,f.version limit 1
 ) culprit where not exists(select from public.incidents i where i.feature_id=g.feature_id and i.kind='failure' and i.closed_at>=g.start_at)
 and not exists (
   select from generate_series(1,3) m where
     (select coalesce(sum(completed),0) from private.request_flow_seconds
      where feature_id=g.feature_id and stamp>=g.start_at-m*interval '1 minute'
      and stamp<g.start_at-(m-1)*interval '1 minute')<30
 ) and exists(select from private.request_flow_seconds where feature_id=g.feature_id
     and completed>0 and stamp between g.start_at-interval '5 seconds' and g.start_at-interval '1 second')
 order by g.feature_id,g.n desc,g.start_at desc;
$$;
create or replace view private.stalled_features as select s.* from public.apps a cross join lateral private.stalls_for(a.id) s;

create function private.signals_for(target_app uuid) returns table(app_id uuid,feature_id uuid,kind text,breached boolean,severity numeric,metric jsonb,version text,latest timestamptz)
language sql stable set search_path='' as $$
 with enrolled as materialized (select f.id feature_id from public.features f where f.app_id=target_app and exists(select from private.queue_success_5m q where q.feature_id=f.id)),
 signals as (
   select s.app_id,s.feature_id,s.kind,
     case when e.feature_id is not null then coalesce(m.breached,false) else s.breached end breached,
     case when e.feature_id is not null then m.severity else s.severity end severity,
     case when e.feature_id is not null then m.metric else s.metric end metric,
     case when e.feature_id is not null then m.version else s.version end version,
     case when e.feature_id is not null then m.latest else s.latest end latest
   from private.base_signals_for(target_app) s left join enrolled e on s.kind='slow' and e.feature_id=s.feature_id
   left join private.method_signals_for(target_app) m on m.feature_id=e.feature_id
 )
 select s.app_id,s.feature_id,s.kind,(s.breached and s.version is not null) or g.version is not null breached,
   case when g.version is not null then greatest(s.severity,1) else s.severity end severity,
   coalesce(s.metric,'{}') || jsonb_strip_nulls(jsonb_build_object('queue_ms',round(q.wait_ms/nullif(q.samples,0)),
     'queue_pct',round(100*q.wait_ms/nullif(q.total_ms,0)),'interruptions',g.interruptions,'stall_at',g.start_at))
     || case when g.version is null then '{}'::jsonb else jsonb_build_object(
       'failures',greatest((s.metric->>'failures')::bigint,g.interruptions),
       'total',greatest((s.metric->>'total')::bigint,g.interruptions)) end metric,
   coalesce(g.version,s.version) version,coalesce(g.start_at,s.latest) latest
 from signals s left join private.stalls_for(target_app) g on g.feature_id=s.feature_id and s.kind='failure'
 left join lateral (
   select sum(t.queue_ms_sum) wait_ms,sum(t.queue_total_ms) total_ms,sum(t.queue_count) samples
   from public.feature_timing_5m t where t.app_id=s.app_id and t.feature_id=s.feature_id
   and s.metric->>'timing_basis' is distinct from 'handler'
   and t.bucket between date_bin('5 minutes',now()-coalesce((s.metric->>'window')::int,30)*interval '1 minute',
     timestamptz 'epoch')+case when s.metric->>'window'='10' then interval '5 minutes' else interval '0' end and now()
 ) q on true;
$$;

create or replace view private.evaluation_signals as
 select s.* from public.apps a cross join lateral private.signals_for(a.id) s;
revoke all on function private.base_signals_for(uuid),private.method_signals_for(uuid),private.stalls_for(uuid),
 private.signals_for(uuid) from public,anon,authenticated,service_role;

create or replace function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare
 target_app uuid;
 app_events jsonb;
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
 for target_app in select id from public.apps order by id loop
 begin
 app_events := '[]';
 update public.attempts set status='unconfirmed' where app_id=target_app and status='pending' and ended_at is null
  and started_at<=now()-interval '10 minutes';
 perform private.refresh_app_baselines(target_app);
 for signal in select s.*,i.id open_id from private.signals_for(target_app) s
  left join public.incidents i on i.feature_id=s.feature_id and i.kind=s.kind and i.status='open'
  where s.breached or i.id is not null order by s.feature_id,s.kind loop
  begin
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
    insert into public.notifications(incident_id,channel,event,sent_at,ok,push_device)
    select issue.id,ch.name,change,null::timestamptz,null::boolean,null::uuid from public.apps a join public.alert_channels c on c.app_id=a.id
    cross join lateral (values ('slack',c.slack_webhook_secret_id is not null and not c.broken),('email',c.email_enabled or c.broken)) ch(name,enabled)
    where a.id=issue.app_id and ch.enabled
    union all
    select issue.id,'push',change,null,null,p.id from public.push_subscriptions p
    join public.alert_channels c on c.owner_id=p.user_id and c.app_id=issue.app_id and c.push_enabled
    returning channel
   ) select array(select distinct channel from queued order by channel) into channels;
   app_events := app_events||jsonb_build_object('incident_id',issue.id,'app_id',issue.app_id,'feature_id',issue.feature_id,
    'kind',issue.kind,'event',change,'channels',channels);
  end if;
  exception when integrity_constraint_violation or data_exception then
   -- A malformed signal must not suppress notifications for other features.
   raise warning 'Skipping invalid incident signal for feature %, kind %, SQLSTATE %',signal.feature_id,signal.kind,sqlstate;
  end;
 end loop;
 events := events || app_events;
 exception when integrity_constraint_violation or data_exception then
   raise warning 'Skipping invalid evaluation inputs for app %, SQLSTATE %',target_app,sqlstate;
 end;
 end loop;
 return events;
end $$;
