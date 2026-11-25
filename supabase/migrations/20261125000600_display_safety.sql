begin;
alter table public.apps add constraint apps_https_url check (
  url is null or (
    char_length(url) <= 2048 and url !~ '[[:space:][:cntrl:]]' and strpos(url,chr(92))=0 and
    url ~ '^https://([[:alnum:]-]+([.][[:alnum:]-]+)*|\[[0-9a-fA-F:.]+\])(:[0-9]{1,5})?([/?#].*)?$'
  )
) not valid;

-- Enforce the constraint on new writes immediately. Preserve any old invalid
-- values for the owner to correct without blocking this migration.
do $$begin
  alter table public.apps validate constraint apps_https_url;
exception when check_violation then
  raise notice 'Existing app addresses need correction before validating apps_https_url';
end$$;

create or replace function public.confirm_feature_names(p_app_id uuid,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  title text;
  verb text;
  path text;
  resolved_id uuid;
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
      perform 1 from public.feature_map_suggestions
        where app_id=p_app_id and method=verb and route=path;
      if not found then raise exception 'route unavailable' using errcode='22023'; end if;
      resolved_id:=private.auto_feature(p_app_id,verb,path);
      -- Every excess route shares the same bucket. A single proposal must
      -- never rename it or hide it for all the other overflow routes.
      update public.features set name=title,hidden=(item->>'hidden')::boolean
        where id=resolved_id and app_id=p_app_id and method<>'*';
    end if;
    update public.feature_map_suggestions set applied=true
      where app_id=p_app_id and method=verb and route=path and not applied;
  end loop;
end $$;
commit;
