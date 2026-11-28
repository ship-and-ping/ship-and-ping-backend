-- Old counters have no recoverable release. Keep their completions during
-- rollout but require versioned interruption evidence to attribute a new incident.
alter table private.request_flow_seconds add column version text not null default '',
 drop constraint request_flow_seconds_pkey, add primary key(feature_id,stamp,version);

create table private.queue_success_5m (
 app_id uuid not null, feature_id uuid not null, version text not null, bucket timestamptz not null,
 n bigint not null, sum_ms bigint not null, lo int not null, hi int not null,
 hist integer[] not null, counts jsonb, slow_count bigint not null, threshold_ms int not null,
 primary key(feature_id,bucket,version),
 foreign key(app_id,feature_id,version,bucket) references public.stats_5m on delete cascade
);
revoke all on private.queue_success_5m from public,anon,authenticated,service_role;

create function private.record_queue_success(app uuid,feature uuid,release text,stamp timestamptz,item jsonb)
returns void language sql set search_path='' as $$
 with times as materialized (
  select (t->>1)::int ms,count(*)::int n from jsonb_array_elements(item->'timings') t
  where (t->>2)::boolean and (t->>3)::boolean group by 1
 ), layout as (
  select case when item ? 'hist_30' then 30 else jsonb_array_length(item->'hist') end size
 )
 insert into private.queue_success_5m as q
 select app,feature,release,stamp,sum(n),sum(ms::bigint*n),min(ms),max(ms),
  array(select coalesce(sum(t.n),0)::int from generate_series(1,l.size) i
        left join times t on private.duration_bin(t.ms,l.size)=i group by i order by i),
  case when count(*)<=32 then jsonb_object_agg(ms,n) end,
  coalesce(sum(n) filter(where ms>f.slow_threshold_ms),0),f.slow_threshold_ms
 from times cross join layout l join public.features f on f.id=feature
 group by l.size,f.slow_threshold_ms
 on conflict(feature_id,bucket,version) do update set n=q.n+excluded.n,sum_ms=q.sum_ms+excluded.sum_ms,
  lo=least(q.lo,excluded.lo),hi=greatest(q.hi,excluded.hi),hist=private.add_hist(q.hist,excluded.hist),
  counts=private.merge_duration_counts(q.counts,excluded.counts),slow_count=q.slow_count+excluded.slow_count,
  threshold_ms=case when q.threshold_ms=excluded.threshold_ms then q.threshold_ms else -1 end;
$$;
revoke all on function private.record_queue_success(uuid,uuid,text,timestamptz,jsonb) from public,anon,authenticated,service_role;

create or replace function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 k public.app_keys := private.lock_key(app_key_hash);
 duplicate boolean := exists(select from public.ingest_batches where app_id=k.app_id and batch_id=(payload->>'batch_id')::uuid);
 result jsonb := private.ingest_before_queue(app_key_hash,payload);
 item jsonb;
 feature uuid;
 bucket_at timestamptz;
begin
 if duplicate then return result; end if;
 for item in select value from jsonb_array_elements(payload->'stats')
   where (value->>'queue_count')::int>0 or value ? 'flow' loop
   feature := private.auto_feature(k.app_id,item->>'method',item->>'route');
   bucket_at := (item->>'bucket')::timestamptz;
   if k.kind='srv' and payload->>'platform'='server' and (item->>'queue_count')::int>0 then
     insert into public.feature_timing_5m as t
       (app_id,feature_id,version,bucket,db_ms_sum,db_ms_count,external_ms_sum,external_ms_count,
        queue_ms_sum,queue_total_ms,queue_count)
     values(k.app_id,feature,trim(payload->>'app_version'),bucket_at,0,0,0,0,
       (item->>'queue_ms_sum')::bigint,(item->>'queue_total_ms')::bigint,(item->>'queue_count')::bigint)
     on conflict(app_id,feature_id,version,bucket) do update set
       queue_ms_sum=t.queue_ms_sum+excluded.queue_ms_sum,queue_total_ms=t.queue_total_ms+excluded.queue_total_ms,
       queue_count=t.queue_count+excluded.queue_count;
     perform private.record_queue_success(k.app_id,feature,trim(payload->>'app_version'),bucket_at,item);
   end if;
   insert into private.request_flow_seconds as s(feature_id,stamp,completed,interrupted,version)
     select feature,to_timestamp(key::bigint),(value->>0)::int,(value->>1)::int,trim(payload->>'app_version')
     from jsonb_each(item->'flow')
     where to_timestamp(key::bigint) between now()-interval '12 minutes' and now()+interval '2 seconds'
       and date_bin('5 minutes',to_timestamp(key::bigint),timestamptz 'epoch')=bucket_at
     on conflict(feature_id,stamp,version) do update set
       completed=s.completed+excluded.completed,interrupted=s.interrupted+excluded.interrupted;
 end loop;
 return result;
end $$;

create or replace view private.stalled_features as
 with candidates as materialized (
   select distinct feature_id,stamp-n*interval '1 second' start_at
   from private.request_flow_seconds cross join generate_series(0,9) n
   where interrupted>0 and version<>'' and stamp between now()-interval '8 minutes' and now()-interval '90 seconds'
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
 ) culprit where not exists (
   select from generate_series(1,3) m where
     (select coalesce(sum(completed),0) from private.request_flow_seconds
      where feature_id=g.feature_id and stamp>=g.start_at-m*interval '1 minute'
      and stamp<g.start_at-(m-1)*interval '1 minute')<30
 ) and exists(select from private.request_flow_seconds where feature_id=g.feature_id
     and completed>0 and stamp between g.start_at-interval '5 seconds' and g.start_at-interval '1 second')
 order by g.feature_id,g.n desc,g.start_at desc;


create or replace function public.evaluate_silence() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from private.request_flow_seconds where stamp<now()-interval '12 minutes';
 perform private.evaluate_app_silence();
end $$;

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
   events := events||jsonb_build_object('incident_id',issue.id,'app_id',issue.app_id,'feature_id',issue.feature_id,
    'kind',issue.kind,'event',change,'channels',channels);
  end if;
  exception when integrity_constraint_violation or data_exception then
   -- A malformed signal must not suppress notifications for other features.
   raise warning 'Skipping invalid incident signal for feature %, kind %, SQLSTATE %',signal.feature_id,signal.kind,sqlstate;
  end;
 end loop;
 return events;
end $$;
