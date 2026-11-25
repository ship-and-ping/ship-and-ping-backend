create function public.issue_key(app_id uuid,kind text) returns text
language plpgsql security definer set search_path='' as $$
declare raw_key text;
begin
  perform 1 from public.apps a where a.id=$1 and a.owner_id=auth.uid() for update;
  if not found then raise exception 'app unavailable' using errcode='42501'; end if;
  if $2 is null or $2 not in ('pub','srv') then raise exception 'invalid key kind' using errcode='22023'; end if;
  raw_key := 'sp_' || $2 || '_' || encode(extensions.gen_random_bytes(32),'hex');
  update public.app_keys k set expires_at=now()+interval '24 hours'
    where k.app_id=$1 and k.kind=$2 and k.revoked_at is null and k.expires_at is null;
  insert into public.app_keys(app_id,kind,prefix,key_hash)
    values($1,$2,left(raw_key,8),encode(sha256(convert_to(raw_key,'UTF8')),'hex'));
  return raw_key;
end $$;

create function private.lock_key(hash text) returns public.app_keys language plpgsql set search_path='' as $$
declare k public.app_keys;
begin
  -- Serialize rotation, feature registration, sample pruning and duplicate batches per app.
  perform 1 from public.apps a join public.app_keys k0 on k0.app_id=a.id where k0.key_hash=hash for update of a;
  select * into k from public.app_keys where key_hash=hash and revoked_at is null
    and (expires_at is null or expires_at>clock_timestamp()) for share;
  if not found then raise exception 'invalid app key' using errcode='PT401'; end if;
  return k;
end $$;

create function private.mask(s text) returns text language sql immutable strict set search_path='' as $$
 select left(regexp_replace(s,'Bearer[[:space:]]+[^[:space:],;]+|sk_[[:alnum:]_.-]+|eyJ[[:alnum:]_.=-]+|[[:alnum:]._+%-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|\+?[0-9]([ ().-]*[0-9]){8,14}','[가림]','gi'),300)
$$;
create function private.route(path text) returns text language sql immutable strict set search_path='' as $$
 select string_agg(case when part ~* '^([0-9]+|[a-z0-9]{16,}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'
    then ':id' else private.mask(part) end,'/' order by pos)
 from unnest(string_to_array(split_part(split_part(path,'?',1),'#',1),'/')) with ordinality as p(part,pos)
$$;

create function private.auto_feature(app uuid,verb text,path text) returns uuid language plpgsql set search_path='' as $$
declare feature uuid;
begin
  path := private.route(path);
  if verb !~ '^[A-Z-]{1,32}$' or path not like '/%' then raise exception 'invalid route' using errcode='22023'; end if;
  select id into feature from public.features where app_id=app and method=verb and route=path;
  if found then return feature; end if;
  if (select count(*) from public.features where app_id=app and kind='auto' and method <> '*') >= 200 then
    verb := '*'; path := '*';
  end if;
  insert into public.features(app_id,kind,method,route,name)
    values(app,'auto',verb,path,case when verb='*' then '기타' else '이름 없는 기능' end)
    on conflict(app_id,method,route) do nothing returning id into feature;
  if feature is null then
    select id into feature from public.features where app_id=app and method=verb and route=path;
  end if;
  return feature;
end $$;
create function private.add_hist(a integer[],b integer[]) returns integer[] language sql immutable strict set search_path='' as $$
 select array(select a[i]+b[i] from generate_series(1,16) i order by i)
$$;
create aggregate private.sum_hist(integer[]) (sfunc=private.add_hist,stype=integer[]);

