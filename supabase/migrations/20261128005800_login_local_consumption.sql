create or replace function public.login_step(p_id uuid,p_action text,p_email text,p_ip text,p_secret text,p_code text,p_key text,p_token text,p_proof text,p_mail_time bigint)
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
 elsif p_action='local' then
  -- The row is locked above. Only this pending-to-used transition consumes
  -- the return path; later approvals and polls still receive plain 'used'.
  update private.login_requests set status='used' where id=p_id;
  return '{"status":"used","local_consumed":true}';
 else return '{"status":"missing"}';
 end if;
 update private.login_requests set status=result where id=p_id;
 return jsonb_build_object('status',result);
end $$;
