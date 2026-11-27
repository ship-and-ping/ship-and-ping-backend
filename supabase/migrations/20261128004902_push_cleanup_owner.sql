-- A browser may finish cleanup after auth has switched. Match the former
-- member and browser proof without exposing another account's identity.
create function public.cleanup_push_target(p_member uuid, p_endpoint text, proof text, p_remove boolean)
returns text language plpgsql security definer set search_path='' as $$
declare
 target public.push_subscriptions;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 -- A proof without an endpoint is a persisted marker from the previous client.
 select * into target from public.push_subscriptions p
 where p.endpoint=p_endpoint or (p_endpoint is null and
   extensions.digest(p.endpoint || chr(10) || p.p256dh || chr(10) || p.auth,'sha256')=decode(proof,'hex'))
 for update;
 if not found then return 'missing'; end if;
 if target.user_id is distinct from p_member or proof is null or
    extensions.digest(target.endpoint || chr(10) || target.p256dh || chr(10) || target.auth,'sha256')<>decode(proof,'hex')
 then return 'other'; end if;
 if p_remove then delete from public.push_subscriptions where id=target.id; end if;
 return 'owned';
end $$;
revoke all on function public.cleanup_push_target(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_push_target(uuid,text,text,boolean) to authenticated;
