-- The Worker and web import the same JSON literal used by PostgreSQL.
create function private.diagnostic_keys() returns jsonb
language sql immutable set search_path = '' as $$
  select $keys$["status","status_code","code","error","error_code","type","kind","reason","method","route","path","line","column","file","function","stack","duration","duration_ms","timeout","retry","attempt","step","version","platform","feature"]$keys$::jsonb
$$;
revoke all on function private.diagnostic_keys() from public, anon, authenticated, service_role;
