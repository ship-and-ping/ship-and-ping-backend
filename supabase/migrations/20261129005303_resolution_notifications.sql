create function private.incident_event_current(i public.incidents, event_name text) returns boolean
language sql immutable set search_path='' as $$
 select case event_name
  when 'volume_unverified' then i.status='quiet' and i.volume_quiet_since is not null
  when 'volume_quiet' then i.status='open' and i.volume_quiet_since is not null and i.volume_recovered_at is null
  else i.status='open' or (i.status='resolved' and event_name='resolved') end
$$;
revoke all on function private.incident_event_current(public.incidents,text) from public,anon,authenticated,service_role;

create or replace function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean,app_name text,is_overflow boolean,push_target jsonb)
language plpgsql security definer set search_path='' as $$
begin
 update public.notifications n set sent_at=now(),ok=false,error='종결된 문제',claim_token=null,claimed_at=null
 from public.incidents i join public.features f on f.id=i.feature_id
 where n.incident_id=i.id and n.sent_at is null and
 (f.hidden or not private.incident_event_current(i,n.event));
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

create or replace function public.expand_mail_digest(id uuid,token uuid) returns integer
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
    (not f.hidden and private.incident_event_current(i,n.event)))
  for update of n skip locked
 ), attached as (
  update public.notifications n set claimed_at=now(),claim_token=$2 from extra where n.id=extra.id returning 1
 ) select count(*)::integer from attached
$$;
