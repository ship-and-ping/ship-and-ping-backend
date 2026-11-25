create table private.settings (
  singleton boolean primary key default true check(singleton),
  active_feature_limit integer not null check(active_feature_limit>0),
  size_alert_bytes bigint not null check(size_alert_bytes>0)
);
insert into private.settings values(true,100,300000000);

alter table public.features add column last_record_at timestamptz;
-- Remember the original key when a deep attempt is grouped into 기타. Its
-- start and result must agree on the key even when beta capacity changes.
alter table public.attempts add column overflow_source_id uuid;
-- Historical batches lack per-feature receipt times. Use the newest retained evidence.
update public.features f set last_record_at=greatest(
  (select max(bucket) from public.stats_5m where feature_id=f.id),
  (select max(received_at) from private.latest_results where feature_id=f.id),
  (select max(greatest(started_at,result_received_at,ended_at)) from public.attempts where feature_id=f.id),
  (select max(at) from public.error_samples where app_id=f.app_id and feature_id=f.id)
) where f.method is distinct from '*';
create index features_last_record on public.features(last_record_at)
 where method is distinct from '*' and last_record_at is not null;

create function private.active_feature_count() returns bigint language sql stable set search_path='' as $$
  select count(*) from public.features where method is distinct from '*' and last_record_at>=now()-interval '7 days'
$$;
create function private.beta_has_room() returns boolean language plpgsql set search_path='' as $$
declare slot_limit integer;
begin
  -- All admissions take the same transaction lock after the per-app lock.
  select active_feature_limit into strict slot_limit from private.settings for update;
  return private.active_feature_count()<slot_limit;
end $$;
create function private.feature_admitted(feature uuid) returns boolean language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.features where id=feature and last_record_at>=now()-interval '7 days') then
    return true;
  end if;
  return private.beta_has_room();
end $$;
create function private.overflow_feature(app uuid) returns uuid language plpgsql set search_path='' as $$
declare feature uuid;
begin
  select id into feature from public.features where app_id=app and method='*';
  if not found then
    insert into public.features(app_id,kind,method,route,name) values(app,'auto','*','*','기타')
      returning id into feature;
  end if;
  return feature;
end $$;

alter function private.auto_feature(uuid,text,text) rename to find_or_create_auto;
create function private.resolve_auto(app uuid,verb text,path text,record_activity boolean) returns uuid
language plpgsql set search_path='' as $$
declare feature uuid;
  original_path text:=path;
begin
  path:=private.route(path);
  if verb is null or verb !~ '^[A-Z-]{1,32}$' or path is null or path not like '/%' then
    raise exception 'invalid route' using errcode='22023';
  end if;
  select id into feature from public.features where app_id=app and method=verb and route=path;
  if not private.feature_admitted(feature) then
    return private.overflow_feature(app);
  end if;
  if feature is null then feature:=private.find_or_create_auto(app,verb,original_path); end if;
  if record_activity then
    update public.features set last_record_at=now() where id=feature and method<>'*' and last_record_at is distinct from now();
  end if;
  return feature;
end $$;
-- Name confirmation and the timing pass resolve the same bucket without creating activity.
create function private.auto_feature(app uuid,verb text,path text) returns uuid language sql set search_path='' as $$
  select private.resolve_auto(app,verb,path,false)
$$;

