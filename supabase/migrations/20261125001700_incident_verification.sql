create function public.incident_verification(incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 issue public.incidents;
 progress record;
begin
 select i.* into issue from public.incidents i join public.apps a on a.id=i.app_id
 where i.id=$1 and a.owner_id=auth.uid();
 if not found then raise exception 'incident unavailable' using errcode='42501'; end if;
 select * into progress from private.verification_progress(issue);
 return jsonb_build_object('version',progress.version,'consecutive_successes',coalesce(progress.consecutive_successes,0),
  'latest_duration_ms',progress.latest_duration_ms,'latest_success',progress.latest_success);
end $$;
revoke all on function public.incident_verification(uuid) from public,anon,authenticated,service_role;
grant execute on function public.incident_verification(uuid) to authenticated;
