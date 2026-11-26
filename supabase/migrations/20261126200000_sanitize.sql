create or replace function private.credential_value_pattern() returns text
language sql immutable set search_path = '' as $$
  select $pat$[/%]+\s*=>?\s*|(?:\\*"[^"\n]*\\*"|\\*'[^'\n]*\\*'|[^\s/\\%"'=:,;<>{}\[\]&?#]+)\s*(?:=>|->|,|:|=|%3[aAdD])\s*$pat$
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

create function private.assignment_spans(t text) returns setof int4range
language plpgsql immutable strict set search_path = '' as $$
declare
  rest text; next_pair int; pos int := 1; a int; b int; stop int; prefix text; tail text; k text;
  plain boolean; header boolean; span int4range;
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
    span := private.value_span(t,b,length(prefix)-length(ltrim(prefix,'\')));
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
      return next span;
    end if;
  end loop;
end $$;
revoke all on function private.assignment_spans(text) from public, anon, authenticated, service_role;

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
  t text := private.normalize_text(left(s,2000)); result text := ''; cursor_pos int := 1; span int4range;
begin
  truncated := truncated or length(t)>2000;
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
  for span in select r from (
    select r from private.assignment_spans(t) r
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

create function private.error_name(raw text) returns text
language sql immutable strict set search_path = '' as $$
  with token as (select substring(raw collate "C" from E'^[^: \\t\\n\\r]+') as name)
  select name from token where length(name) <= 60
    and name collate "C" ~ '^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$'
    and name ~ '(Error|Exception|Fault)$' and private.mask(name) = name
$$;
create function private.error_kind(raw text) returns text
language sql immutable strict set search_path = '' as $$
  select raw where raw collate "C" ~ '^[A-Za-z0-9_.-]{1,80}$'
    and raw !~ '[0-9]{4}' and private.mask(raw) = raw
$$;
create function private.step_name(raw text) returns text
language sql immutable strict set search_path = '' as $$
  select raw where btrim(raw) <> '' and (position(' ' in raw) = 0 or raw collate "C" ~ '[가-힣]') and raw collate "C" ~ '^[A-Za-z0-9_.가-힣 -]{1,40}$'
    and raw !~ '[0-9]{3}' and private.mask(raw) = raw
$$;
revoke all on function private.error_name(text), private.error_kind(text), private.step_name(text)
  from public, anon, authenticated, service_role;

update public.error_samples set error_kind = private.error_kind(error_kind), message = private.error_name(message);
update public.attempts set error_kind = private.error_kind(error_kind), step = private.step_name(step);

create or replace function private.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  k public.app_keys := private.lock_key(app_key_hash);
  version_name text := trim(payload->>'app_version');
  feature uuid;
  accepted integer := 0;
  dropped integer := 0;
  item jsonb;
  stamp timestamptz;
  result_event boolean;
  sampled_features uuid[] := '{}';
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload ? 'app_id' or payload ? 'records'
    or not (payload ?| array['stats','attempts','error_samples'])
    or jsonb_typeof(payload->'batch_id') is distinct from 'string'
    or jsonb_typeof(payload->'app_version') is distinct from 'string'
    or length(version_name) not between 1 and 64 then
    raise exception 'invalid aggregate envelope' using errcode='22023';
  end if;
  insert into public.ingest_batches(app_id,batch_id) values(k.app_id,(payload->>'batch_id')::uuid)
    on conflict do nothing;
  if not found then return jsonb_build_object('accepted',0,'dropped',0); end if;
  insert into public.app_versions(app_id,version) values(k.app_id,version_name)
    on conflict(app_id,version) do update set last_seen_at=greatest(public.app_versions.last_seen_at,excluded.last_seen_at);

  for item in select value from jsonb_array_elements(payload->'stats') loop
    if jsonb_typeof(item->'method') is distinct from 'string' or jsonb_typeof(item->'route') is distinct from 'string'
      or jsonb_typeof(item->'bucket') is distinct from 'string' or jsonb_typeof(item->'hist') is distinct from 'array'
      or exists (select from unnest(array['total','failures','client_errors','duration_sum_ms']) field
                 where jsonb_typeof(item->field) is distinct from 'number') then
      raise exception 'invalid aggregate fields' using errcode='22023';
    end if;
    if exists (select from jsonb_array_elements(item->'hist') bin where jsonb_typeof(bin)<>'number') then
      raise exception 'invalid histogram bin' using errcode='22023';
    end if;
    feature := private.resolve_auto(k.app_id,item->>'method',item->>'route',true);
    insert into public.stats_5m as s(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
      values(k.app_id,feature,version_name,(item->>'bucket')::timestamptz,(item->>'total')::integer,
        (item->>'failures')::integer,(item->>'client_errors')::integer,(item->>'duration_sum_ms')::bigint,
        array(select jsonb_array_elements_text(item->'hist')::integer))
      on conflict(app_id,feature_id,version,bucket) do update set
        total=s.total+excluded.total, failures=s.failures+excluded.failures, client_errors=s.client_errors+excluded.client_errors,
        duration_sum_ms=s.duration_sum_ms+excluded.duration_sum_ms, hist=private.add_hist(s.hist,excluded.hist);
    accepted := accepted+(item->>'total')::integer;
  end loop;
  for item in select value from jsonb_array_elements(payload->'attempts') loop
    result_event := item->>'type'='attempt_result';
    if jsonb_typeof(item->'feature_key') is distinct from 'string' or trim(item->>'feature_key')=''
      or jsonb_typeof(item->'attempt_id') is distinct from 'string' or jsonb_typeof(item->'ts') is distinct from 'string'
      or (item->>'type') is null or item->>'type' not in ('attempt_start','attempt_result') or
      (result_event and (coalesce(item->>'source','') not in ('server','browser')
      or coalesce(item->>'result','') not in ('success','failure','abandon')
      or (item->>'source'='server' and k.kind <> 'srv'))) then
      raise exception 'invalid attempt' using errcode='22023';
    end if;
    select id into feature from public.features where app_id=k.app_id and kind='deep' and feature_key=item->>'feature_key';
    if not found then dropped := dropped+1; continue; end if;
    stamp := (item->>'ts')::timestamptz;
    insert into public.attempts as a(app_id,attempt_id,feature_id,version,started_at,ended_at,status,source,step,error_kind)
      values(k.app_id,(item->>'attempt_id')::uuid,feature,version_name,case when not result_event then stamp end,
        case when result_event then stamp end,case when result_event then item->>'result' else 'pending' end,
        case when result_event then item->>'source' end,case when result_event then private.step_name(item->>'step') end,
        case when result_event then private.error_kind(item->>'error_kind') end)
      on conflict(app_id,attempt_id) do update set
        started_at=coalesce(a.started_at,excluded.started_at), ended_at=coalesce(a.ended_at,excluded.ended_at),
        status=case when result_event then excluded.status else a.status end,
        source=coalesce(a.source,excluded.source),step=coalesce(a.step,excluded.step),error_kind=coalesce(a.error_kind,excluded.error_kind),
        duration_ms=greatest(0,extract(epoch from (coalesce(a.ended_at,excluded.ended_at)-coalesce(a.started_at,excluded.started_at)))*1000)::integer
      where a.feature_id=excluded.feature_id
        and ((result_event and a.ended_at is null) or (not result_event and a.started_at is null));
    if not found then dropped := dropped+1; continue; end if;
    if result_event and (item->>'error_message' is not null or item->>'error_kind' is not null) then
      insert into public.error_samples(app_id,feature_id,version,at,error_kind,message)
        values(k.app_id,feature,version_name,stamp,private.error_kind(item->>'error_kind'),private.error_name(item->>'error_message'));
      sampled_features := array_append(sampled_features,feature);
    end if;
    accepted := accepted+1;
  end loop;
  for item in select value from jsonb_array_elements(payload->'error_samples') loop
    feature := private.resolve_auto(k.app_id,item->>'method',item->>'route',true);
    insert into public.error_samples(app_id,feature_id,version,at,error_kind,message)
      values(k.app_id,feature,version_name,(item->>'at')::timestamptz,private.error_kind(item->>'error_kind'),private.error_name(item->>'message'));
    sampled_features := array_append(sampled_features,feature);
  end loop;
  delete from public.error_samples where id in (
    select id from (select id,row_number() over(partition by feature_id order by at desc,id desc) as position
      from public.error_samples where feature_id=any(sampled_features) and version=version_name) ranked where position>20);
  if accepted>0 then update public.apps set first_record_at=now() where id=k.app_id and first_record_at is null; end if;
  return jsonb_build_object('accepted',accepted,'dropped',dropped);
end $$;
