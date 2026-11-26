create or replace function private.credential_value_pattern() returns text
language sql immutable set search_path = '' as $$
  select $pat$(?i)((?:\\?["'])?[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd)(?:\\?["'])?\s*(?:=>|:|=)\s*)(?:(\\")(?:\\\\.|\\[^"\\]|[^\\])*(\\"|$)|(")(?:\\.|[^"\\])*("|\\?$)|(')(?:\\.|[^'\\])*('|\\?$)|(?:(?:bearer|basic)(?:[ \t]*:[ \t]*|[ \t]+))?[^"'\\\s,;}\]&#][^\s,;}\]&#]*)$pat$
$$;

create or replace function private.numeric_pattern() returns text
language sql immutable set search_path = '' as $$
  select '\+?\(?[0-9](?:[ ().-]*[0-9]){8,}\)?'
$$;

create or replace function private.mask_pattern() returns text
language sql immutable set search_path = '' as $$
  select '(?i)(?<![A-Za-z0-9_])(?:set-cookie|cookie)[ \t]*:[^\r\n]*'
    || '|(?<![A-Za-z0-9_])bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"'']+'
    || '|(?<![A-Za-z0-9_])basic[ \t]+(?:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})'
    || '|(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?<![A-Za-z0-9_])eyJ)[a-z0-9_.=-]+'
    || '|(?<![A-Za-z0-9])(?:sk|pk|rk)_[A-Za-z0-9_]{16,}'
    || '|[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}'
$$;

revoke all on function private.credential_value_pattern(), private.numeric_pattern()
  from public, anon, authenticated, service_role;

-- Preserve parameter names, separators and the original value quotes.
create or replace function private.mask(s text) returns text
language sql immutable strict set search_path = '' as $$
  with credentials as (
    select regexp_replace(private.normalize_text(s), private.credential_value_pattern(),
                     '\1\2\4\6[가림]\3\5\7', 'g') as value
  ), tokens as (
    select m[1] as number, m[2] as other, pos from credentials,
      regexp_matches(regexp_replace(value, private.mask_pattern(), '[가림]', 'g'),
        '(' || private.numeric_pattern() || ')|([^+()0-9]+|[0-9]+|.)', 'g')
      with ordinality as parts(m, pos)
  )
  select left(coalesce(string_agg(case
    when number is null then other
    when number ~ '^(?:[0-9]{10}|[0-9]{13})$'
      and left(number, 10) collate "C" between '1000000000' and '2147483647' then number
    else '[가림]' end, '' order by pos), ''), 300) from tokens
$$;

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
