-- A browser can retry revocation after unsubscribe has discarded its keys.
create index push_revocation_proof on public.push_subscriptions
 ((extensions.digest(endpoint || chr(10) || p256dh || chr(10) || auth, 'sha256')));

create function public.revoke_push_by_proof(proof text) returns void
language sql security definer set search_path='' as $$
 delete from public.push_subscriptions p where auth.uid() is not null
 and extensions.digest(p.endpoint || chr(10) || p.p256dh || chr(10) || p.auth, 'sha256') = decode($1, 'hex')
$$;
revoke all on function public.revoke_push_by_proof(text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_push_by_proof(text) to authenticated;

-- Read the live credentials after earlier channels finish. Settle a revoked
-- delivery under the same lease without charging a device failure or retry.
create function public.prepare_push_delivery(id uuid, token uuid, app uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 job public.notifications;
 target jsonb;
begin
 select n.* into job from public.notifications n where n.id=$1 and n.claim_token=$2
 and n.channel='push' and n.sent_at is null for update;
 if not found then return null; end if;
 select jsonb_build_object('endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth) into target
 from public.apps a join public.alert_channels s on s.app_id=a.id and s.push_enabled
 join public.push_subscriptions p on p.id=job.push_device and p.user_id=a.owner_id
 where a.id=$3 and a.id=coalesce((select i.app_id from public.incidents i where i.id=job.incident_id),job.test_app);
 if target is null then
  update public.notifications n set sent_at=now(),ok=false,error='푸시 발송 취소',claimed_at=null,claim_token=null
  where n.id=job.id;
 end if;
 return target;
end $$;
revoke all on function public.prepare_push_delivery(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_push_delivery(uuid,uuid,uuid) to service_role;
