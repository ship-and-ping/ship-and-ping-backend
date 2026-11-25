create function public.dismiss_incident(incident_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 current_status text;
begin
 select i.status into current_status from public.incidents i join public.apps a on a.id=i.app_id
 where i.id=$1 and a.owner_id=auth.uid() for update of i;
 if not found then raise exception 'incident unavailable' using errcode='42501'; end if;
 if current_status<>'open' then return; end if;
 update public.incidents set status='dismissed',closed_at=now(),dismissed_until=now()+interval '24 hours'
 where id=$1;
 delete from public.notifications n where n.incident_id=$1 and n.claimed_at is null and n.sent_at is null;
end $$;
revoke all on function public.dismiss_incident(uuid) from public,anon,authenticated,service_role;
grant execute on function public.dismiss_incident(uuid) to authenticated;
