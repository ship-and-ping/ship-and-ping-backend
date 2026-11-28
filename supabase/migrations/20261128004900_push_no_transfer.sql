-- A device may only be registered by an explicit opt-in for an owned app.
create or replace function public.register_push(app uuid, p_endpoint text,p_key text,p_auth text,p_agent text,
 p_fingerprint text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare
 member uuid := auth.uid();
 device uuid;
begin
 perform private.owned_app(app);
 -- Keep the ten-device limit atomic across registrations for the same member.
 perform pg_advisory_xact_lock(4901,hashtext(member::text));
 insert into public.push_subscriptions as p(user_id,endpoint,p256dh,auth,user_agent,vapid_fingerprint)
 values(member,p_endpoint,p_key,p_auth,p_agent,p_fingerprint)
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

-- After an account switch the old session cannot delete its row through RLS.
-- Possession of both browser keys permits revocation only.
create function public.unregister_browser_push(p_endpoint text,p_key text,p_auth text)
returns void language sql security definer set search_path='' as $$
 delete from public.push_subscriptions p
 where auth.uid() is not null and p.endpoint=p_endpoint and p.p256dh=p_key and p.auth=p_auth
$$;
revoke all on function public.unregister_browser_push(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.unregister_browser_push(text,text,text) to authenticated;

create or replace function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean,app_name text,is_overflow boolean,push_target jsonb)
language plpgsql security definer set search_path='' as $$
begin
 update public.notifications n set sent_at=now(),ok=false,error='종결된 문제',claim_token=null,claimed_at=null
 from public.incidents i join public.features f on f.id=i.feature_id
 where n.incident_id=i.id and n.sent_at is null and
 (f.hidden or not (i.status='open' or (i.status='resolved' and n.event='resolved')));
 -- Deleting the mismatched subscription nulls queued device references via the FK.
 delete from public.push_subscriptions p where p.id in (
  select n.push_device from public.notifications n
  left join public.incidents i on i.id=n.incident_id
  join public.apps a on a.id=coalesce(i.app_id,n.test_app)
  join public.push_subscriptions d on d.id=n.push_device
  where n.channel='push' and n.sent_at is null and n.available_at<=now()
   and d.user_id<>a.owner_id
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
 case when n.channel='push' and s.push_enabled and p.user_id=a.owner_id then
 jsonb_build_object('device',p.id,'endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth) end
 from claimed n left join public.incidents i on i.id=n.incident_id left join public.features f on f.id=i.feature_id
 join public.apps a on a.id=coalesce(i.app_id,n.test_app) join auth.users u on u.id=a.owner_id
 left join public.alert_channels s on s.app_id=a.id left join public.push_subscriptions p on p.id=n.push_device
 left join vault.decrypted_secrets v on v.id=s.slack_webhook_secret_id;
end $$;
