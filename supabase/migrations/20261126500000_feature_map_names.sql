alter table public.features drop constraint features_name_source_check;
update public.features set name_source='route' where name_source='suggested';
alter table public.features add constraint features_name_source_check
  check(name_source in ('route','ai','confirmed'));

-- Direct member updates only have privileges on name, hidden and slow_threshold_ms.
-- The owner RPC below explicitly marks renames, while service writes specify ai.
drop trigger confirm_name on public.features;
create trigger confirm_name before update of name on public.features for each row
  when (current_user='authenticated') execute function private.confirm_feature_name();

create function private.feature_map_name(raw text) returns text
language plpgsql immutable strict set search_path='' as $$
begin
  return nullif(private.deep_field(raw),'이름 없는 기능');
exception when invalid_parameter_value then
  return null;
end $$;

-- With no target, upgrade only route-sourced rows. With a target, also refresh
-- earlier AI names. Neither path creates features or changes activity timestamps.
create function private.apply_feature_map_names(target_app uuid default null, verb text default null, path text default null)
returns void language sql set search_path='' as $$
  with named as (
    update public.features f set name=private.feature_map_name(s.name),name_source='ai'
    from public.feature_map_suggestions s
    where f.app_id=s.app_id and f.method=s.method and f.route=s.route
      and f.kind='auto' and f.method<>'*' and private.feature_map_name(s.name) is not null
      and (f.name_source='route' or (target_app is not null and f.name_source='ai'))
      and (target_app is null or (s.app_id=target_app and s.method=verb and s.route=path))
    returning s.id
  )
  update public.feature_map_suggestions s set applied=true from named where named.id=s.id
$$;

-- Called under the same app lock as suggest_feature_map by record ingestion.
create function private.name_new_auto_feature() returns trigger language plpgsql set search_path='' as $$
declare title text;
begin
  update public.feature_map_suggestions set applied=true
    where app_id=new.app_id and method=new.method and route=new.route
    returning private.feature_map_name(name) into title;
  if title is not null then
    new.name:=title;
    new.name_source:='ai';
  end if;
  return new;
end $$;
create trigger name_new_auto_feature before insert on public.features for each row
  when (new.kind='auto' and new.method<>'*' and new.name_source='route')
  execute function private.name_new_auto_feature();

create or replace function public.suggest_feature_map(app_key_hash text,items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  k public.app_keys := private.lock_key(app_key_hash);
  item jsonb;
  path text;
  title text;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>200 then
    raise exception 'invalid feature map' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item->'method') is distinct from 'string' or item->>'method' !~ '^[A-Z-]{1,32}$'
      or jsonb_typeof(item->'route') is distinct from 'string' or item->>'route' not like '/%' or length(item->>'route')>200
      or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name')>300 or item->>'name' !~ '[^[:space:]]' then
      raise exception 'invalid feature map item' using errcode='22023';
    end if;
    title:=private.feature_map_name(item->>'name');
    if title is null then continue; end if;
    path:=private.route(item->>'route');
    insert into public.feature_map_suggestions(app_id,method,route,name)
      values(k.app_id,item->>'method',path,title)
      on conflict(app_id,method,route) do update set name=excluded.name,received_at=now(),applied=false;
    perform private.apply_feature_map_names(k.app_id,item->>'method',path);
  end loop;
end $$;

create or replace function public.confirm_feature_names(p_app_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  title text;
  verb text;
  path text;
  resolved_id uuid;
  skipped jsonb := '[]';
begin
  perform 1 from public.apps where id=p_app_id and owner_id=auth.uid() for update;
  if not found then raise exception 'app unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>400 then
    raise exception 'invalid label list' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) as r(v)
            group by v->>'method',v->>'route' having count(*)>1) then
    raise exception 'duplicate route' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    title:=btrim(item->>'name');
    path:=item->>'route';
    verb:=item->>'method';
    if jsonb_typeof(item->'hidden') is distinct from 'boolean'
       or verb is null or verb='*' or path is null then
      raise exception 'invalid label' using errcode='22023';
    end if;
    if not (item ? 'name') then
      update public.features set hidden=(item->>'hidden')::boolean
        where app_id=p_app_id and kind='auto' and method=verb and route=path;
      if not found then raise exception 'route unavailable' using errcode='22023'; end if;
      continue;
    end if;
    if jsonb_typeof(item->'name') is distinct from 'string' then
      raise exception 'invalid label' using errcode='22023';
    end if;
    title:=private.feature_map_name(title);
    if title is null then raise exception 'invalid label' using errcode='22023'; end if;
    update public.features set name=title,name_source='confirmed',hidden=(item->>'hidden')::boolean
      where app_id=p_app_id and kind='auto' and method=verb and route=path;
    if not found then
      perform 1 from public.feature_map_suggestions
        where app_id=p_app_id and method=verb and route=path;
      if not found then raise exception 'route unavailable' using errcode='22023'; end if;
      resolved_id:=private.auto_feature(p_app_id,verb,path);
      -- Every excess route shares the same bucket. A single proposal must
      -- never rename it or hide it for all the other overflow routes.
      update public.features set name=title,name_source='confirmed',hidden=(item->>'hidden')::boolean
        where id=resolved_id and app_id=p_app_id and method<>'*';
      if not found then
        skipped := skipped || jsonb_build_object('method',verb,'route',path);
      end if;
    end if;
    update public.feature_map_suggestions set applied=true
      where app_id=p_app_id and method=verb and route=path and not applied;
  end loop;
  return skipped;
end $$;

revoke all on function private.name_new_auto_feature(), private.feature_map_name(text),
  private.apply_feature_map_names(uuid,text,text) from public,anon,authenticated,service_role;

select private.apply_feature_map_names();
