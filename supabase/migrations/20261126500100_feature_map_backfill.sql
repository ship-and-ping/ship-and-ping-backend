alter table public.features validate constraint features_name_source_check;

-- Target rows are locked before copying their names. A concurrent member edit
-- either changes the eligibility first or runs after the backfill and wins.
create function private.backfill_feature_map_names(target_app uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform 1 from public.apps where id=target_app for update;
  with candidates as materialized (
    select f.id,f.name,f.name_source,s.id as suggestion_id,private.feature_map_name(s.name) as title
    from public.features f join public.feature_map_suggestions s
      on s.app_id=f.app_id and s.method=f.method and s.route=f.route
    where f.app_id=target_app and f.kind='auto' and f.method<>'*' and f.name_source='route'
      and length(s.method) between 1 and 32 and length(s.route) between 1 and 200
      and private.feature_map_name(s.name) is not null
    for update of f
  ), saved as (
    insert into private.feature_map_name_backup(feature_id,previous_name,previous_source,applied_name)
      select id,name,name_source,title from candidates
      on conflict(feature_id) do nothing returning feature_id,applied_name
  ), named as (
    update public.features f set name=b.applied_name,name_source='ai'
    from saved b where f.id=b.feature_id returning f.id
  )
  update public.feature_map_suggestions s set applied=true
    from candidates c join named n on n.id=c.id where s.id=c.suggestion_id;
end $$;
revoke all on function private.backfill_feature_map_names(uuid) from public,anon,authenticated,service_role;

do $$
declare target_app uuid;
begin
  for target_app in select distinct app_id from public.feature_map_suggestions order by app_id loop
    perform private.backfill_feature_map_names(target_app);
    -- Apply eligible historical names before evicting the oldest suggestions.
    delete from public.feature_map_suggestions where app_id=target_app
      and (length(method) not between 1 and 32 or length(route) not between 1 and 200
           or private.feature_map_name(name) is null);
    update public.feature_map_suggestions set name=private.feature_map_name(name)
      where app_id=target_app and name is distinct from private.feature_map_name(name);
    perform private.prune_feature_map(target_app);
  end loop;
end $$;
