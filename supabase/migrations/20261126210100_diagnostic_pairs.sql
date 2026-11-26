create or replace function private.credential_value_pattern() returns text
language sql immutable set search_path = '' as $$
  select $pat$[/%]+\s*=>?\s*|(?:\\*"[^"\n]*\\*"|\\*'[^'\n]*\\*'|[^\s/\\%"'=:,;<>{}\[\]&?#]+)\s*(?:=>|->|,|:|=|%3[aAdD])\s*$pat$
$$;

-- A null replacement identifies a version whose numeric component is diagnostic.
create function private.diagnostic_pairs(t text) returns table(r int4range, replacement text)
language plpgsql immutable strict set search_path = '' as $$
declare
  rest text; next_pair int; pos int := 1; a int; b int; stop int; prefix text; tail text; k text;
  plain boolean; header boolean; span int4range;
  allowed text[] := array(select replace(value,'_','') from jsonb_array_elements_text(private.diagnostic_keys()));
begin
  loop
    a := regexp_instr(t collate "C", private.credential_value_pattern(), pos);
    exit when a = 0;
    b := regexp_instr(t collate "C", private.credential_value_pattern(), a,1,1);
    pos := b;
    prefix := rtrim(substr(t,a,b-a), E' \t\n\r\f\v');
    k := translate(lower(regexp_replace(rtrim(regexp_replace(prefix,'(=>|->|,|:|=|%3[aAdD])$','')), $pat$(^\\*["']|\\*["']$)$pat$, '', 'g') collate "C"),'_-','');
    if a > 1 and substr(t,a-1,1) in ('/', '#', '%', '\') then k := ''; end if;
    tail := substr(t,b);
    if right(prefix,1) = ':' and ((k in ('http','https') and left(tail,2) = '//') or k = 'bearer'
        or k collate "C" ~ '[^\x01-\x7f](bearer|cookie|authorization)$') then continue; end if;
    if right(prefix,1) = ',' and (b-a=length(prefix) or (a>1 and substr(t,a-1,1) !~ '\s') or k ~ '^[0-9]') then continue; end if;
    if k = any(allowed) and k not in ('route','path','version') then continue; end if;
    span := private.value_span(t,b,length(prefix)-length(ltrim(prefix,'\')));
    if k = any(allowed) then
      if span is null or isempty(span) then continue; end if;
      r := span;
      if k = 'version' then
        if substr(t,lower(r),upper(r)-lower(r)) collate "C" !~ '^[A-Za-z0-9._+-]{1,64}$'
          or substr(t,lower(r),upper(r)-lower(r)) collate "C" ~* '(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_)[a-z0-9_.=-]+|(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}' then continue; end if;
        replacement := null;
      else
        if lower(span) = b then
          stop := b + length(substring(tail from $pat$^[^\s"',}\]]*$pat$));
          r := int4range(b,greatest(stop,upper(span)));
        end if;
        replacement := private.route(substr(t,lower(r),upper(r)-lower(r)));
        pos := upper(r);
      end if;
      return next;
      continue;
    end if;
    plain := left(prefix,1) not in ('\', '"', '''');
    header := plain and right(prefix,1) = ':';
    if lower(right(prefix,3)) = '%3a' then
      stop := b + length(substring(tail from '^[^&\n]*'));
      span := int4range(b,greatest(stop,upper(span)));
    elsif header or prefix collate "C" ~* '^(set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)\s*=$'
        or tail collate "C" ~* '^digest\s' or (plain and (right(prefix,2) in ('=>','->') or right(prefix,1) = ',')) then
      stop := b + length(split_part(tail,E'\n',1));
      span := int4range(case when header then a else b end,greatest(stop,upper(span)));
    elsif plain and left(tail,1) not in ('\', '"', '''', '[', '{') then
      stop := b + length(substring(tail collate "C" from '^[^\s&;]*'));
      stop := greatest(stop,upper(span));
      if substr(t,stop,1) in (' ', E'\t') and left(t,a-1) !~ '\?\S*$' then
        rest := substring(substr(t,stop) from '^[^;&\n]*');
        next_pair := regexp_instr(rest collate "C",private.credential_value_pattern());
        stop := stop + length(rtrim(case when next_pair=0 then rest else left(rest,next_pair-1) end,E' \t'));
      end if;
      span := int4range(b,stop);
    end if;
    if span is not null and not isempty(span) then
      pos := upper(span);
      r := span; replacement := '[가림]'; return next;
    end if;
  end loop;
end $$;
revoke all on function private.diagnostic_pairs(text) from public, anon, authenticated, service_role;

create or replace function private.mask_spans(t text, pattern text, kind text) returns setof int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  cursor_pos int := 1; first_pos int; after_pos int;
  stop int;
begin
  loop
    first_pos := regexp_instr(t collate "C", pattern, cursor_pos);
    exit when first_pos = 0;
    after_pos := regexp_instr(t collate "C", pattern, cursor_pos,1,1);
    cursor_pos := after_pos;
    if kind = 'line_value' then
      stop := after_pos + length(split_part(substr(t,after_pos),E'\n',1));
      return next int4range(after_pos,stop);
      cursor_pos := stop;
    elsif kind <> 'number' or not private.safe_timestamp(substr(t,first_pos,after_pos-first_pos)) then
      return next int4range(first_pos,after_pos);
    end if;
  end loop;
end $$;

create or replace function private.mask(s text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare
  truncated boolean := length(left(s,2001)) > 2000;
  path_pattern constant text := '[A-Za-z0-9_.:-]*(?:/[A-Za-z0-9_.{}:=-]+)+';
  first_pos int; after_pos int; path text; prefix text;
  t text := private.normalize_text(left(s,2000)); result text := ''; cursor_pos int := 1; span int4range; item record;
begin
  truncated := truncated or length(t) > 2000;
  t := left(t,2000);
  loop
    first_pos := regexp_instr(t collate "C", path_pattern, cursor_pos);
    exit when first_pos = 0;
    after_pos := regexp_instr(t collate "C", path_pattern, first_pos,1,1);
    path := substr(t,first_pos,after_pos-first_pos);
    prefix := split_part(path,'/',1);
    path := substr(path,length(prefix)+1);
    if prefix !~ '^[0-9._-]+$' or path !~ '^[0-9/]+$' then
      select string_agg(case when part collate "C" ~* '^[0-9]+$|^[a-z0-9]{16,}$'
        or (part collate "C" ~* '^(urn:uuid:|\{)?[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$'
            and (left(part,1) = '{') = (right(part,1) = '}'))
        then ':id' else part end, '/' order by idx) into path
      from unnest(string_to_array(path,'/')) with ordinality parts(part,idx);
    end if;
    result := result || substr(t,cursor_pos,first_pos-cursor_pos) || prefix || path;
    cursor_pos := after_pos;
  end loop;
  t := result || substr(t,cursor_pos);
  cursor_pos := 1;
  result := '';
  for item in with pairs as materialized (select * from private.diagnostic_pairs(t)) select r, replacement from (
    select r,replacement from pairs where replacement is not null
    union all select r, '[가림]' from private.mask_spans(t,
      '(?i)(?<![A-Za-z0-9_])(?:set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)[ \t]*=(?!>)', 'line_value') r
    union all select r, '[가림]' from unnest(private.mask_patterns()) p,
      private.mask_spans(t, '(?i)' || p, 'private') r
    union all select r, '[가림]' from private.mask_spans(t, private.numeric_pattern(), 'number') as n(r)
    where not exists (select 1 from pairs where replacement is null and pairs.r @> n.r)
  ) ranges where not isempty(r) order by lower(r) loop
    span := item.r;
    if lower(span) >= cursor_pos then
      result := result || substr(t,cursor_pos,lower(span)-cursor_pos) || item.replacement;
    end if;
    cursor_pos := greatest(cursor_pos,upper(span));
  end loop;
  result := regexp_replace(result || substr(t,cursor_pos), $q$(?n)^\?[^\n]+|\?\S+$q$, '?[가림]', 'g');
  if truncated then return left(result,295) || '…[잘림]'; end if;
  return left(result,300);
end $$;
