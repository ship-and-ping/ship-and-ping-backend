-- NULL preserves uncertainty in older aggregates that combine exceptions and HTTP failures.
alter table public.stats_5m add column server_errors integer check (server_errors between 0 and failures);
alter table public.error_samples add column http_status integer check (http_status = 0 or http_status between 100 and 599);

-- Keep status and counts inside the existing batch transaction and retry guard.
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
    insert into public.stats_5m as s(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist,server_errors)
      values(k.app_id,feature,version_name,(item->>'bucket')::timestamptz,(item->>'total')::integer,
        (item->>'failures')::integer,(item->>'client_errors')::integer,(item->>'duration_sum_ms')::bigint,
        array(select jsonb_array_elements_text(item->'hist')::integer),
        coalesce((item->>'server_errors')::integer,case when (item->>'failures')::integer=0 then 0 end))
      on conflict(app_id,feature_id,version,bucket) do update set
        server_errors=coalesce(s.server_errors,case when s.failures=0 then 0 end)+excluded.server_errors,
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
    insert into public.error_samples(app_id,feature_id,version,at,error_kind,message,http_status)
      values(k.app_id,feature,version_name,(item->>'at')::timestamptz,private.error_kind(item->>'error_kind'),
        private.error_name(item->>'message'),(item->>'http_status')::integer);
    sampled_features := array_append(sampled_features,feature);
  end loop;
  delete from public.error_samples where id in (
    select id from (select id,row_number() over(partition by feature_id order by at desc,id desc) as position
      from public.error_samples where feature_id=any(sampled_features) and version=version_name) ranked where position>20);
  if accepted>0 then update public.apps set first_record_at=now() where id=k.app_id and first_record_at is null; end if;
  return jsonb_build_object('accepted',accepted,'dropped',dropped);
end $$;
