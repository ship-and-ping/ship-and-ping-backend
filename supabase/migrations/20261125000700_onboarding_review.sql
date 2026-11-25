begin;
alter table public.apps drop constraint apps_https_url;
create function private.check_app_url() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'UPDATE' and new.url is not distinct from old.url then return new; end if;
  if new.url is not null and (
    char_length(new.url) > 2048 or new.url ~ '[[:space:][:cntrl:]]' or strpos(new.url,chr(92))<>0 or
    new.url !~ '^https://([[:alnum:]-]+([.][[:alnum:]-]+)*|\[[0-9a-fA-F:.]+\])(:[0-9]{1,5})?([/?#].*)?$'
  ) then
    raise exception 'invalid app URL' using errcode='23514', constraint='apps_https_url';
  end if;
  return new;
end $$;
create trigger apps_https_url before insert or update of url on public.apps
for each row execute function private.check_app_url();

create or replace function private.mask(s text) returns text language sql immutable strict set search_path='' as $$
 select left(regexp_replace(s,
   'Bearer[[:space:]]+[^[:space:],;]+|(sp_(srv|pub)|sb_(secret|publishable))_[a-z0-9_.=+-]*|\m(sk|pk|rk)_[a-z0-9]{16,}[a-z0-9_.=+-]*|eyJ[[:alnum:]_.=-]+|[[:alnum:]._+%-]+(@|%40)[[:alnum:].-]+\.[[:alpha:]]{2,}|\m((access_|refresh_|id_)?token|(api[_-]?)?key)=[^&#[:space:]]+|\+?[0-9]([ ().-]*[0-9]){8,14}',
   '[가림]','gi'),300)
$$;

drop function public.confirm_feature_names(uuid,jsonb);
create function public.confirm_feature_names(p_app_id uuid,p_items jsonb) returns jsonb
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
      if not found then
        skipped := skipped || jsonb_build_object('method',verb,'route',path);
      end if;
    end if;
    update public.feature_map_suggestions set applied=true
      where app_id=p_app_id and method=verb and route=path and not applied;
  end loop;
  return skipped;
end $$;
revoke all on function public.confirm_feature_names(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_feature_names(uuid,jsonb) to authenticated;
commit;