create or replace function private.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  k public.app_keys := private.lock_key(app_key_hash);
  version_name text := trim(payload->>'app_version');
  feature uuid;
  requested_feature uuid;
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
    select id into requested_feature from public.features where app_id=k.app_id and feature_key=item->>'feature_key';
    if not found then dropped := dropped+1; continue; end if;
    -- Keep a result paired with a start already routed to 기타, even if a slot reopened.
    select a.feature_id into feature from public.attempts a
      where a.app_id=k.app_id and a.attempt_id=(item->>'attempt_id')::uuid and a.overflow_source_id=requested_feature;
    if not found then
      feature:=requested_feature;
      if not private.feature_admitted(feature) then feature:=private.overflow_feature(k.app_id); end if;
    end if;
    stamp := (item->>'ts')::timestamptz;
    insert into public.attempts as a(app_id,attempt_id,feature_id,version,started_at,ended_at,status,source,step,error_kind,overflow_source_id)
      values(k.app_id,(item->>'attempt_id')::uuid,feature,version_name,case when not result_event then stamp end,
        case when result_event then stamp end,case when result_event then item->>'result' else 'pending' end,
        case when result_event then item->>'source' end,case when result_event then private.mask(item->>'step') end,
        case when result_event then private.mask(item->>'error_kind') end,
        case when feature<>requested_feature then requested_feature end)
      on conflict(app_id,attempt_id) do update set
        feature_id=excluded.feature_id, overflow_source_id=excluded.overflow_source_id,
        started_at=coalesce(a.started_at,excluded.started_at), ended_at=coalesce(a.ended_at,excluded.ended_at),
        status=case when result_event then excluded.status else a.status end,
        source=coalesce(a.source,excluded.source),step=coalesce(a.step,excluded.step),error_kind=coalesce(a.error_kind,excluded.error_kind),
        duration_ms=greatest(0,extract(epoch from (coalesce(a.ended_at,excluded.ended_at)-coalesce(a.started_at,excluded.started_at)))*1000)::integer
      where coalesce(a.overflow_source_id,a.feature_id)=requested_feature
        and ((result_event and a.ended_at is null) or (not result_event and a.started_at is null));
    if not found then dropped := dropped+1; continue; end if;
    if feature=requested_feature then
      update public.features set last_record_at=now() where id=feature;
    end if;
    if result_event and item->>'error_message' is not null then
      insert into public.error_samples(app_id,feature_id,version,at,error_kind,message)
        values(k.app_id,feature,version_name,stamp,private.mask(item->>'error_kind'),private.mask(item->>'error_message'));
      sampled_features := array_append(sampled_features,feature);
    end if;
    accepted := accepted+1;
  end loop;
  for item in select value from jsonb_array_elements(payload->'error_samples') loop
    feature := private.resolve_auto(k.app_id,item->>'method',item->>'route',true);
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

create or replace function public.suggest_feature_map(app_key_hash text,items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare k public.app_keys := private.lock_key(app_key_hash);
  item jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>200 then
    raise exception 'invalid feature map' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item->'method') is distinct from 'string' or item->>'method' !~ '^[A-Z-]{1,32}$'
      or jsonb_typeof(item->'route') is distinct from 'string' or item->>'route' not like '/%' or length(item->>'route')>200
      or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name')>300 or item->>'name' !~ '[^[:space:]]' then
      raise exception 'invalid feature map item' using errcode='22023';
    end if;
    if not exists(select 1 from public.features where app_id=k.app_id and method=item->>'method'
                  and route=private.route(item->>'route')) and not private.beta_has_room() then
      continue;
    end if;
    insert into public.feature_map_suggestions(app_id,method,route,name)
      values(k.app_id,item->>'method',private.route(item->>'route'),private.mask(item->>'name'))
      on conflict(app_id,method,route) do update set name=excluded.name,received_at=now(),applied=false;
  end loop;
end $$;

create function private.check_beta_registration() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.beta_has_room() then raise exception 'beta capacity reached' using errcode='PT409'; end if;
  return new;
end $$;
create trigger beta_registration before insert on public.apps for each row execute function private.check_beta_registration();

create table private.ops_alerts (
  alert_day date primary key,
  measured_at timestamptz not null,
  database_bytes bigint not null,
  threshold_bytes bigint not null
);
create view public.ops_alerts as select alert_day,measured_at,database_bytes,threshold_bytes from private.ops_alerts;
revoke all on private.settings,private.ops_alerts,public.ops_alerts from public,anon,authenticated,service_role;
grant select on public.ops_alerts to grafana_reader;

create or replace function public.cleanup_daily() returns void language plpgsql security definer set search_path='' as $$
declare measured bigint;
begin
  perform private.cleanup_daily();
  delete from private.latest_results where received_at<now()-interval '30 days';
  delete from public.notifications where queued_at<now()-interval '30 days';
  measured:=pg_database_size(current_database());
  insert into private.ops_alerts
    select (now() at time zone 'Asia/Seoul')::date,now(),measured,size_alert_bytes from private.settings
    where measured>size_alert_bytes
    on conflict(alert_day) do update set measured_at=excluded.measured_at,database_bytes=excluded.database_bytes,
      threshold_bytes=excluded.threshold_bytes;
end $$;
