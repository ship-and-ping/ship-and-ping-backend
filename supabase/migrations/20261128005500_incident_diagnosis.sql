alter function public.incident_prompt_context(uuid) set schema private;
revoke all on function private.incident_prompt_context(uuid) from public,anon,authenticated,service_role;

create function public.incident_prompt_context(incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  -- The existing owner check runs before any supplementary lookup.
  context jsonb := private.incident_prompt_context(incident_id);
  issue public.incidents;
  onset timestamptz := (context->>'incident_start')::timestamptz;
  first_bucket timestamptz := date_bin('5 minutes',onset,'epoch');
  until_at timestamptz;
  minutes numeric;
  prior_minutes numeric := 30;
  signals jsonb;
  extra jsonb;
begin
  select * into strict issue from public.incidents where id=incident_id;
  until_at := least(coalesce(issue.closed_at,now()),now(),onset+interval '30 minutes');
  if first_bucket < onset then first_bucket := first_bucket+interval '5 minutes'; end if;
  -- Compare complete buckets only. The bucket containing onset may mix both periods.
  minutes := extract(epoch from date_bin('5 minutes',until_at,'epoch')-first_bucket)/60;
  if first_bucket-interval '35 minutes' < now()-interval '7 days' or not exists (
    select from public.apps where id=issue.app_id and first_record_at <= onset-interval '35 minutes'
  ) then prior_minutes := null; end if;

  with totals as (
    select feature_id,
      coalesce(sum(total) filter(where bucket >= first_bucket),0) recent,
      coalesce(sum(total) filter(where bucket < date_bin('5 minutes',onset,'epoch')),0) prior,
      coalesce(sum(client_errors) filter(where bucket >= first_bucket),0) clients,
      coalesce(sum(client_errors) filter(where bucket < date_bin('5 minutes',onset,'epoch')),0) prior_clients
    from public.stats_5m where app_id=issue.app_id
      and bucket >= date_bin('5 minutes',onset,'epoch')-interval '30 minutes'
      and bucket < date_bin('5 minutes',until_at,'epoch')
    group by feature_id
  ), rates as (
    select *,recent/nullif(greatest(minutes,0),0) rpm,prior/prior_minutes usual,
      clients/nullif(greatest(minutes,0),0) client_rpm,prior_clients/prior_minutes usual_client
    from totals
  ), auth_errors as (
    select count(*) n from public.error_samples where app_id=issue.app_id and feature_id=issue.feature_id
      and version=issue.opened_version and at between onset and until_at and http_status in (401,403)
  ), failed_steps as (
    select step,error_kind from public.attempts where app_id=issue.app_id and feature_id=issue.feature_id
      and version=issue.opened_version and ended_at between onset and until_at and status='failure'
  ), server_errors as (
    select coalesce(private.error_name(message),nullif(error_kind,'')) class
    from public.error_samples where app_id=issue.app_id and feature_id=issue.feature_id
      and version=issue.opened_version and at between onset and until_at and http_status between 500 and 599
  )
  select jsonb_build_object(
    'feature_rpm',case when first_bucket>=now()-interval '7 days' then r.rpm end,
    'single_feature_spike',r.recent>=5 and r.rpm>=greatest(0.1,r.usual)*3 and prior_minutes is not null
      and not exists(select from rates peer where peer.feature_id<>issue.feature_id
        and peer.recent>=5 and peer.rpm>=greatest(0.1,peer.usual)*3),
    'client_spike',r.clients>=3 and prior_minutes is not null and r.client_rpm>=greatest(0.1,r.usual_client)*3,
    -- Samples give a lower bound after onset. All baseline 4xx give an upper bound on baseline auth errors.
    'auth_spike',a.n>=3 and prior_minutes is not null and
      a.n/nullif(extract(epoch from until_at-onset)/60,0)>=greatest(0.1,r.usual_client)*3,
    'repeated_server_error',exists(select from server_errors where class ~ '[A-Za-z]'
      and class !~* '^(HTTP[._-]?)?[0-9]{3}$' group by class having count(*)>=2),
    'key_changed',exists(select from public.app_keys where app_id=issue.app_id and
      (revoked_at between onset-interval '30 minutes' and onset or
       expires_at-interval '24 hours' between onset-interval '30 minutes' and onset)),
    'timeout_step',(select count(*)>=2 and count(*)=count(step) and count(distinct step)=1 and
      bool_and(coalesce(error_kind,'') ~* '(time[_. -]?out|timed[_. -]?out)') from failed_steps)
  ) into signals from auth_errors a left join rates r on r.feature_id=issue.feature_id;
  -- T54 may be deployed independently. These statements are planned only when the table exists.
  if to_regclass('public.app_profiles') is not null then
    select jsonb_build_object('metrics_guide',left(profile->>'metrics',120)) into extra
    from public.app_profiles where app_id=issue.app_id;
    signals := signals || coalesce(extra,'{}'::jsonb);
  end if;
  if to_regclass('public.server_minutes') is not null then
    with samples as (
      select bucket,(resources->>'mem_used_pct')::numeric mem,
        greatest((resources->>'system_cpu_pct')::numeric,(resources->>'process_cpu_pct')::numeric) cpu
      from public.server_minutes where app_id=issue.app_id and version=issue.opened_version
        and bucket>=onset and bucket<until_at
    ), trend as (
      select mem,lag(mem) over(order by bucket) prior from samples where mem is not null
    )
    select jsonb_build_object('cpu_high',(select count(*) filter(where cpu>=85)>=2 from samples),
      'memory_rising',count(mem)>=3 and bool_and(mem>prior) and max(mem)>=85 and max(mem)-min(mem)>=10)
    into extra from trend;
    signals := signals || extra;
  end if;
  if to_regclass('public.feature_timing_5m') is not null then
    with times as (
      select bucket>=first_bucket recent,sum(db_ms_sum)::numeric/nullif(sum(db_ms_count),0) ms,
        sum(external_ms_sum)::numeric/nullif(sum(external_ms_count),0) external_ms,
        sum(external_ms_count) external_count
      from public.feature_timing_5m where app_id=issue.app_id and feature_id=issue.feature_id
        and bucket>=date_bin('5 minutes',onset,'epoch')-interval '30 minutes'
        and bucket<date_bin('5 minutes',until_at,'epoch')
        and (bucket<date_bin('5 minutes',onset,'epoch') or (bucket>=first_bucket and version=issue.opened_version))
      group by 1
    )
    select jsonb_build_object('db_slow',r.ms>=b.ms*2 and r.ms>=b.ms+100,
      'external_slow',r.external_count>=2 and r.external_ms>=b.external_ms*2 and r.external_ms>=b.external_ms+100
        and r.ms<=b.ms+100)
    into extra from times r join times b on r.recent and not b.recent;
    signals := signals || coalesce(extra,'{}'::jsonb);
  end if;
  return context || signals;
end $$;
revoke all on function public.incident_prompt_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.incident_prompt_context(uuid) to authenticated;
