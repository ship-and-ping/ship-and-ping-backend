-- Remove Supabase's API defaults before granting individual capabilities.
do $$
declare t text;
begin
  foreach t in array array['apps','app_keys','features','app_versions','stats_5m','stats_1h','attempts',
    'error_samples','baselines','incidents','notifications','alert_channels','ingest_batches','feature_map_suggestions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    if t not in ('app_keys','alert_channels') then
      execute format('grant select on public.%I to authenticated',t);
    end if;
    if t not in ('apps','baselines','notifications','alert_channels') then
      execute format('create policy owned_app on public.%I for select to authenticated using
        (app_id in (select id from public.apps))',t);
    end if;
  end loop;
end $$;
create policy own_apps on public.apps for select to authenticated using(owner_id=(select auth.uid()));
create policy register on public.apps for insert to authenticated with check(owner_id=(select auth.uid()));
create policy edit on public.apps for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy remove on public.apps for delete to authenticated using(owner_id=(select auth.uid()));
grant insert(name,url), update(name,url), delete on public.apps to authenticated;

create policy edit on public.features for update to authenticated using(app_id in (select id from public.apps))
  with check(app_id in (select id from public.apps));
grant update(name,hidden,slow_threshold_ms) on public.features to authenticated;
create function private.confirm_feature_name() returns trigger language plpgsql set search_path='' as $$
begin
  new.name_source := 'confirmed';
  return new;
end $$;
create trigger confirm_name before update of name on public.features for each row execute function private.confirm_feature_name();

create policy owned_feature on public.baselines for select to authenticated using(feature_id in (select id from public.features));
create policy owned_incident on public.notifications for select to authenticated using(incident_id in (select id from public.incidents));
create policy own_settings on public.alert_channels to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant select(owner_id,email_enabled,slack_channel_name),insert(email_enabled),update(email_enabled)
  on public.alert_channels to authenticated;
grant select(id,app_id,kind,prefix,expires_at,revoked_at) on public.app_keys to authenticated;
create view public.app_key_list with (security_invoker=true) as
  select id,app_id,kind,prefix,expires_at,revoked_at from public.app_keys;
revoke all on public.app_key_list from public,anon,authenticated,service_role;
grant select on public.app_key_list to authenticated;

create role grafana_reader nologin;
grant usage on schema public to grafana_reader;
grant select(id,created_at,first_record_at) on public.apps to grafana_reader;
grant select on public.stats_5m,public.stats_1h,public.incidents,public.notifications to grafana_reader;
create policy metrics on public.apps for select to grafana_reader using(true);
create policy metrics on public.stats_5m for select to grafana_reader using(true);
create policy metrics on public.stats_1h for select to grafana_reader using(true);
create policy metrics on public.incidents for select to grafana_reader using(true);
create policy metrics on public.notifications for select to grafana_reader using(true);
