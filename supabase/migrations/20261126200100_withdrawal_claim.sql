create table private.withdrawal_claims (
  member uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);

-- A crashed Worker leaves a bounded lease. An old retry cannot release a newer claim.
create function public.claim_withdrawal(member_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare claim_token uuid := gen_random_uuid();
begin
  insert into private.withdrawal_claims as c values
    (member_id, claim_token, clock_timestamp() + interval '2 minutes')
  on conflict (member) do update set token = excluded.token, expires_at = excluded.expires_at
    where c.expires_at <= clock_timestamp();
  if found then return claim_token; end if;
  return null;
end $$;

create function public.release_withdrawal(member_id uuid, claim_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.withdrawal_claims where member = member_id and token = claim_token
$$;
revoke all on function public.claim_withdrawal(uuid), public.release_withdrawal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_withdrawal(uuid), public.release_withdrawal(uuid, uuid)
  to service_role;
