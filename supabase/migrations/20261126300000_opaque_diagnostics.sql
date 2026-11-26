create or replace function private.opaque_segment(part text) returns boolean
language sql immutable strict set search_path = '' as $$
  select part ~ '[0-9]{9}' or (length(part) >= 16 and part ~ '^[A-Za-z0-9_-]+={0,2}$'
        and (right(part,1) = '=' or part ~* '^[a-z0-9]+$' or part ~ '[0-9]'
             or (part ~ '[A-Z]' and part ~ '[a-z]')))
$$;
revoke all on function private.opaque_segment(text) from public, anon, authenticated, service_role;

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
    or part ~ private.mask_pattern() or part ~ private.credential_value_pattern()
    or part ~ private.numeric_pattern()
    or private.opaque_segment(part)
    then ':id' else part end, '/' order by pos), '')
  from segments
$$;

create or replace function private.opaque_diagnostic(raw text) returns boolean
language sql immutable strict set search_path = '' as $$
  select raw collate "C" ~ '(?:^|[._ -])(?:(?:gh[pos]_|AKIA|ASIA|AIza)[A-Za-z0-9_-]{12}|github_pat_[A-Za-z0-9_-]{5}|xox[abpr]-[A-Za-z0-9_-]{11}|sk-[A-Za-z0-9_-]{13}|glpat-[A-Za-z0-9_-]{10})'
    or exists (select from regexp_split_to_table(raw collate "C", '[._ -]') parts(part)
      where length(part) >= 16 and (part ~ '[0-9]' or
        (part ~ '[A-Z]' and part ~ '[a-z]' and
          (part !~ '^[a-z]*([A-Z]+[a-z]+)+[A-Z]*$' or part ~ '(?:[A-Z][a-z]){3}'))))
$$;
revoke all on function private.opaque_diagnostic(text) from public, anon, authenticated, service_role;

create or replace function private.error_name(raw text) returns text
language sql immutable strict set search_path = '' as $$
  with token as (select substring(raw collate "C" from E'^[^: \\t\\n\\r]+') as name)
  select name from token where length(name) <= 60
    and name collate "C" ~ '^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$'
    and name ~ '(Error|Exception|Fault)$' and not private.opaque_diagnostic(name) and private.mask(name) = name
$$;
create or replace function private.error_kind(raw text) returns text
language sql immutable strict set search_path = '' as $$
  select raw where raw collate "C" ~ '^[A-Za-z0-9_.-]{1,80}$'
    and raw !~ '[0-9]{4}' and not private.opaque_diagnostic(raw) and private.mask(raw) = raw
$$;
create or replace function private.step_name(raw text) returns text
language sql immutable strict set search_path = '' as $$
  select raw where btrim(raw) <> '' and (position(' ' in raw) = 0 or raw collate "C" ~ '[가-힣]') and raw collate "C" ~ '^[A-Za-z0-9_.가-힣 -]{1,40}$'
    and raw !~ '[0-9]{3}' and not private.opaque_diagnostic(raw) and private.mask(raw) = raw
$$;
create function private.backfill_opaque_diagnostics() returns void
language sql set search_path = '' as $$
update public.error_samples
set error_kind = case when not private.opaque_diagnostic(error_kind) then error_kind end,
    message = case when not private.opaque_diagnostic(message) then message end
where private.opaque_diagnostic(error_kind) or private.opaque_diagnostic(message);

update public.attempts
set error_kind = case when not private.opaque_diagnostic(error_kind) then error_kind end,
    step = case when not private.opaque_diagnostic(step) then step end
where private.opaque_diagnostic(error_kind) or private.opaque_diagnostic(step);
$$;
revoke all on function private.backfill_opaque_diagnostics() from public, anon, authenticated, service_role;
select private.backfill_opaque_diagnostics();
