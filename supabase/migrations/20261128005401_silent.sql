alter table public.incidents drop constraint incidents_kind_check,
  add check (kind in ('slow','failure','unconfirmed','silent')),
  alter column feature_id drop not null,
  add check ((feature_id is null) = (kind='silent')),
  add foreign key(app_id) references public.apps on delete cascade;
create unique index one_open_silent on public.incidents(app_id) where kind='silent' and status='open';

create function private.queue_silence(app uuid, issue uuid, change text) returns void
language sql set search_path='' as $$
  insert into public.notifications(incident_id,channel,event,sent_at,ok,push_device)
  select issue,ch.name,change,null::timestamptz,null::boolean,null::uuid from public.alert_channels c
  cross join lateral (values ('slack',c.slack_webhook_secret_id is not null and not c.broken),
    ('email',c.email_enabled or c.broken)) ch(name,enabled)
  where c.app_id=app and ch.enabled
  union all
  select issue,'push',change,null,null,p.id from public.push_subscriptions p
    join public.alert_channels c on c.app_id=app and c.owner_id=p.user_id and c.push_enabled
    where private.push_session_active(p.user_id,p.session_id);
$$;
-- Invalidate the delivery token as part of closing a silent incident. A late
-- failure or expired lease must never make its opening notification eligible again.
create function private.cancel_silent_open() returns trigger language plpgsql set search_path='' as $$
begin
  update public.notifications set sent_at=coalesce(new.closed_at,now()),ok=false,error='종결된 문제',
    claimed_at=null,claim_token=null where incident_id=new.id and event='open' and sent_at is null;
  return new;
end $$;
create trigger cancel_silent_open after update of status on public.incidents
  for each row when (old.kind='silent' and old.status='open' and new.status<>'open')
  execute function private.cancel_silent_open();
revoke all on function private.cancel_silent_open() from public,anon,authenticated,service_role;
create function private.record_resumed() returns trigger language plpgsql set search_path='' as $$
declare issue uuid;
begin
  update public.incidents set status='resolved',closed_at=new.last_received,resolved_version=new.version,
    last_notified_at=new.last_received where app_id=new.app_id and kind='silent' and status='open'
    returning id into issue;
  if found then
    perform private.queue_silence(new.app_id,issue,'resolved');
  end if;
  return new;
end $$;
create trigger record_resumed after insert or update on public.server_minutes
  for each row execute function private.record_resumed();
revoke all on function private.queue_silence(uuid,uuid,text),private.record_resumed() from public,anon,authenticated,service_role;

create function public.evaluate_silence() returns void language plpgsql security definer set search_path='' as $$
declare app uuid; last_seen public.server_minutes; issue uuid; metric jsonb;
begin
  if not pg_try_advisory_xact_lock(62911054) then return; end if;
  for app in select a.id from public.apps a
    where exists(select from generate_series(1,7) d join public.server_minutes m
      on m.app_id=a.id and m.bucket>=greatest(now()-interval '7 days',date_trunc('hour',now())-d*interval '1 day')
      and m.bucket<date_trunc('hour',now())-d*interval '1 day'+interval '1 hour')
    and not exists(select from public.server_minutes m where m.app_id=a.id and m.last_received>now()-interval '10 minutes'
      and m.bucket>=date_trunc('minute',now()-interval '10 minutes'))
    and not exists(select from public.incidents i where i.app_id=a.id and i.kind='silent'
      and (i.status='open' or i.dismissed_until>now()))
    order by a.id for update of a loop
    -- The ingest transaction takes this same app lock. Recheck after waiting.
    select * into last_seen from public.server_minutes m where m.app_id=app order by bucket desc limit 1;
    if not found or last_seen.last_received>now()-interval '10 minutes' then continue; end if;
    metric := jsonb_build_object('last_received',last_seen.last_received,'window',10);
    insert into public.incidents(app_id,kind,status,opened_at,opened_version,metric_at_open,metric_worst,last_notified_at)
      values(app,'silent','open',now(),last_seen.version,metric,metric,now()) returning id into issue;
    perform private.queue_silence(app,issue,'open');
  end loop;
end $$;
revoke all on function public.evaluate_silence() from public,anon,authenticated;
grant execute on function public.evaluate_silence() to service_role;
