create table private.login_requests (
 id uuid primary key default gen_random_uuid(), email text not null,
 poll_secret_hash bytea not null, match_code_hash bytea not null, mail_secret_hash bytea not null,
 status text not null default 'pending' check(status in ('pending','issuing','approved','denied','mismatch','used')),
 token_cipher bytea, client_info jsonb not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes'
);
create index on private.login_requests(expires_at);
create table private.login_limits (
 bucket bytea primary key, since timestamptz not null, hits integer not null
);
alter table private.login_requests enable row level security;
alter table private.login_limits enable row level security;
revoke all on private.login_requests,private.login_limits from public,anon,authenticated,service_role;

create function private.login_allow(kind text, subject text, maximum integer) returns boolean
language plpgsql set search_path='' as $$
declare n int;
begin
 insert into private.login_limits as l values(extensions.digest(kind||':'||subject,'sha256'),now(),1)
 on conflict(bucket) do update set
 hits=case when l.since <= now()-interval '10 minutes' then 1 else least(maximum+1,l.hits+1) end,
 since=case when l.since <= now()-interval '10 minutes' then now() else l.since end returning hits into n;
 return n<=maximum;
end $$;

-- Check anonymous traffic before it can trigger a Supabase Auth lookup.
create function public.login_auth_budget(p_ip text) returns boolean language sql security definer set search_path=''
as $$ select private.login_allow('auth-ip',p_ip,100) $$;
revoke all on function public.login_auth_budget(text) from public,anon,authenticated;
grant execute on function public.login_auth_budget(text) to service_role;

create function public.login_create(p_email text,p_ip text,p_browser text,p_place text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid:=gen_random_uuid(); secret text:=encode(extensions.gen_random_bytes(32),'hex');
 mail_secret text:=encode(extensions.gen_random_bytes(32),'hex'); digit_pair integer; answer text; expiry timestamptz;
begin
 if not private.login_allow('create-ip',p_ip,30) or not private.login_allow('create-email',lower(trim(p_email)),5) then
  return '{"status":"limited"}';
 end if;
 loop
  digit_pair:=get_byte(extensions.gen_random_bytes(1),0);
  exit when digit_pair<200;
 end loop;
 answer:=lpad((digit_pair%100)::text,2,'0');
 insert into private.login_requests(id,email,poll_secret_hash,match_code_hash,mail_secret_hash,client_info)
 values(rid,lower(trim(p_email)),extensions.digest(secret,'sha256'),extensions.digest(rid::text||answer,'sha256'),extensions.digest(mail_secret,'sha256'),
 jsonb_build_object('browser',p_browser,'place',p_place)) returning expires_at into expiry;
 return jsonb_build_object('request_id',rid,'poll_secret',secret,'match_code',answer,'expires_at',expiry,'mail_secret',mail_secret);
end $$;

-- PostgREST verifies the bearer before exposing the original authentication method and timestamp.
create function public.login_mail_time() returns bigint language sql stable set search_path='' as $$
 select max((m->>'timestamp')::bigint) from jsonb_array_elements(auth.jwt()->'amr') m where m->>'method'='otp'
$$;
revoke all on function public.login_mail_time() from public,anon;
grant execute on function public.login_mail_time() to authenticated;

create function public.login_step(p_id uuid,p_action text,p_email text,p_ip text,p_secret text,p_code text,p_key text,p_token text,p_proof text,p_mail_time bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.login_requests; result text; category text:=case when p_action='poll' then 'poll' else 'approve' end;
begin
 if not private.login_allow(category||'-ip',p_ip,case when category='poll' then 1500 else 100 end) then return '{"status":"limited"}'; end if;
 select * into r from private.login_requests where id=p_id for update;
 if not found then return '{"status":"missing"}'; end if;
 if p_action='poll' or p_action='local' then
  if r.poll_secret_hash is distinct from extensions.digest(p_secret,'sha256') then return '{"status":"missing"}'; end if;
 end if;
 if p_action<>'poll' and r.email is distinct from lower(trim(p_email)) then return '{"status":"missing"}'; end if;
 if p_action in ('inspect','claim','deny','local') and
  (r.mail_secret_hash is distinct from extensions.digest(p_proof,'sha256') or p_mail_time is null
   or to_timestamp(p_mail_time)<date_trunc('second',r.created_at)
   or to_timestamp(p_mail_time)<clock_timestamp()-interval '5 minutes' or to_timestamp(p_mail_time)>clock_timestamp()) then
  return '{"status":"mail_required"}';
 end if;
 if not private.login_allow(category||'-email',r.email,case when category='poll' then 600 else 40 end) then return '{"status":"limited"}'; end if;
 if r.expires_at<=clock_timestamp() then return '{"status":"expired"}'; end if;
 if p_action='poll' then
  if r.status='approved' then
   update private.login_requests set status='used',token_cipher=null where id=p_id;
   return jsonb_build_object('status','approved','token_hash',extensions.pgp_sym_decrypt(r.token_cipher,p_key));
  end if;
  return jsonb_build_object('status',case when r.status='issuing' then 'pending' else r.status end);
 end if;
 if p_action='seal' and r.status='issuing' and length(p_token)>0 then
  update private.login_requests set status='approved',token_cipher=extensions.pgp_sym_encrypt(p_token,p_key) where id=p_id;
  return '{"status":"approved"}';
 end if;
 if r.status<>'pending' then return '{"status":"used"}'; end if;
 if p_action='inspect' then
  return jsonb_build_object('status','pending','client_info',r.client_info,'created_at',r.created_at);
 elsif p_action='claim' then
  if r.match_code_hash is distinct from extensions.digest(p_id::text||p_code,'sha256') then
   update private.login_requests set status='mismatch' where id=p_id;
   return '{"status":"mismatch"}';
  end if;
  result:='issuing';
 elsif p_action='deny' then result:='denied';
 elsif p_action='local' then result:='used';
 else return '{"status":"missing"}';
 end if;
 update private.login_requests set status=result where id=p_id;
 return jsonb_build_object('status',result);
end $$;

alter function private.cleanup_daily() rename to cleanup_before_login_requests;
create function private.cleanup_daily() returns void language plpgsql set search_path='' as $$
begin
 perform private.cleanup_before_login_requests();
 delete from private.login_requests where expires_at<=now();
 delete from private.login_limits where since<=now()-interval '10 minutes';
end $$;
revoke all on function private.cleanup_daily(),private.login_allow(text,text,integer),
 public.login_create(text,text,text,text),public.login_step(uuid,text,text,text,text,text,text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.login_create(text,text,text,text),public.login_step(uuid,text,text,text,text,text,text,text,text,bigint) to service_role;
