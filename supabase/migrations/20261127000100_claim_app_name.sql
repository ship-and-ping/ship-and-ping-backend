drop function public.claim_notifications(integer);
create function public.claim_notifications("limit" integer)
returns table(id uuid,claim_token uuid,app uuid,incident uuid,event text,channel text,kind text,feature text,
 metric jsonb,hook text,destination text,secret_id uuid,email text,digest boolean,app_name text)
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
 case when s.email_enabled or s.broken then u.email::text end,n.digest,a.name
 from claimed n left join public.incidents i on i.id=n.incident_id left join public.features f on f.id=i.feature_id
 join public.apps a on a.id=coalesce(i.app_id,n.test_app) join auth.users u on u.id=a.owner_id
 left join public.alert_channels s on s.app_id=a.id left join vault.decrypted_secrets v on v.id=s.slack_webhook_secret_id;
end $$;

revoke all on function public.claim_notifications(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_notifications(integer) to service_role;
