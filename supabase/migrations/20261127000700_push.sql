create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 endpoint text unique not null check (octet_length(endpoint)<=2048 and endpoint ~ '^https://[^/@?#[:space:]]+/[^#[:space:]]+$'),
 p256dh text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
 auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
 user_agent text not null check (user_agent in ('iPhone','iPad','Android','PC')),
 created_at timestamptz not null default now(),
 last_ok_at timestamptz, failures integer not null default 0
);
create index on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy own_devices on public.push_subscriptions to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select(id,endpoint,user_agent,created_at),delete on public.push_subscriptions to authenticated;

alter table public.alert_channels add column push_enabled boolean not null default true,
 add column push_tested_at timestamptz;
alter table public.notifications drop constraint notifications_channel_check,
 add check (channel in ('slack','email','push')),
 add column push_device uuid references public.push_subscriptions on delete set null;
create index on public.notifications(push_device) where push_device is not null;

create function public.register_push(app uuid, p_endpoint text,p_key text,p_auth text,p_agent text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.owned_app(app);
 insert into public.push_subscriptions as p(user_id,endpoint,p256dh,auth,user_agent)
 values(auth.uid(),p_endpoint,p_key,p_auth,p_agent)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent
 where p.user_id=auth.uid();
 if not found then raise exception 'device unavailable'; end if;
 update public.alert_channels set push_enabled=true where app_id=app;
end $$;
create function public.set_push_enabled(app uuid, enabled boolean) returns void
language sql security definer set search_path='' as $$
 update public.alert_channels set push_enabled=enabled where app_id=private.owned_app(app)
$$;
create or replace function public.notification_settings(app uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',coalesce(c.email_enabled,false),'channel',private.mask(c.slack_channel_name),
  'connected',c.slack_webhook_secret_id is not null and not c.broken,'broken',coalesce(c.broken,false),
  'push',coalesce(c.push_enabled,true),'subscribed',exists(select from public.push_subscriptions p where p.user_id=auth.uid()))
 from (select private.owned_app(app) id) a left join public.alert_channels c on c.app_id=a.id
$$;
create function public.queue_test_push(app uuid,device uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.alert_channels set push_tested_at=now() where app_id=private.owned_app(app) and push_enabled
 and exists(select from public.push_subscriptions p where p.id=device and p.user_id=auth.uid())
 and (push_tested_at is null or push_tested_at<=now()-interval '1 minute');
 if not found then return false; end if;
 insert into public.notifications(test_app,channel,event,ok,sent_at,push_device) values(app,'push','test',null,null,device);
 return true;
end $$;
revoke all on function public.register_push(uuid,text,text,text,text),public.set_push_enabled(uuid,boolean),
 public.queue_test_push(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_push(uuid,text,text,text,text),public.set_push_enabled(uuid,boolean),
 public.queue_test_push(uuid,uuid) to authenticated;

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
 end loop;
 return events;
end $$;

drop function public.claim_notifications(integer);
create function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean,app_name text,is_overflow boolean,push_target jsonb)
language plpgsql security definer set search_path='' as $$
begin
 update public.notifications n set sent_at=now(),ok=false,error='종결된 문제',claim_token=null,claimed_at=null
 from public.incidents i join public.features f on f.id=i.feature_id
 where n.incident_id=i.id and n.sent_at is null and
 (f.hidden or not (i.status='open' or (i.status='resolved' and n.event='resolved')));
 return query with candidates as (
  select n.id from public.notifications n where n.sent_at is null and n.available_at<=now()
   and (n.claimed_at is null or n.claimed_at<=now()-interval '10 minutes')
  order by n.digest desc,n.queued_at,n.id limit least(greatest($1,0),100) for update skip locked
 ), claimed as (
  update public.notifications n set claimed_at=now(),claim_token=gen_random_uuid()
  from candidates c where n.id=c.id returning n.*
 )
 select n.id,n.claim_token,a.id,i.id,n.event,n.channel,i.kind,private.mask(f.name),
 case when n.event='open' then i.metric_at_open else i.metric_worst end,
 case when n.channel='slack' and not s.broken then v.decrypted_secret end,s.slack_destination,s.slack_webhook_secret_id,
 case when s.email_enabled or s.broken then u.email::text end,n.digest,a.name,
 coalesce(f.method='*' and f.route='*',false),
 case when n.channel='push' and s.push_enabled and p.user_id=a.owner_id then
 jsonb_build_object('endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth) end
 from claimed n left join public.incidents i on i.id=n.incident_id left join public.features f on f.id=i.feature_id
 join public.apps a on a.id=coalesce(i.app_id,n.test_app) join auth.users u on u.id=a.owner_id
 left join public.alert_channels s on s.app_id=a.id left join public.push_subscriptions p on p.id=n.push_device
 left join vault.decrypted_secrets v on v.id=s.slack_webhook_secret_id;
end $$;

revoke all on function public.claim_notifications(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_notifications(integer) to service_role;

-- Settle each device under its own lease, so retrying one never resends to the others.
create function public.complete_push(id uuid,token uuid,result text) returns void
language plpgsql security definer set search_path='' as $$
declare device uuid;
begin
 select n.push_device into device from public.notifications n
 where n.id=$1 and n.claim_token=$2 and n.channel='push' and n.sent_at is null for update;
 if not found then return; end if;
 case result
 when 'gone' then delete from public.push_subscriptions p where p.id=device;
 when 'sent' then update public.push_subscriptions p set last_ok_at=now(),failures=0 where p.id=device;
 when 'retry' then update public.push_subscriptions p set failures=failures+1 where p.id=device;
 when 'disabled','unconfigured' then null;
 else raise exception 'unknown push result';
 end case;
 perform public.complete_notification($1,$2,result='sent',case result
  when 'retry' then '푸시 발송 실패' when 'unconfigured' then '설정 필요' else '받을 곳 없음' end);
end $$;
revoke all on function public.complete_push(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_push(uuid,uuid,text) to service_role;
