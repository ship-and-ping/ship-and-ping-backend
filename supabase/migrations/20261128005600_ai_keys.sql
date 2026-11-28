-- Private tables are accessible only through explicitly granted RPCs.
create table private.ai_keys (
 id uuid primary key default gen_random_uuid(),
 app_id uuid not null references public.apps on delete cascade,
 key_hash text unique not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '90 days',
 revoked_at timestamptz, last_used_at timestamptz
);
create index on private.ai_keys(app_id);
create table private.ai_access (
 key_id uuid not null references private.ai_keys on delete cascade,
 tool text not null, used_at timestamptz not null
);
create index on private.ai_access(key_id, used_at);
create index on private.ai_access(used_at);
revoke all on private.ai_keys, private.ai_access from public, anon, authenticated, service_role;

create function public.issue_ai_key(p_app uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare raw_key text; new_id uuid;
begin
 perform 1 from public.apps where id=p_app and owner_id=auth.uid() for update;
 if not found then raise insufficient_privilege; end if;
 if (select count(*) from private.ai_keys where app_id=p_app and revoked_at is null and expires_at>clock_timestamp())>=3 then
  raise exception 'key limit reached' using errcode='23514';
 end if;
 -- The sk_ prefix also matches existing credential redaction in every layer.
 raw_key := 'sk_spai_' || encode(extensions.gen_random_bytes(32),'hex');
 insert into private.ai_keys(app_id,key_hash)
 values (p_app,encode(extensions.digest(raw_key,'sha256'),'hex')) returning id into new_id;
 return jsonb_build_object('id',new_id,'key',raw_key);
end $$;

create function public.list_ai_keys(p_app uuid)
returns table(id uuid,created_at timestamptz,expires_at timestamptz,last_used_at timestamptz)
language sql stable security definer set search_path='' as $$
 select k.id,k.created_at,k.expires_at,k.last_used_at from private.ai_keys k
 join public.apps a on a.id=k.app_id where a.owner_id=auth.uid() and a.id=p_app
 and k.revoked_at is null and k.expires_at>now() order by k.created_at desc,k.id
$$;
create function public.revoke_ai_key(p_app uuid,p_key uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.ai_keys k set revoked_at=coalesce(k.revoked_at,clock_timestamp())
 from public.apps a where k.app_id=a.id and a.owner_id=auth.uid() and a.id=p_app and k.id=p_key;
 if not found then raise insufficient_privilege; end if;
end $$;
revoke all on function public.issue_ai_key(uuid),public.list_ai_keys(uuid),public.revoke_ai_key(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.issue_ai_key(uuid),public.list_ai_keys(uuid),public.revoke_ai_key(uuid,uuid) to authenticated;

alter function private.cleanup_daily() rename to cleanup_before_ai;
create function private.cleanup_daily() returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.cleanup_before_ai();
 delete from private.ai_access where used_at<now()-interval '30 days';
 delete from private.ai_keys where least(expires_at,revoked_at)<now()-interval '30 days';
end $$;
revoke all on function private.cleanup_daily() from public,anon,authenticated,service_role;
