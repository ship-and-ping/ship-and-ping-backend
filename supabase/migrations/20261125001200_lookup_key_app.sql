create function public.lookup_key_app(app_key_hash text) returns uuid
language sql stable security definer set search_path = '' as $$
  select k.app_id from public.app_keys k
  where k.key_hash = app_key_hash and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > now())
$$;
revoke all on function public.lookup_key_app(text) from public, anon, authenticated;
grant execute on function public.lookup_key_app(text) to service_role;
