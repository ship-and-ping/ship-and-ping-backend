-- Keep queue ownership, retries and channel-specific fields in the existing claim operation.
create function public.claim_notification_payloads("limit" integer)
returns setof jsonb language sql volatile security definer set search_path='' as $$
  select to_jsonb(n) || jsonb_build_object('app_version',
    case when n.event = 'resolved' then i.resolved_version else i.opened_version end)
  from public.claim_notifications($1) n
  left join public.incidents i on i.id = n.incident and i.app_id = n.app;
$$;

revoke all on function public.claim_notification_payloads(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_payloads(integer) to service_role;
