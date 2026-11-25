create or replace function private.mask_pattern() returns text
language sql immutable set search_path = '' as $$
  select '(?i)(?<![A-Za-z0-9_])(?:set-cookie|cookie)[ \t]*:[^\r\n]*'
    || '|(?<![A-Za-z0-9_])bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+'
    || '|(?<![A-Za-z0-9_])basic[ \t]+(?:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})'
    || '|(?<![A-Za-z0-9_])(?:access_token|token|key|password)=[^&\s,;#]+'
    || '|(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?<![A-Za-z0-9_])eyJ)[a-z0-9_.=-]+'
    || '|(?<![A-Za-z0-9])(?:sk|pk|rk)_[A-Za-z0-9_]{16,}'
    || '|[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}'
    || '|(?<![0-9])\+?\d(?:[ ().-]*\d){8,14}(?![0-9])'
$$;
