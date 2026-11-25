create or replace function private.mask(s text) returns text language sql immutable strict set search_path='' as $$
 select left(regexp_replace(s,
   'Bearer[[:space:]]+[^[:space:],;]+|(sp_(srv|pub)|sb_(secret|publishable))_[a-z0-9_.=+-]*|(?:^|(?<=[^A-Za-z0-9]))(sk|pk|rk)_[A-Za-z0-9_]{16,}[a-z0-9_.=+-]*|eyJ[[:alnum:]_.=-]+|[[:alnum:]._+%-]+(@|%40)[[:alnum:].-]+\.[[:alpha:]]{2,}|\m((access_|refresh_|id_)?token|(api[_-]?)?key)=[^&#[:space:]]+|\+?[0-9]([ ().-]*[0-9]){8,14}',
   '[가림]','gi'),300)
$$;
