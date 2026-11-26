create or replace function private.mask_pattern() returns text
language sql immutable set search_path = '' as $$
  select '(?i)(?<![A-Za-z0-9_])(?:set-cookie|cookie)[ \t]*:[^\r\n]*'
    || '|(?<![A-Za-z0-9_])bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+'
    || '|(?<![A-Za-z0-9_])basic[ \t]+(?:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})'
    || '|(?<![A-Za-z0-9_-])([A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd)[ \t]*[=:][ \t]*)(?:bearer(?:[ \t]*:[ \t]*|[ \t]+))?[^&\s,;#]+'
    || $quoted$|(["'][A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd)["']\s*:\s*)(?:(")(?:\\.|[^"\\])*"|(')(?:\\.|[^'\\])*')$quoted$
    || '|(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?<![A-Za-z0-9_])eyJ)[a-z0-9_.=-]+'
    || '|(?<![A-Za-z0-9])(?:sk|pk|rk)_[A-Za-z0-9_]{16,}'
    || '|[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}'
    || '|(?<![0-9])(?:\+82[ .-]?(?:\(0\)[ .-]?|0)?|\(?0)(?:2|1[016789]|[3-6][1-5]|70|80|50[2-8]?)\)?[ .-]?[0-9]{3,4}[ .-]?[0-9]{4}(?![0-9])'
$$;

-- Preserve parameter names, separators and the original value quotes.
create or replace function private.mask(s text) returns text
language sql immutable strict set search_path = '' as $$
  select left(regexp_replace(private.normalize_text(s), private.mask_pattern(), '\1\2\3\4[가림]\3\4', 'g'), 300)
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
    or part ~ private.mask_pattern()
    or (length(part) >= 16 and part ~ '^[A-Za-z0-9_-]+={0,2}$'
        and (right(part,1) = '=' or part ~* '^[a-f0-9]+$' or part ~ '[0-9]'
             or (part ~ '[A-Z]' and part ~ '[a-z]')))
    then ':id' else part end, '/' order by pos), '')
  from segments
$$;
