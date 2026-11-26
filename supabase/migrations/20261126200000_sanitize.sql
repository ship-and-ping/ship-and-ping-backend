create or replace function private.credential_value_pattern() returns text
language sql immutable set search_path = '' as $$
  select format($pat$(?i)(?:\\*["']%1$s\\*["']|(?<![a-z0-9_])%1$s)\s*(?:=>|:|=|%%3d)\s*$pat$,
    '(?:[a-z0-9_-]*(?:token|secret|password|passwd|pwd|apikey)[a-z0-9_-]*|(?:[a-z0-9_-]+[_-])?keys?(?:[_-][a-z0-9_-]+)?)')
$$;

create or replace function private.numeric_pattern() returns text
language sql immutable set search_path = '' as $$
  select '\+?\(?[0-9](?:[ ()./_\t֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭−-]*[0-9]){8,}\)?'
$$;

create or replace function private.mask_patterns() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    '(?<![A-Za-z0-9_])(?:set-cookie|cookie)[ \t]*:[^\r\n]*',
    '(?<![A-Za-z0-9_])authorization[ \t]*:[ \t]*token[ \t]+[^\s,;&#"'']+',
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
  if n !~ '^(?:[0-9]{10}|[0-9]{13})$'
    or left(n, 10) collate "C" not between '1577836800' and '2082758399' then return false; end if;
  if length(n) = 10 then return true; end if;
  for i in 1..13 loop
    digit := substr(n,i,1)::int * (1 + (i-1)%2);
    checksum := checksum + digit - case when digit > 9 then 9 else 0 end;
  end loop;
  if checksum % 10 = 0 then return false; end if;
  yy := 2000 + left(n,2)::int; mm := substr(n,3,2)::int; dd := substr(n,5,2)::int;
  if substr(n,7,1) not between '1' and '4' or mm not between 1 and 12 then return true; end if;
  return dd not between 1 and extract(day from make_date(yy,mm,1) + interval '1 month - 1 day');
end $$;

-- One-based character offsets, with an exclusive upper end.
create or replace function private.value_span(t text, pos int) returns int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  i int := pos; n int := length(t); escapes int; slashes int := 0;
  q text; c text; body int; depth int := 0; quoted boolean := false;
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
  elsif substr(t,pos,1) = '[' then
    i := pos;
    while i <= n loop
      c := substr(t,i,1);
      if quoted and c = '\' then i := i+1;
      elsif c = '"' then quoted := not quoted;
      elsif not quoted and c = '[' then depth := depth+1;
      elsif not quoted and c = ']' then
        depth := depth-1;
        if depth = 0 then return int4range(pos,i+1); end if;
      end if;
      i := i+1;
    end loop;
    return int4range(pos,n+1);
  end if;
  i := regexp_instr(substr(t,pos) collate "C", $pat$(?i)^(?:(?:bearer|basic)(?:[ \t]*:[ \t]*|[ \t]+))?(?:\[가림\]|\\[^"\s]|[^"'\\\s,;&#])(?:[^\s,;}\]&#]|[}\]]+[^\s,;}\]&#])*$pat$,1,1,1);
  if i > 0 then return int4range(pos,pos+i-1); end if;
  return null;
end $$;

create or replace function private.mask_spans(t text, pattern text, kind text) returns setof int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  cursor_pos int := 1; first_pos int; after_pos int; span int4range;
begin
  loop
    first_pos := regexp_instr(t collate "C", pattern, cursor_pos);
    exit when first_pos = 0;
    after_pos := regexp_instr(t collate "C", pattern, cursor_pos,1,1);
    cursor_pos := after_pos;
    if kind = 'credential' then
      span := private.value_span(t,after_pos);
      if span is not null then return next span; end if;
    elsif kind <> 'number' or not private.safe_timestamp(substr(t,first_pos,after_pos-first_pos)) then
      return next int4range(first_pos,after_pos);
    end if;
  end loop;
end $$;

create or replace function private.mask(s text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare
  t text := private.normalize_text(s); result text := ''; cursor_pos int := 1; span int4range;
begin
  for span in select r from (
    select r from private.mask_spans(t, private.credential_value_pattern(), 'credential') r
    union all select r from unnest(private.mask_patterns()) p,
      private.mask_spans(t, '(?i)' || p, 'private') r
    union all select r from private.mask_spans(t, private.numeric_pattern(), 'number') r
  ) ranges where not isempty(r) order by lower(r) loop
    if lower(span) >= cursor_pos then
      result := result || substr(t,cursor_pos,lower(span)-cursor_pos) || '[가림]';
    end if;
    cursor_pos := greatest(cursor_pos,upper(span));
  end loop;
  return left(result || substr(t,cursor_pos),300);
end $$;

revoke all on function private.safe_timestamp(text), private.value_span(text,int),
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
        and (right(part,1) = '=' or part ~* '^[a-f0-9]+$' or part ~ '[0-9]'
             or (part ~ '[A-Z]' and part ~ '[a-z]')))
    then ':id' else part end, '/' order by pos), '')
  from segments
$$;
