-- Maintain one counter per member. Concurrent inserts compete for the same
-- row; a rolled-back registration also rolls back its increment.
begin;
lock table public.apps in share row exclusive mode;
create table private.app_counts (
  owner_id uuid primary key,
  total bigint not null check (total >= 0)
);
insert into private.app_counts select owner_id,count(*) from public.apps group by owner_id;

create function private.count_apps() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.owner_id=new.owner_id then return null; end if;
  if tg_op in ('DELETE','UPDATE') then
    update private.app_counts set total=total-1 where owner_id=old.owner_id;
    delete from private.app_counts where owner_id=old.owner_id and total=0;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    insert into private.app_counts as c values(new.owner_id,1)
      on conflict(owner_id) do update set total=c.total+1 where c.total<3;
    if not found then
      raise exception 'app limit reached' using errcode='23514';
    end if;
  end if;
  return null;
end $$;
create trigger member_app_quota after insert or delete or update of owner_id on public.apps
for each row execute function private.count_apps();
revoke all on private.app_counts from public,anon,authenticated,service_role;
revoke all on function private.count_apps() from public,anon,authenticated,service_role;

-- Accept only existing routes or routes suggested for this particular app.
-- The app lock is shared with ingestion and suggestion submission.
create function public.confirm_feature_names(p_app_id uuid,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  title text;
  verb text;
  path text;
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
    if jsonb_typeof(item->'name') is distinct from 'string'
       or title !~ '[^[:space:]]' or length(title)>300 or title='이름 없는 기능'
       or jsonb_typeof(item->'hidden') is distinct from 'boolean'
       or verb is null or verb='*' or path is null then
      raise exception 'invalid label' using errcode='22023';
    end if;
    update public.features set name=title,hidden=(item->>'hidden')::boolean
      where app_id=p_app_id and kind='auto' and method=verb and route=path;
    if not found then
      insert into public.features(app_id,kind,method,route,name,name_source,hidden)
        select p_app_id,'auto',verb,path,title,'confirmed',(item->>'hidden')::boolean
        from public.feature_map_suggestions
        where app_id=p_app_id and method=verb and route=path and not applied;
      if not found then raise exception 'route unavailable' using errcode='22023'; end if;
    end if;
    update public.feature_map_suggestions set applied=true
      where app_id=p_app_id and method=verb and route=path and not applied;
  end loop;
end $$;
revoke all on function public.confirm_feature_names(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_feature_names(uuid,jsonb) to authenticated;
commit;
