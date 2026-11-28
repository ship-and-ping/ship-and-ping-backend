alter table private.latest_results add column inclusive boolean;
alter table private.latency_baselines add column next_check_at timestamptz not null default '-infinity';

create or replace function private.ingest_duration_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 result jsonb := private.ingest_batch(app_key_hash,payload);
 app uuid;
 from_server boolean;
 item jsonb;
 feature uuid;
 threshold integer;
 received timestamptz := clock_timestamp();
 version_name text := trim(payload->>'app_version');
 legacy_offset bigint := 0;
 bin_count integer;
begin
 -- The original function owns the per-app lock and returns zero for retries.
 if (result->>'accepted')::integer=0 then return result; end if;
 select app_id,kind='srv' and payload->>'platform'='server' into strict app,from_server from public.app_keys where key_hash=app_key_hash;
 for item in select value from jsonb_array_elements(payload->'stats') where value ? 'timings' loop
  feature := private.auto_feature(app,item->>'method',item->>'route');
  select slow_threshold_ms into strict threshold from public.features where id=feature;
  bin_count := jsonb_array_length(item->'hist');
  insert into private.evaluation_buckets as b
  with timings as materialized (
   select (t->>1)::integer ms,(t->>2)::boolean success from jsonb_array_elements(item->'timings') t
  ), bins as (
   select private.duration_bin(ms,bin_count) bin,count(*) n from timings where success group by 1
  )
  select app,feature,trim(payload->>'app_version'),(item->>'bucket')::timestamptz,
   array(select coalesce(n,0)::integer from generate_series(1,bin_count) g left join bins on g=bin order by g),
   min(ms) filter(where success),max(ms) filter(where success),count(success),count(*) filter(where success and ms>threshold),
   threshold,(select case when count(*)<=32 then coalesce(jsonb_object_agg(ms,n),'{}'::jsonb) end
    from (select ms,count(*) n from timings where success group by ms) counts)
  from timings
  on conflict(app_id,feature_id,version,bucket) do update set
   success_hist=private.add_hist(b.success_hist,excluded.success_hist),
   min_ms=least(b.min_ms,excluded.min_ms),max_ms=greatest(b.max_ms,excluded.max_ms),
   result_count=b.result_count+excluded.result_count,slow_count=b.slow_count+excluded.slow_count,
   duration_counts=private.merge_duration_counts(b.duration_counts,excluded.duration_counts),
   -- A legacy counter in a mixed bucket may include slow failures. Invalidate
   -- it only when merging that bucket, preserving counters for pure successes.
   threshold_ms=case when b.threshold_ms=excluded.threshold_ms and
    (b.duration_counts is distinct from '{}'::jsonb or b.slow_count=0 or
     b.result_count=(select sum(n) from unnest(b.success_hist) n)) then b.threshold_ms else -1 end;
  insert into private.latest_results(app_id,feature_id,version,received_at,position,ms,success,inclusive)
   select app,feature,version_name,received,
    case when jsonb_typeof(t->0)='number' then (t->>0)::bigint else legacy_offset+n end,
    (t->>1)::int,(t->>2)::boolean,from_server and coalesce((t->>3)::boolean,false)
   from jsonb_array_elements(item->'timings') with ordinality as rows(t,n) where t->>2 is not null;
  -- A success wakes only its own unready baseline when its five-minute bucket
  -- first becomes eligible. Late historical batches can wake it immediately.
  update private.latency_baselines b set next_check_at=least(b.next_check_at,(item->>'bucket')::timestamptz+interval '15 minutes')
   where b.feature_id=feature and b.p95 is null and b.next_check_at>(item->>'bucket')::timestamptz+interval '15 minutes'
     and exists(select from jsonb_array_elements(item->'timings') t where (t->>2)::boolean
       and b.inclusive=(from_server and coalesce((t->>3)::boolean,false)));
  legacy_offset := legacy_offset + jsonb_array_length(item->'timings');
  delete from private.latest_results r where r.app_id=app and r.feature_id=feature and r.version=version_name
   and (r.received_at,r.position) in (select received_at,position from private.latest_results
    where app_id=app and feature_id=feature and version=version_name order by received_at desc,position desc offset 20);
 end loop;
 return result;
end $$;

create or replace function private.verification_progress(issue public.incidents)
returns table(version text,consecutive_successes integer,latest_duration_ms integer,latest_success boolean)
language sql stable set search_path='' as $$
 select v.version,coalesce(array_position(proof.qualified,false)-1,cardinality(proof.qualified),0) as streak,
  proof.durations[1],proof.successes[1]
 from public.app_versions v join public.features f on f.id=issue.feature_id
 left join public.baselines b on b.feature_id=f.id and f.method is distinct from '*'
 cross join lateral (
  select issue.metric_at_open->>'timing_basis' basis,
    case when issue.metric_at_open ? 'timing_basis' then (issue.metric_at_open->>'baseline_p95')::bigint else b.p95_ms end upper_ms,
    case when issue.metric_at_open ? 'timing_basis' then (issue.metric_at_open->>'baseline_p50')::bigint else b.p50_ms end usual_ms
 ) opening
 cross join lateral (
  -- A qualifying result must also be on the healthy side of the opening rule.
  select array_agg(success and (issue.kind<>'slow' or coalesce(
    (opening.basis is null or opening.basis='mixed' or inclusive=(opening.basis='inclusive'))
    and ms<=least(f.slow_threshold_ms,
      case when issue.metric_at_open->>'slow_rule'='absolute' then (issue.metric_at_open->>'threshold')::int
        else least(opening.upper_ms+500,greatest(opening.upper_ms,opening.usual_ms+499)) end),false))
    order by rank) qualified,array_agg(ms order by rank) durations,array_agg(success order by rank) successes
  from (
   select success,ms,inclusive,row_number() over w as rank from (
    select a.result_received_at stamp,0::bigint position,a.status='success' success,a.duration_ms ms,null::boolean inclusive
    from public.attempts a where a.feature_id=f.id and a.version=v.version and a.status in ('success','failure')
     and a.result_received_at>issue.opened_at
    union all
    select r.received_at,r.position,r.success,r.ms,r.inclusive
    from private.latest_results r
    where r.app_id=v.app_id and r.feature_id=f.id and r.version=v.version
     and r.received_at>issue.opened_at
   ) events window w as (order by stamp desc,position desc,success,ms desc)
   order by stamp desc,position desc,success,ms desc limit 5
  ) last_results
 ) proof
 where v.app_id=issue.app_id and v.version<>issue.opened_version and v.last_seen_at>issue.opened_at
  and (issue.resolved_version is null or v.version=issue.resolved_version)
 order by (cardinality(proof.qualified)=5 and array_position(proof.qualified,false) is null) desc nulls last,
  v.last_seen_at desc,v.version limit 1
$$;

create or replace function public.incident_server_context(incident_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with bounds as (
   select i.*,least(i.opened_at,date_trunc('minute',(i.metric_at_open->>'stall_at')::timestamptz),
     case when i.kind='slow' and i.metric_at_open ? 'queue_ms' then
       date_bin('5 minutes',i.opened_at,timestamptz 'epoch')-interval '1 minute'*
         case when i.metric_at_open->>'window'='10' then 5 else 30 end end) start_at,
     coalesce(i.closed_at,now()) until_at from public.incidents i where i.id=incident_id
 )
 select jsonb_build_object('profile',p.profile,'since',i.start_at,'until',i.until_at,
   'peaks',(select s.peaks from public.server_series(i.app_id,i.start_at,i.until_at,1) s))
 from bounds i left join public.app_profiles p on p.app_id=i.app_id;
$$;
