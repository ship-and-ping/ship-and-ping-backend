-- Expand existing member preferences to independently editable app settings.
alter table public.alert_channels add column app_id uuid references public.apps on delete cascade,
 add column slack_destination text, add column broken boolean not null default false,
 add column tested_at timestamptz;
alter table public.alert_channels drop constraint alert_channels_pkey;
insert into public.alert_channels(owner_id,app_id,email_enabled,slack_channel_name,slack_webhook_secret_id)
 select c.owner_id,a.id,c.email_enabled,c.slack_channel_name,
 case when v.id is not null then vault.create_secret(v.decrypted_secret) end
 from public.alert_channels c join public.apps a using(owner_id)
 left join vault.decrypted_secrets v on v.id=c.slack_webhook_secret_id where c.app_id is null;
with old as (delete from public.alert_channels where app_id is null returning slack_webhook_secret_id)
 delete from vault.secrets where id in (select slack_webhook_secret_id from old);
alter table public.alert_channels add primary key(app_id);
revoke insert(email_enabled) on public.alert_channels from authenticated;
create function private.remove_slack_secret() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.slack_webhook_secret_id is not null then delete from vault.secrets where id=old.slack_webhook_secret_id; end if;
 return null;
end $$;
create trigger remove_slack_secret after delete on public.alert_channels
 for each row execute function private.remove_slack_secret();

alter table public.notifications alter column incident_id drop not null,
 add column test_app uuid references public.apps on delete cascade,
 add column claim_token uuid, add column retries int not null default 0,
 add column available_at timestamptz not null default now(), add column digest boolean not null default false,
 drop constraint notifications_event_check,
 add check ((event in ('open','worse','resolved') and incident_id is not null and test_app is null)
 or (event='test' and incident_id is null and test_app is not null));

create function private.owned_app(app uuid) returns uuid language plpgsql stable set search_path='' as $$
begin
 if not exists(select from public.apps where id=app and owner_id=auth.uid()) then
  raise exception 'app unavailable' using errcode='42501';
 end if;
 return app;
end $$;
create function public.notification_settings(app uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',coalesce(c.email_enabled,false),'channel',private.mask(c.slack_channel_name),
  'connected',c.slack_webhook_secret_id is not null and not c.broken,'broken',coalesce(c.broken,false))
 from (select private.owned_app(app) id) a left join public.alert_channels c on c.app_id=a.id
$$;
create function public.set_notification_email(app uuid, enabled boolean) returns void language sql security definer set search_path='' as $$
 insert into public.alert_channels(app_id,owner_id,email_enabled) values(private.owned_app(app),auth.uid(),enabled)
 on conflict(app_id) do update set email_enabled=excluded.email_enabled
$$;
create function public.disconnect_slack(app uuid) returns void language plpgsql security definer set search_path='' as $$
declare previous_secret uuid;
begin
 select slack_webhook_secret_id into previous_secret from public.alert_channels where app_id=private.owned_app(app) for update;
 update public.alert_channels set broken=false,slack_channel_name=null,slack_destination=null,slack_webhook_secret_id=null where app_id=app and owner_id=auth.uid();
 delete from vault.secrets where id=previous_secret;
