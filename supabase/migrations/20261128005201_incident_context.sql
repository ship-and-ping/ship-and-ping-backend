alter table public.incidents add column first_slow_bucket timestamptz;

create function private.first_slow_bucket(issue public.incidents) returns timestamptz
language sql stable set search_path='' as $$
  -- Use the opening window and thresholds, even if the owner has since changed them.
  with points as (
   select s.bucket,p.ms,p.n from private.speed_buckets s
   cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
   where s.app_id=issue.app_id and s.feature_id=issue.feature_id
    and s.bucket between issue.opened_at-coalesce((issue.metric_at_open->>'window')::int,30)*interval '1 minute' and issue.opened_at
   union all
   select date_bin('5 minutes',a.ended_at,'epoch'),a.duration_ms,1 from public.attempts a
   where a.app_id=issue.app_id and a.feature_id=issue.feature_id and a.status='success'
    and a.duration_ms is not null and a.ended_at between
     issue.opened_at-coalesce((issue.metric_at_open->>'window')::int,30)*interval '1 minute' and issue.opened_at
  ), buckets as (
   select bucket,(private.duration_quantiles(array_agg(ms order by ms),array_agg(n::bigint order by ms),array[0.5]))[1] p50,
    sum(n) filter(where ms>(issue.metric_at_open->>'threshold')::int)*2>=sum(n) over_cap
   from points group by bucket
  )
  select min(bucket) from buckets where over_cap or
   (p50>(issue.metric_at_open->>'baseline_p95')::int
    and p50>=coalesce(issue.metric_at_open->>'baseline_p50',issue.metric_at_open->>'baseline')::numeric+500);
$$;

create function private.snapshot_slow_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.first_slow_bucket := private.first_slow_bucket(new);
 return new;
end $$;
revoke all on function private.first_slow_bucket(public.incidents),private.snapshot_slow_start()
 from public,anon,authenticated,service_role;
create trigger snapshot_slow_start before insert on public.incidents for each row when (new.kind='slow')
 execute function private.snapshot_slow_start();
update public.incidents i set first_slow_bucket=private.first_slow_bucket(i)
 where i.kind='slow' and i.opened_at>=now()-interval '7 days';

-- Return compact aggregates for one owner's incident. No raw requests cross this boundary.
create function public.incident_prompt_context(incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 issue public.incidents;
 app_first timestamptz;
 feature_kind text;
 slow_start timestamptz;
 start_bucket timestamptz;
 stop_at timestamptz;
 sample_start timestamptz;
 result jsonb;
begin
 select i.* into issue from public.incidents i join public.apps a on a.id=i.app_id
 where i.id=incident_id and a.owner_id=auth.uid();
 if not found then raise exception 'incident access denied' using errcode='42501'; end if;
 select first_record_at into app_first from public.apps where id=issue.app_id;
 select kind into feature_kind from public.features where id=issue.feature_id;
 stop_at := least(coalesce(issue.closed_at,now()),now());
 slow_start := issue.first_slow_bucket;
 start_bucket := coalesce(slow_start,date_bin('5 minutes',issue.opened_at,'epoch'));
 sample_start := coalesce(slow_start,issue.opened_at)-interval '10 minutes';

 with slots as (
  -- Count quiet minutes as well as busy ones. Before connection there is no exposure.
  select t from generate_series(greatest(start_bucket-interval '7 days',
   date_bin('5 minutes',app_first,'epoch')),start_bucket-interval '5 minutes',interval '5 minutes') t
  where not exists(select from public.incidents other where other.app_id=issue.app_id and other.id<>issue.id
   and coalesce(other.first_slow_bucket,other.opened_at)<t+interval '5 minutes' and (other.closed_at is null or other.closed_at>t))
 ), hours as (
  -- Retention can split an hour across the 1h and 5m tables. Use both only if
  -- the whole rolled-up hour belongs to the comparison window.
  select h.bucket,sum(h.total) total from public.stats_1h h where h.app_id=issue.app_id
   and h.bucket between start_bucket-interval '7 days 1 hour' and start_bucket group by h.bucket
 ), usable as materialized (
  select s.t from slots s left join hours h on h.bucket=date_trunc('hour',s.t)
  where h.bucket is null or (select count(*) from slots x where x.t>=h.bucket and x.t<h.bucket+interval '1 hour')=12
 ), usual as (
  select ((select coalesce(sum(s.total),0) from public.stats_5m s join usable u on u.t=s.bucket
    where s.app_id=issue.app_id)
   +(select coalesce(sum(h.total),0) from hours h join usable u on u.t=h.bucket))
   /nullif((select count(*)*5 from usable),0)::numeric rpm
 ), traffic as (
  -- A closed partial bucket may already include later traffic. Use only its
  -- completed predecessors; for a live incident use elapsed minutes so far.
  select case when issue.closed_at is null then stop_at else date_bin('5 minutes',stop_at,'epoch') end until_at
 ), current_rate as (
  select sum(s.total)/(nullif(extract(epoch from (t.until_at-start_bucket)),0)/60) rpm
  from traffic t left join public.stats_5m s on s.app_id=issue.app_id and s.bucket>=start_bucket and s.bucket<t.until_at
  group by t.until_at
 ), errors as (
  select s.*,s.bucket>=sample_start and
   (s.bucket+interval '5 minutes'<=stop_at or issue.closed_at is null) complete
  from public.stats_5m s where s.app_id=issue.app_id and s.feature_id=issue.feature_id
   and s.bucket between date_bin('5 minutes',sample_start,'epoch') and stop_at
 ), error_counts as (
  select e.complete,e.client_errors,e.server_errors,e.failures,
   count(x.id) filter(where x.at between sample_start and stop_at and c.is_client) client_in,
   count(x.id) filter(where x.at not between sample_start and stop_at and c.is_client) client_out,
   count(x.id) filter(where x.at between sample_start and stop_at and x.http_status>=500) server_in,
   count(x.id) filter(where x.at not between sample_start and stop_at and x.http_status>=500) server_out
  from errors e left join public.error_samples x on x.feature_id=e.feature_id and x.version=e.version
   and x.at>=e.bucket and x.at<e.bucket+interval '5 minutes'
  cross join lateral (select x.http_status between 400 and 499 or (x.http_status is null and e.failures=0) is_client) c
  group by e.bucket,e.version,e.complete,e.client_errors,e.server_errors,e.failures
 ), counts as (
  select coalesce(sum(case when complete then client_errors else client_in end),0) clients,
   bool_or(not complete and client_errors>client_in+client_out) client_partial,
   coalesce(sum(case when complete then coalesce(server_errors,server_in) else server_in end),0) servers,
   bool_or(case when complete then server_errors is null and failures>server_in
    else coalesce(server_errors,failures)>server_in+server_out end) server_partial
  from error_counts
 )
 select jsonb_build_object('slow_start',slow_start,'usual_rpm',case when start_bucket-interval '7 days'>=now()-interval '30 days' then usual.rpm end,
  'incident_rpm',case when start_bucket>=now()-interval '7 days' then current_rate.rpm end,
  'client_errors',case when feature_kind='auto' and sample_start>=now()-interval '7 days' then counts.clients end,
  'server_errors',case when feature_kind='auto' and sample_start>=now()-interval '7 days' then counts.servers end,
  'client_partial',coalesce(counts.client_partial,false),'server_partial',coalesce(counts.server_partial,false))
 into result from usual,current_rate,counts;
 return result;
end $$;
revoke all on function public.incident_prompt_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.incident_prompt_context(uuid) to authenticated;
