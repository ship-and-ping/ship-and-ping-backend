create or replace function public.notification_settings(app uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',coalesce(c.email_enabled,false),'channel',private.mask(c.slack_channel_name),
  'connected',c.slack_webhook_secret_id is not null and not c.broken,'broken',coalesce(c.broken,false),
  'push',coalesce(c.push_enabled,true),'subscribed',exists(
   select from public.push_subscriptions p where c.push_enabled and p.user_id=auth.uid()
    and private.push_session_active(p.user_id,p.session_id)))
 from (select private.owned_app(app) id) a left join public.alert_channels c on c.app_id=a.id
$$;

create or replace function public.list_push_devices()
returns table(id uuid,endpoint text,user_agent text,created_at timestamptz,vapid_fingerprint text,current_session boolean)
language sql stable security definer set search_path='' as $$
 select p.id,p.endpoint,p.user_agent,p.created_at,p.vapid_fingerprint,
  coalesce(p.session_id=(auth.jwt()->>'session_id')::uuid,false)
   and private.push_session_active(p.user_id,p.session_id)
 from public.push_subscriptions p where p.user_id=auth.uid() order by p.created_at,p.id
$$;