end $$;
create function public.queue_test_notification(app uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.alert_channels set tested_at=now() where app_id=private.owned_app(app) and slack_webhook_secret_id is not null and not broken
  and (tested_at is null or tested_at<=now()-interval '1 minute');
 if not found then return false; end if;
 insert into public.notifications(test_app,channel,event,ok,sent_at) values(app,'slack','test',null,null);
 return true;
end $$;

create table private.slack_states (app_id uuid primary key references public.apps on delete cascade,state uuid not null unique, expires_at timestamptz not null);
create function public.start_slack_state(app uuid) returns uuid language sql security definer set search_path='' as $$
 insert into private.slack_states values(private.owned_app(app),gen_random_uuid(),now()+interval '10 minutes')
 on conflict(app_id) do update set state=excluded.state,expires_at=excluded.expires_at returning state
$$;
create function public.consume_slack_state(ticket uuid) returns uuid language sql security definer set search_path='' as $$
 delete from private.slack_states s using public.apps a where s.state=ticket and s.expires_at>now() and a.id=s.app_id and a.owner_id=auth.uid()
 returning s.app_id
$$;
create function public.connect_slack(app uuid,hook text,channel text,destination text) returns void language plpgsql security definer set search_path='' as $$
declare old_secret uuid;
begin
 perform 1 from public.apps where id=app for update;
 select slack_webhook_secret_id into old_secret from public.alert_channels where app_id=app for update;
 insert into public.alert_channels(app_id,owner_id,email_enabled,slack_webhook_secret_id,slack_channel_name,slack_destination)
 select id,owner_id,false,vault.create_secret(hook),private.mask(channel),destination from public.apps where id=app
 on conflict(app_id) do update set slack_webhook_secret_id=excluded.slack_webhook_secret_id,
 slack_channel_name=excluded.slack_channel_name,slack_destination=excluded.slack_destination,broken=false;
 delete from vault.secrets where id=old_secret;
end $$;

create or replace function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 signal record;
 issue public.incidents;
 recovered text;
 change text;
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
    elsif issue.kind='slow' then
     signal.severity := (signal.metric->>'p50')::numeric/(issue.metric_at_open->>'threshold')::numeric;
    end if;
    metric := signal.metric || jsonb_build_object('severity',signal.severity);
    if signal.severity>=2*(issue.metric_at_open->>'severity')::numeric
     and (issue.last_worse_severity is null or signal.severity>issue.last_worse_severity)
     and issue.last_notified_at<=now()-interval '6 hours' then
     change := 'worse';
    end if;
    update public.incidents set below_since=null,
     last_worse_severity=case when change='worse' then signal.severity else last_worse_severity end,
     metric_worst=case when signal.severity>(metric_worst->>'severity')::numeric then metric else metric_worst end,
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

drop function public.complete_notification(uuid,boolean,text);
drop function public.claim_notifications(integer);
create function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean)
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
 case when s.email_enabled or s.broken then u.email::text end,n.digest
 from claimed n left join public.incidents i on i.id=n.incident_id left join public.features f on f.id=i.feature_id
 join public.apps a on a.id=coalesce(i.app_id,n.test_app) join auth.users u on u.id=a.owner_id
 left join public.alert_channels s on s.app_id=a.id left join vault.decrypted_secrets v on v.id=s.slack_webhook_secret_id;
end $$;

-- Attach overflow from the same member to a single digest lease. Only a
-- count is returned so a busy day cannot make the outgoing body unbounded.
create function public.expand_mail_digest(id uuid,token uuid) returns integer
language sql security definer set search_path='' as $$
 with recipient as (
  select a.owner_id from public.notifications n left join public.incidents i on i.id=n.incident_id
  join public.apps a on a.id=coalesce(i.app_id,n.test_app)
  where n.id=$1 and n.claim_token=$2 and n.digest and n.channel='email' and n.sent_at is null
 ), extra as (
  select n.id from public.notifications n left join public.incidents i on i.id=n.incident_id
  left join public.features f on f.id=i.feature_id
  join public.alert_channels c on c.app_id=coalesce(i.app_id,n.test_app)
  join recipient r on r.owner_id=c.owner_id
  where n.digest and n.channel='email' and n.sent_at is null and n.available_at<=now()
   and (n.claimed_at is null or n.claimed_at<=now()-interval '10 minutes')
   and (c.broken or c.email_enabled) and (n.test_app is not null or
    (not f.hidden and (i.status='open' or (i.status='resolved' and n.event='resolved'))))
  for update of n skip locked
 ), attached as (
  update public.notifications n set claimed_at=now(),claim_token=$2 from extra where n.id=extra.id returning 1
 ) select count(*)::integer from attached
