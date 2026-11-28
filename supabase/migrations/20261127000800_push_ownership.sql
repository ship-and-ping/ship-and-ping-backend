alter table public.push_subscriptions add column vapid_fingerprint text
 check (vapid_fingerprint ~ '^[a-f0-9]{64}$'),
 alter column created_at set default clock_timestamp();
grant select(vapid_fingerprint) on public.push_subscriptions to authenticated;

-- Enforce the same limit on devices registered before this migration.
with ranked as (
 select id,row_number() over(partition by user_id order by created_at desc,id desc) as position
 from public.push_subscriptions
)
delete from public.push_subscriptions p using ranked r where p.id=r.id and r.position>10;

drop function public.register_push(uuid,text,text,text,text);
create function public.register_push(app uuid, p_endpoint text,p_key text,p_auth text,p_agent text,
 p_fingerprint text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare
 member uuid := auth.uid();
 previous public.push_subscriptions;
 device uuid;
begin
 if member is null then raise insufficient_privilege; end if;
 if app is not null then perform private.owned_app(app); end if;
 -- Serialize concurrent registrations for the account and transfers for this endpoint.
 perform pg_advisory_xact_lock(4901,hashtext(member::text));
 perform pg_advisory_xact_lock(4902,hashtext(p_endpoint));
 select * into previous from public.push_subscriptions where endpoint=p_endpoint for update;
 if found then
  if previous.p256dh is distinct from p_key or previous.auth is distinct from p_auth then
   raise insufficient_privilege;
  end if;
  if previous.user_id=member then
   device := previous.id;
   update public.push_subscriptions set user_agent=p_agent,
    vapid_fingerprint=coalesce(p_fingerprint,vapid_fingerprint) where id=device;
  else
   -- A new row id invalidates queued deliveries and their outstanding leases.
   delete from public.push_subscriptions where id=previous.id;
  end if;
 elsif app is null then
  -- Session restoration must never resurrect a device removed from another browser.
  return null;
 end if;
 if device is null then
  delete from public.push_subscriptions where id in (
   select id from public.push_subscriptions where user_id=member order by created_at desc,id desc offset 9
  );
  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,vapid_fingerprint)
   values(member,p_endpoint,p_key,p_auth,p_agent,p_fingerprint) returning id into device;
 end if;
 if app is not null then update public.alert_channels set push_enabled=true where app_id=app; end if;
 return device;
end $$;
revoke all on function public.register_push(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.register_push(uuid,text,text,text,text,text) to authenticated;

create or replace function public.claim_notifications("limit" integer)
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
