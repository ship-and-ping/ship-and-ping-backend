alter table public.notifications add column claimed_at timestamptz;

create function public.claim_notifications("limit" integer) returns setof public.notifications
language sql security definer set search_path='' as $$
 with candidates as (
  select id from public.notifications where sent_at is null
   and (claimed_at is null or claimed_at<=statement_timestamp()-interval '10 minutes')
  order by queued_at,id limit greatest($1,0) for update skip locked
 )
 update public.notifications n set claimed_at=statement_timestamp()
 from candidates c where n.id=c.id returning n.*
$$;

create function public.complete_notification(id uuid,ok boolean,error text) returns void
language sql security definer set search_path='' as $$
 update public.notifications n set sent_at=statement_timestamp(),ok=$2,
  error=case when not $2 then private.mask(regexp_replace($3,'https?://[^[:space:]]+','[가림]','gi')) end
 where n.id=$1 and n.claimed_at is not null and n.sent_at is null and $2 is not null
$$;

alter function public.cleanup_daily() set schema private;
revoke all on function private.cleanup_daily() from public,anon,authenticated,service_role;
create function public.cleanup_daily() returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.cleanup_daily();
 delete from private.latest_results where received_at<now()-interval '30 days';
 delete from public.notifications where queued_at<now()-interval '30 days';
end $$;
revoke all on function public.claim_notifications(integer),public.complete_notification(uuid,boolean,text),public.cleanup_daily()
 from public,anon,authenticated,service_role;
grant execute on function public.claim_notifications(integer),public.complete_notification(uuid,boolean,text),public.cleanup_daily()
 to service_role;