$$;
create function public.complete_notification(id uuid,token uuid,ok boolean,error text) returns void
language sql security definer set search_path='' as $$
 update public.notifications n set
 sent_at=case when $3 or retries>=3 or $4 in ('설정 필요','받을 곳 없음') then now() end,
 ok=case when $3 or retries>=3 or $4 in ('설정 필요','받을 곳 없음') then $3 end,
 error=case when not $3 then private.mask(regexp_replace($4,'https?://[^[:space:]]+','[가림]','gi')) end,
 available_at=now()+interval '1 minute'*(1<<least(retries,3)), retries=retries+case when $3 then 0 else 1 end,
 claim_token=null,claimed_at=null
 where n.claim_token=$2 and n.sent_at is null and $3 is not null
 and exists(select from public.notifications leader where leader.id=$1 and leader.claim_token=$2)
$$;
create function public.slack_failed(id uuid,token uuid,secret uuid) returns void language plpgsql security definer set search_path='' as $$
declare n public.notifications; app uuid;
begin
 select * into n from public.notifications q where q.id=$1 and q.claim_token=$2 and q.channel='slack' for update;
 if not found then return; end if;
 select coalesce(n.test_app,i.app_id) into app from (values(1)) x left join public.incidents i on i.id=n.incident_id;
 update public.alert_channels set broken=true where app_id=app and slack_webhook_secret_id=secret;
 if not found then
  update public.notifications q set claim_token=null,claimed_at=null where q.id=n.id;
 elsif exists(select from public.notifications q where q.incident_id=n.incident_id and q.event=n.event and q.queued_at=n.queued_at and q.channel='email') then
  perform public.complete_notification(n.id,$2,false,'받을 곳 없음');
 else
  update public.notifications q set channel='email',claim_token=null,claimed_at=null where q.id=n.id;
 end if;
end $$;
create table private.mail_quota(day date primary key, used int not null);
create function public.reserve_mail() returns boolean language sql security definer set search_path='' as $$
 with slot as (insert into private.mail_quota values((now() at time zone 'Asia/Seoul')::date,1)
 on conflict(day) do update set used=private.mail_quota.used+1 where private.mail_quota.used<90 returning 1)
 select exists(select from slot)
$$;
create function public.defer_mail(id uuid,token uuid) returns void language sql security definer set search_path='' as $$
 update public.notifications n set digest=true,claim_token=null,claimed_at=null,
 available_at=((now() at time zone 'Asia/Seoul')::date+1+time '09:00') at time zone 'Asia/Seoul'
 where n.claim_token=$2 and n.channel='email'
 and exists(select from public.notifications leader where leader.id=$1 and leader.claim_token=$2)
$$;
revoke all on function public.notification_settings(uuid),
 public.set_notification_email(uuid,boolean),
 public.disconnect_slack(uuid),
 public.queue_test_notification(uuid),
 public.start_slack_state(uuid),
 public.consume_slack_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.notification_settings(uuid),
 public.set_notification_email(uuid,boolean),
 public.disconnect_slack(uuid),
 public.queue_test_notification(uuid),
 public.start_slack_state(uuid),
 public.consume_slack_state(uuid) to authenticated;
revoke all on function public.claim_notifications(integer),
 public.expand_mail_digest(uuid,uuid),
 public.complete_notification(uuid,uuid,boolean,text),
 public.connect_slack(uuid,text,text,text),
 public.slack_failed(uuid,uuid,uuid),
 public.reserve_mail(),
 public.defer_mail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_notifications(integer),
 public.expand_mail_digest(uuid,uuid),
 public.complete_notification(uuid,uuid,boolean,text),
 public.connect_slack(uuid,text,text,text),
 public.slack_failed(uuid,uuid,uuid),
 public.reserve_mail(),
 public.defer_mail(uuid,uuid) to service_role;
