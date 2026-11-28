alter table public.incidents add column volume_quiet_since timestamptz,
 add column volume_recovered_at timestamptz;

alter table public.notifications drop constraint notifications_check,
 add constraint notifications_check check ((event in ('open','worse','resolved','volume_quiet','volume_unverified')
 and incident_id is not null and test_app is null)
 or (event='test' and incident_id is null and test_app is not null));

-- Use the last two completed buckets. Counts in the current partial bucket
-- cannot be apportioned by minute, especially during bursts.
-- Count every request, including failures, across versions of this feature.
create function private.feature_rpm(target_app uuid, target_feature uuid) returns numeric
language sql stable set search_path='' as $$
 select case when f.kind='deep' then
   (select count(*) from public.attempts a where a.app_id=f.app_id and a.feature_id=f.id
    and a.started_at between now()-interval '10 minutes' and now())
 else (select coalesce(sum(s.total),0) from public.stats_5m s where s.app_id=f.app_id and s.feature_id=f.id
   and s.bucket >= date_bin('5 minutes',now(),timestamptz 'epoch')-interval '10 minutes'
   and s.bucket < date_bin('5 minutes',now(),timestamptz 'epoch'))
 end / 10.0 from public.features f where f.app_id=target_app and f.id=target_feature
$$;
create function private.volume_comparison(i public.incidents) returns jsonb
language sql stable set search_path='' as $$
 select case when i.metric_at_open ? 'requests_per_minute' then jsonb_build_object(
   'opening_rpm',i.metric_at_open->'requests_per_minute','current_rpm',private.feature_rpm(i.app_id,i.feature_id),
   'volume_quiet',i.status='open' and i.volume_quiet_since is not null and i.volume_recovered_at is null,
   'volume_recovering',i.status='open' and i.volume_recovered_at is not null,
   'volume_unverified',i.status='quiet' and i.volume_quiet_since is not null)
 else '{}'::jsonb end
$$;
revoke all on function private.feature_rpm(uuid,uuid),private.volume_comparison(public.incidents) from public,anon,authenticated,service_role;

create or replace function private.verification_progress(issue public.incidents)
returns table(version text,consecutive_successes integer,latest_duration_ms integer,latest_success boolean)
language sql stable set search_path='' as $$
 select v.version,coalesce(array_position(proof.qualified,false)-1,cardinality(proof.qualified),0) as streak,
  proof.durations[1],proof.successes[1]
 from public.app_versions v join public.features f on f.id=issue.feature_id
 cross join lateral (
  select coalesce(issue.metric_at_open->>'timing_basis',case when f.kind='deep' then 'deep' else 'handler' end) basis,
    (issue.metric_at_open->>'baseline_p95')::bigint upper_ms,
    (issue.metric_at_open->>'baseline_p50')::bigint usual_ms,
    coalesce((issue.metric_at_open->>'threshold')::int,f.slow_threshold_ms) threshold
 ) opening
 cross join lateral (
  -- A qualifying result must also be on the healthy side of the opening rule.
  select array_agg(success and (issue.kind<>'slow' or coalesce(
    (opening.basis in ('deep','mixed') or coalesce(inclusive,false)=(opening.basis='inclusive'))
    and ms<=least(opening.threshold,
      case when issue.metric_at_open->>'slow_rule'='absolute' then (issue.metric_at_open->>'threshold')::int
        else least(opening.upper_ms+500,greatest(opening.upper_ms,opening.usual_ms+499)) end),false))
    order by rank) qualified,array_agg(ms order by rank) durations,array_agg(success order by rank) successes
  from (
   select success,ms,inclusive,row_number() over w as rank from (
    select a.result_received_at stamp,0::bigint position,a.status='success' success,a.duration_ms ms,null::boolean inclusive
    from public.attempts a where a.feature_id=f.id and a.version=v.version and a.status in ('success','failure')
     and a.result_received_at>greatest(issue.opened_at,issue.volume_recovered_at)
    union all
    select r.received_at,r.position,r.success,r.ms,r.inclusive
    from private.latest_results r
    where r.app_id=v.app_id and r.feature_id=f.id and r.version=v.version
     and r.received_at>greatest(issue.opened_at,issue.volume_recovered_at)
   ) events window w as (order by stamp desc,position desc,success,ms desc)
   order by stamp desc,position desc,success,ms desc limit 5
  ) last_results
 ) proof
 where v.app_id=issue.app_id and v.version<>issue.opened_version and v.last_seen_at>issue.opened_at
  and (issue.resolved_version is null or v.version=issue.resolved_version)
 order by (cardinality(proof.qualified)=5 and array_position(proof.qualified,false) is null) desc nulls last,
  v.last_seen_at desc,v.version limit 1
$$;
