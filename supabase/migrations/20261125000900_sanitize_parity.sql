create function private.normalize_text(s text) returns text
language sql immutable strict set search_path = '' as $$
  select translate(
    regexp_replace(normalize(s, NFKC),
      U&'[\00ad\061c\200b-\200f\202a-\202e\2060-\2064\2066-\2069\feff]', '', 'g'),
    U&'\000d\000b\000c\0085\2028\2029', repeat(chr(10), 6))
$$;

-- Shared by text replacement and the whole-segment route privacy check.
create function private.mask_pattern() returns text
language sql immutable set search_path = '' as $$
  select '(?i)\m(?:set-cookie|cookie)[ \t]*:[^\r\n]*'
    || '|\mbearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+'
    || '|\mbasic[ \t]+(?:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})'
    || '|\m(?:access_token|token|key|password)=[^&\s,;#]+'
    || '|(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|\meyJ)[a-z0-9_.=-]+'
    || '|(?<![A-Za-z0-9])(?:sk|pk|rk)_[A-Za-z0-9_]{16,}'
    || '|[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}'
    || '|\+?\m\d(?:[ ().-]*\d){8,14}\M'
$$;

revoke all on function private.normalize_text(text), private.mask_pattern()
  from public, anon, authenticated, service_role;

create or replace function private.mask(s text) returns text
language sql immutable strict set search_path = '' as $$
  select left(regexp_replace(private.normalize_text(s), private.mask_pattern(), '[가림]', 'g'), 300)
$$;

create or replace function private.route(path text) returns text
language sql immutable strict set search_path = '' as $$
  with segments as (
    select pos, split_part(segment, ';', 1) as part
    from unnest(string_to_array(split_part(split_part(private.normalize_text(path), '?', 1), '#', 1), '/'))
      with ordinality as pieces(segment, pos)
  )
  select coalesce(string_agg(case when
    part ~ '^[0-9]+$'
    or (part ~* '^(urn:uuid:|\{)?[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$'
        and (left(part, 1) = '{') = (right(part, 1) = '}'))
    or part ~ private.mask_pattern()
    or (length(part) >= 16 and part ~ '^[A-Za-z0-9_-]+={0,2}$'
        and (right(part,1) = '=' or part ~* '^[a-f0-9]+$' or part ~ '[0-9]'
             or (part ~ '[A-Z]' and part ~ '[a-z]')))
    then ':id' else part end, '/' order by pos), '')
  from segments
$$;
