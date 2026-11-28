create or replace function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' set jit=off set plan_cache_mode=force_custom_plan as $$
declare
 target_app uuid;
 app_events jsonb;
 refresh_separately boolean := false;
 signal record;
 issue public.incidents;
 recovered text;
 opening_rpm numeric;
 current_rpm numeric;
 change text;
 comparison_severity numeric;
 metric jsonb;
 channels text[];
 events jsonb := '[]';
begin
 if not pg_try_advisory_xact_lock(62911006) then return events; end if;
 -- Read the seven-day input in one pass. On malformed data the subtransaction
 -- rolls back, and the per-app path below isolates the affected app.
 begin
  perform private.refresh_app_baselines(null);
 exception when integrity_constraint_violation or data_exception then
  refresh_separately := true;
 end;
 for target_app in select id from public.apps order by id loop
 begin
 app_events := '[]';
 update public.attempts set status='unconfirmed' where app_id=target_app and status='pending' and ended_at is null
  and started_at<=now()-interval '10 minutes';
 if refresh_separately then perform private.refresh_app_baselines(target_app); end if;
 for signal in select s.*,i.id open_id from private.signals_for(target_app) s
  left join public.incidents i on i.feature_id=s.feature_id and i.kind=s.kind and i.status='open'
  where s.breached or i.id is not null order by s.feature_id,s.kind loop
  begin
  change := null;
  metric := signal.metric || jsonb_build_object('severity',signal.severity);
  if signal.open_id is null then
   if exists(select from public.incidents i where i.feature_id=signal.feature_id and i.kind=signal.kind
    and (i.dismissed_until>now() or i.closed_at>=signal.latest)) then continue; end if;
   metric := metric || jsonb_build_object('requests_per_minute',private.feature_rpm(signal.app_id,signal.feature_id));
   insert into public.incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open,metric_worst,last_notified_at)
    values(signal.app_id,signal.feature_id,signal.kind,'open',now(),signal.version,metric,metric,now()) returning * into issue;
   change := 'open';
  else
   select * into issue from public.incidents where id=signal.open_id and status='open' for update;
   if not found or issue.dismissed_until>now() then continue; end if;
   opening_rpm := (issue.metric_at_open->>'requests_per_minute')::numeric;
   if opening_rpm>=2 then
    current_rpm := private.feature_rpm(issue.app_id,issue.feature_id);
    if issue.volume_quiet_since is not null then
     if current_rpm>=opening_rpm*0.5 and issue.volume_recovered_at is null then
      update public.incidents set volume_recovered_at=now() where id=issue.id returning * into issue;
     elsif current_rpm<opening_rpm*0.5 and issue.volume_recovered_at is not null then
      update public.incidents set volume_recovered_at=null where id=issue.id returning * into issue;
     end if;
    end if;
   end if;
   select p.version into recovered from private.verification_progress(issue) p where p.consecutive_successes=5;
   if recovered is not null and opening_rpm>=2 and current_rpm<opening_rpm*0.2 and issue.volume_quiet_since is null then
    update public.incidents set volume_quiet_since=now(),below_since=null,last_notified_at=now() where id=issue.id;
    change := 'volume_quiet';
   elsif recovered is not null and (issue.volume_quiet_since is null or issue.volume_recovered_at is not null) then
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
   elsif issue.volume_quiet_since is null and not exists(select from public.app_versions where app_id=issue.app_id and version<>issue.opened_version and last_seen_at>issue.opened_at) then
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
