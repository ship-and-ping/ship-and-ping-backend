create or replace function private.credential_value_pattern() returns text
language sql immutable set search_path = '' as $$
  select format($pat$(?:\\*["']%1$s\\*["']|(?<![A-Za-z0-9_])%1$s)\s*(?:=>|->|,|:|=|%%3[aAdD])\s*$pat$,
    '(?:' || fields || '|[A-Za-z0-9_-]*(?:' || words || '|K[eE][yY]|kE[yY]|keY|[A-Z0-9_-]key)[A-Za-z0-9_-]*|keys?(?:[_-][A-Za-z0-9_-]+)?|key[A-Z0-9][A-Za-z0-9_-]*)')
  from (
    select string_agg(case when c = '|' then c else '[' || c || upper(c collate "C") || ']' end,
                      '' order by pos) as words
    from regexp_split_to_table(
      'token|secret|password|passwd|pwd|credential|authorization|cookie|privatekey|accesskey|secretkey|apikey|clientkey|authkey|sessionkey|signingkey|encryptionkey|masterkey', ''
    ) with ordinality as letters(c,pos)
  ) folded cross join (
    select string_agg(case when c collate "C" between 'a' and 'z' then '[' || c || upper(c collate "C") || ']' else c end, '' order by pos) as fields
    from regexp_split_to_table('user[_-]?id|account[_-]?id|member[_-]?id|customer[_-]?id|session[_-]?id|uid|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday', '') with ordinality as letters(c,pos)
  ) personal
$$;

create or replace function private.numeric_pattern() returns text
language sql immutable set search_path = '' as $$
  select '\+?\(?[0-9](?:[ ()./_\t֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭−-]*[0-9]){8,}\)?'
$$;

create or replace function private.mask_patterns() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    '(?<![A-Za-z0-9_])(?:set-cookie|cookie|authorization)[ \t]*:[^\r\n]*',
    '(?<![A-Za-z0-9_])bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"'']+',
    '(?<![A-Za-z0-9_])basic[ \t]+(?:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})',
    '(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?<![A-Za-z0-9_])eyJ)[a-z0-9_.=-]+',
    '(?<![A-Za-z0-9])(?:sk|pk|rk)_[A-Za-z0-9_]{16,}',
    '[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}'
  ]
$$;

create or replace function private.mask_pattern() returns text
language sql immutable set search_path = '' as $$
  select '(?i)' || array_to_string(private.mask_patterns(), '|')
$$;

revoke all on function private.credential_value_pattern(), private.numeric_pattern(), private.mask_patterns()
  from public, anon, authenticated, service_role;

-- All 9+ digit candidates are masked except a narrow timestamp window.
-- Only an unseparated 13-digit timestamp can reach the Luhn exception check.
create or replace function private.safe_timestamp(n text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  yy int; mm int; dd int; digit int; checksum int := 0;
begin
  if n !~ '^[0-9]{13}$'
    or left(n, 10) collate "C" not between '1577836800' and '2082758399' then return false; end if;
  for i in 1..13 loop
    digit := substr(n,i,1)::int * (1 + (i-1)%2);
    checksum := checksum + digit - case when digit > 9 then 9 else 0 end;
  end loop;
  if checksum % 10 = 0 then return false; end if;
  yy := 2000 + left(n,2)::int; mm := substr(n,3,2)::int; dd := substr(n,5,2)::int;
  if substr(n,7,1) not between '1' and '8' or mm not between 1 and 12 then return true; end if;
  return dd not between 1 and extract(day from make_date(yy,mm,1) + interval '1 month - 1 day');
end $$;

-- One-based character offsets, with an exclusive upper end.
create or replace function private.value_span(t text, pos int, key_escapes int) returns int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  i int := pos; n int := length(t); escapes int; slashes int := 0;
  q text; c text; body int; depth int := 0; quoted text := '';
begin
  while substr(t,i,1) = '\' loop i := i + 1; end loop;
  q := substr(t,i,1);
  if q in ('"', '''') then
    escapes := i - pos;
    body := i + 1;
    for j in body..n loop
      c := substr(t,j,1);
      if c = q and slashes % (2*(escapes+1)) = escapes then
        return int4range(body,j-escapes);
      end if;
      slashes := case when c = '\' then slashes+1 else 0 end;
    end loop;
    return int4range(body,n+1);
  elsif q in ('[', '{') then
    i := pos;
    while i <= n loop
      c := substr(t,i,1);
      if c in ('"', '''') and slashes % (2*(key_escapes+1)) = key_escapes and (quoted = '' or quoted = c) then
        quoted := case when quoted = '' then c else '' end;
      elsif quoted = '' and c = q then depth := depth+1;
      elsif quoted = '' and c = (case q when '[' then ']' else '}' end) then
        depth := depth-1;
        if depth = 0 then return int4range(pos,i+1); end if;
      end if;
      slashes := case when c = '\' then slashes+1 else 0 end;
      i := i+1;
    end loop;
    return int4range(pos,n+1);
  end if;
  i := regexp_instr(substr(t,pos) collate "C", $pat$(?i)^(?:(?:bearer|basic|token|apikey|digest)(?:[ \t]*:[ \t]*|[ \t]+)[^\s;&]+|(?:\[가림\]|\\[^"\s]|[^"'\\\s,;&#])(?:[^\s,;}\]&#]|[}\]]+[^\s,;}\]&#])*)$pat$,1,1,1);
  if i > 0 then return int4range(pos,pos+i-1); end if;
  return null;
end $$;

create or replace function private.mask_spans(t text, pattern text, kind text) returns setof int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  cursor_pos int := 1; first_pos int; after_pos int; span int4range;
  prefix text; tail text; plain_name boolean; header boolean; stop int;
begin
  loop
    first_pos := regexp_instr(t collate "C", pattern, cursor_pos);
    exit when first_pos = 0;
    after_pos := regexp_instr(t collate "C", pattern, cursor_pos,1,1);
    cursor_pos := after_pos;
    if kind = 'credential' then
      prefix := rtrim(substr(t,first_pos,after_pos-first_pos), E' \t\n\r\f\v');
      span := private.value_span(t,after_pos,length(prefix)-length(ltrim(prefix,'\')));
      tail := substr(t,after_pos);
      plain_name := left(prefix,1) not in ('\', '"', '''');
      header := plain_name and right(prefix,1) = ':';
      if lower(right(prefix,3)) = '%3a' then
        stop := after_pos + length(substring(tail from '^[^&\n]*'));
        span := int4range(after_pos,greatest(stop,upper(span)));
      elsif header or prefix collate "C" ~* '^(set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)\s*=$' or tail collate "C" ~* '^digest\s' or (plain_name and (right(prefix,2) in ('=>','->') or right(prefix,1) = ',')) then
        stop := after_pos + length(split_part(tail,E'\n',1));
        span := int4range(case when header then first_pos else after_pos end, greatest(stop,upper(span)));
      elsif plain_name and left(tail,1) not in ('\', '"', '''', '[', '{') then
        stop := after_pos + length(substring(tail collate "C" from '^[^\s&;]*'));
        span := int4range(after_pos,greatest(stop,upper(span)));
      end if;
      if span is not null and not isempty(span) then
        cursor_pos := greatest(after_pos, upper(span));
        return next span;
      end if;
    elsif kind = 'line_value' then
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
  t text := private.normalize_text(left(s,2000)); result text := ''; cursor_pos int := 1; span int4range;
begin
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
  for span in select r from (
    select r from private.mask_spans(t, private.credential_value_pattern(), 'credential') r
    union all select r from private.mask_spans(t,
      '(?i)(?<![A-Za-z0-9_])(?:set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)[ \t]*=(?!>)', 'line_value') r
    union all select r from unnest(private.mask_patterns()) p,
      private.mask_spans(t, '(?i)' || p, 'private') r
    union all select r from private.mask_spans(t, private.numeric_pattern(), 'number') r
  ) ranges where not isempty(r) order by lower(r) loop
    if lower(span) >= cursor_pos then
      result := result || substr(t,cursor_pos,lower(span)-cursor_pos) || '[가림]';
    end if;
    cursor_pos := greatest(cursor_pos,upper(span));
  end loop;
  result := regexp_replace(result || substr(t,cursor_pos), $q$(?n)^\?[^\n]+|\?\S+$q$, '?[가림]', 'g');
  if truncated then return left(result,295) || '…[잘림]'; end if;
  return left(result,300);
end $$;

revoke all on function private.safe_timestamp(text), private.value_span(text,int,int),
  private.mask_spans(text,text,text) from public, anon, authenticated, service_role;

-- Route identifiers still include mixed segments containing a long numeric run.
create or replace function private.route(path text) returns text
language sql immutable strict set search_path = '' as $$
  with segments as (
    select pos, split_part(segment, ';', 1) as part
    from unnest(string_to_array(split_part(split_part(private.normalize_text(path), '?', 1), '#', 1), '/'))
      with ordinality as pieces(segment, pos)
  )
  select coalesce(string_agg(case when
    part ~ '^[0-9]+$' or part ~ '[0-9]{9}'
    or (part ~* '^(urn:uuid:|\{)?[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$'
        and (left(part, 1) = '{') = (right(part, 1) = '}'))
    or part ~ private.mask_pattern() or part ~ private.credential_value_pattern()
    or part ~ private.numeric_pattern()
    or (length(part) >= 16 and part ~ '^[A-Za-z0-9_-]+={0,2}$'
        and (right(part,1) = '=' or part ~* '^[a-z0-9]+$' or part ~ '[0-9]'
             or (part ~ '[A-Z]' and part ~ '[a-z]')))
    then ':id' else part end, '/' order by pos), '')
  from segments
$$;