create function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  k public.app_keys := private.lock_key(app_key_hash);
  version_name text := payload->>'app_version';
  feature uuid;
  accepted integer := 0;
  dropped integer := 0;
  item jsonb;
  stamp timestamptz;
  result_event boolean;
  sampled_features uuid[] := '{}';
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload ? 'app_id' or payload ? 'records'
    or coalesce(length(trim(version_name)),0) not between 1 and 64 then
    raise exception 'invalid aggregate envelope' using errcode='22023';
  end if;
  insert into public.ingest_batches(app_id,batch_id) values(k.app_id,(payload->>'batch_id')::uuid)
    on conflict do nothing;
  if not found then return jsonb_build_object('accepted',0,'dropped',0); end if;
  insert into public.app_versions(app_id,version) values(k.app_id,version_name)
    on conflict(app_id,version) do update set last_seen_at=greatest(public.app_versions.last_seen_at,excluded.last_seen_at);

  for item in select value from jsonb_array_elements(payload->'stats') loop
    feature := private.auto_feature(k.app_id,item->>'method',item->>'route');
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
    if (item->>'type') is null or item->>'type' not in ('attempt_start','attempt_result') or
      (result_event and (coalesce(item->>'source','') not in ('server','browser')
      or coalesce(item->>'result','') not in ('success','failure','abandon')
      or (item->>'source'='server' and k.kind <> 'srv'))) then
      raise exception 'invalid attempt' using errcode='22023';
    end if;
    select id into feature from public.features where app_id=k.app_id and feature_key=item->>'feature_key';
    if not found then dropped := dropped+1; continue; end if;
    stamp := (item->>'ts')::timestamptz;
    insert into public.attempts as a(app_id,attempt_id,feature_id,version,started_at,ended_at,status,source,step,error_kind)
      values(k.app_id,(item->>'attempt_id')::uuid,feature,version_name,case when not result_event then stamp end,
        case when result_event then stamp end,case when result_event then item->>'result' else 'pending' end,
        case when result_event then item->>'source' end,case when result_event then private.mask(item->>'step') end,
        case when result_event then private.mask(item->>'error_kind') end)
      on conflict(app_id,attempt_id) do update set
        started_at=coalesce(a.started_at,excluded.started_at), ended_at=coalesce(a.ended_at,excluded.ended_at),
        status=case when result_event then excluded.status else a.status end,
        source=coalesce(a.source,excluded.source),step=coalesce(a.step,excluded.step),error_kind=coalesce(a.error_kind,excluded.error_kind),
        duration_ms=greatest(0,extract(epoch from (coalesce(a.ended_at,excluded.ended_at)-coalesce(a.started_at,excluded.started_at)))*1000)::integer
      where a.feature_id=excluded.feature_id and ((result_event and a.ended_at is null) or (not result_event and a.started_at is null));
    if not found then dropped := dropped+1; continue; end if;
    if result_event and item->>'error_message' is not null then
      insert into public.error_samples(app_id,feature_id,version,at,error_kind,message)
        values(k.app_id,feature,version_name,stamp,private.mask(item->>'error_kind'),private.mask(item->>'error_message'));
      sampled_features := array_append(sampled_features,feature);
    end if;
    accepted := accepted+1;
  end loop;
  for item in select value from jsonb_array_elements(payload->'error_samples') loop
    feature := private.auto_feature(k.app_id,item->>'method',item->>'route');
    insert into public.error_samples(app_id,feature_id,version,at,error_kind,message)
      values(k.app_id,feature,version_name,(item->>'at')::timestamptz,private.mask(item->>'error_kind'),private.mask(item->>'message'));
    sampled_features := array_append(sampled_features,feature);
  end loop;
  delete from public.error_samples where id in (
    select id from (select id,row_number() over(partition by feature_id order by at desc,id desc) as position
      from public.error_samples where feature_id=any(sampled_features) and version=version_name) ranked where position>20);
  if accepted>0 then update public.apps set first_record_at=now() where id=k.app_id and first_record_at is null; end if;
  return jsonb_build_object('accepted',accepted,'dropped',dropped);
end $$;

create function public.suggest_feature_map(app_key_hash text,items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare k public.app_keys := private.lock_key(app_key_hash);
  item jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>200 then
    raise exception 'invalid feature map' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(items) loop
    insert into public.feature_map_suggestions(app_id,method,route,name)
      values(k.app_id,item->>'method',private.route(item->>'route'),private.mask(item->>'name'))
      on conflict(app_id,method,route) do update set name=excluded.name,received_at=now(),applied=false;
  end loop;
end $$;
revoke all on function public.issue_key(uuid,text), public.ingest_batch(text,jsonb), public.suggest_feature_map(text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.issue_key(uuid,text) to authenticated;
grant execute on function public.ingest_batch(text,jsonb),public.suggest_feature_map(text,jsonb) to service_role;
