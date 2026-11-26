create function public.revoke_app_key(p_app uuid, p_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.apps where id = p_app and owner_id = auth.uid() for update;
  if not found then raise exception 'app unavailable' using errcode = '42501'; end if;
  update public.app_keys set revoked_at = coalesce(revoked_at, now())
    where id = p_key and app_id = p_app;
  if not found then raise exception 'key unavailable' using errcode = '42501'; end if;
end $$;
revoke all on function public.revoke_app_key(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_app_key(uuid, uuid) to authenticated;
