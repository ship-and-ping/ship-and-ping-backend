alter table public.push_subscriptions add column session_id uuid;

-- Only the delivery path can inspect Auth sessions. A refreshed access token
-- retains the same session id. A session without a deadline lasts until logout.
create function private.push_session_active(member uuid, login uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from auth.sessions s where s.id=login and s.user_id=member
  and (s.not_after is null or s.not_after>statement_timestamp()))
$$;
revoke all on function private.push_session_active(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.push_session_active(uuid,uuid) to service_role;

create or replace function public.register_push(app uuid, p_endpoint text,p_key text,p_auth text,p_agent text,
 p_fingerprint text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare
 member uuid := auth.uid();
 login uuid := (auth.jwt()->>'session_id')::uuid;
 device uuid;
begin
 perform private.owned_app(app);
 if login is null then raise insufficient_privilege; end if;
 -- Keep the ten-device limit atomic across registrations for the same member.
 perform pg_advisory_xact_lock(4901,hashtext(member::text));
 -- A new login must never inherit queued or claimed work from the old one.
 delete from public.push_subscriptions p where p.endpoint=p_endpoint and p.user_id=member
  and p.p256dh=p_key and p.auth=p_auth and p.session_id is distinct from login;
 insert into public.push_subscriptions as p(user_id,session_id,endpoint,p256dh,auth,user_agent,vapid_fingerprint)
 values(member,login,p_endpoint,p_key,p_auth,p_agent,p_fingerprint)
 on conflict(endpoint) do update set user_agent=excluded.user_agent,
  vapid_fingerprint=coalesce(excluded.vapid_fingerprint,p.vapid_fingerprint)
 where p.user_id=member and p.p256dh=excluded.p256dh and p.auth=excluded.auth
 returning p.id into device;
 if not found then raise insufficient_privilege; end if;
 delete from public.push_subscriptions where id in (
  select id from public.push_subscriptions where user_id=member and id<>device
  order by created_at desc,id desc offset 9
 );
 update public.alert_channels set push_enabled=true where app_id=app;
 return device;
end $$;

-- Show whether this login enabled the device, without returning any session id.
create function public.list_push_devices()
returns table(id uuid,endpoint text,user_agent text,created_at timestamptz,vapid_fingerprint text,current_session boolean)
language sql stable security definer set search_path='' as $$
 select p.id,p.endpoint,p.user_agent,p.created_at,p.vapid_fingerprint,
  coalesce(p.session_id=(auth.jwt()->>'session_id')::uuid,false)
 from public.push_subscriptions p where p.user_id=auth.uid() order by p.created_at,p.id
$$;
revoke all on function public.list_push_devices() from public,anon,authenticated,service_role;
grant execute on function public.list_push_devices() to authenticated;

create or replace function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean,app_name text,is_overflow boolean,push_target jsonb)
language plpgsql security definer set search_path='' as $$
begin
 update public.notifications n set sent_at=now(),ok=false,error='종결된 문제',claim_token=null,claimed_at=null
 from public.incidents i join public.features f on f.id=i.feature_id
 where n.incident_id=i.id and n.sent_at is null and
 (f.hidden or not (i.status='open' or (i.status='resolved' and n.event='resolved')));
 -- Deletion also detaches every queued job for this device via its FK.
 delete from public.push_subscriptions p where p.id in (
  select n.push_device from public.notifications n
  left join public.incidents i on i.id=n.incident_id
  join public.apps a on a.id=coalesce(i.app_id,n.test_app)
  join public.push_subscriptions d on d.id=n.push_device
  where n.channel='push' and n.sent_at is null and n.available_at<=now()
   and (d.user_id<>a.owner_id or not private.push_session_active(d.user_id,d.session_id))
 );
 return query with candidates as (
  select n.id from public.notifications n where n.sent_at is null and n.available_at<=now()
   and (n.claimed_at is null or n.claimed_at<=now()-interval '10 minutes')
  order by (n.channel='push'),n.digest desc,n.queued_at,n.id limit least(greatest($1,0),100) for update skip locked
 ), claimed as (
  update public.notifications n set claimed_at=now(),claim_token=gen_random_uuid()
  from candidates c where n.id=c.id returning n.*
 )
 select n.id,n.claim_token,a.id,i.id,n.event,n.channel,i.kind,private.mask(f.name),
 case when n.event='open' then i.metric_at_open else i.metric_worst end,
 case when n.channel='slack' and not s.broken then v.decrypted_secret end,s.slack_destination,s.slack_webhook_secret_id,
 case when s.email_enabled or s.broken then u.email::text end,n.digest,a.name,
 coalesce(f.method='*' and f.route='*',false),
 case when n.channel='push' and s.push_enabled and p.user_id=a.owner_id
  and private.push_session_active(p.user_id,p.session_id) then
 jsonb_build_object('device',p.id,'endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth) end
 from claimed n left join public.incidents i on i.id=n.incident_id left join public.features f on f.id=i.feature_id
 join public.apps a on a.id=coalesce(i.app_id,n.test_app) join auth.users u on u.id=a.owner_id
 left join public.alert_channels s on s.app_id=a.id left join public.push_subscriptions p on p.id=n.push_device
 left join vault.decrypted_secrets v on v.id=s.slack_webhook_secret_id;
end $$;

create or replace function public.prepare_push_delivery(id uuid, token uuid, app uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 job public.notifications;
 target jsonb;
begin
 select n.* into job from public.notifications n where n.id=$1 and n.claim_token=$2
 and n.channel='push' and n.sent_at is null for update;
 if not found then return null; end if;
 delete from public.push_subscriptions p where p.id=job.push_device
  and not private.push_session_active(p.user_id,p.session_id);
 select jsonb_build_object('endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth) into target
 from public.apps a join public.alert_channels s on s.app_id=a.id and s.push_enabled
 join public.push_subscriptions p on p.id=job.push_device and p.user_id=a.owner_id
 where private.push_session_active(p.user_id,p.session_id)
 and a.id=$3 and a.id=coalesce((select i.app_id from public.incidents i where i.id=job.incident_id),job.test_app);
 if target is null then
  update public.notifications n set sent_at=now(),ok=false,error='푸시 발송 취소',claimed_at=null,claim_token=null
  where n.id=job.id;
 end if;
 return target;
end $$;
