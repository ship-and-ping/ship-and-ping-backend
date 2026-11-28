alter table public.incidents add column first_slow_bucket timestamptz;
alter table public.incidents add column first_failure_at timestamptz;

create function private.first_slow_bucket(issue public.incidents) returns timestamptz
language sql stable set search_path='' as $$
  -- Use the opening window and thresholds, even if the owner has since changed them.
  with opening as (
   select coalesce((issue.metric_at_open->>'window')::int,30) minutes,
    coalesce(max(i.closed_at),'-infinity'::timestamptz) previous_close
   from public.incidents i where i.feature_id=issue.feature_id and i.kind='slow' and i.status in ('resolved','quiet')
    and i.closed_at between issue.opened_at-interval '1 hour' and issue.opened_at and i.id<>issue.id
  ), auto as materialized (
   select s.*,(issue.metric_at_open->>'threshold')::int cap from private.speed_buckets s
   cross join opening o
   where s.app_id=issue.app_id and s.feature_id=issue.feature_id and s.bucket>o.previous_close
    and s.bucket between date_bin('5 minutes',issue.opened_at-o.minutes*interval '1 minute','epoch')
     + case when o.minutes=10 then interval '5 minutes' else interval '0' end and issue.opened_at
  ), deep as (
   select date_bin('5 minutes',a.ended_at,'epoch') bucket,a.duration_ms ms from public.attempts a
   cross join opening o
   where a.app_id=issue.app_id and a.feature_id=issue.feature_id and a.status='success' and a.ended_at>o.previous_close
    and a.duration_ms is not null and a.ended_at between issue.opened_at-o.minutes*interval '1 minute' and issue.opened_at
  ), points as (
   select s.bucket,p.ms,p.n from auto s
   cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
   union all select bucket,ms,1 from deep
  ), medians as (
   select bucket,(private.duration_quantiles(array_agg(ms order by ms),array_agg(n::bigint order by ms),array[0.5]))[1] p50
   from points group by bucket
  ), caps as (
   -- The detector uses exact threshold counters when available, including for a 50/50 tie.
   select s.bucket,s.total-s.client_errors-s.failures timed,
    case when s.threshold_ms=s.cap and s.result_count=s.total-s.client_errors
      and (s.failures=0 or s.slow_count=0 or s.duration_counts is distinct from '{}'::jsonb) then s.slow_count
     else coalesce((select coalesce(sum(value::int) filter(where key::int>s.cap),0)
      from jsonb_each_text(s.duration_counts) having sum(value::int)=s.total-s.client_errors-s.failures),
      private.hist_above(s.success_hist,s.cap),0) end slow
   from auto s
   union all select bucket,1,(ms>(issue.metric_at_open->>'threshold')::int)::int from deep
  ), abnormal as (
   select bucket from caps where (issue.metric_at_open->>'window')::int=10
    and (issue.metric_at_open->>'total')::int>=5
    and (issue.metric_at_open->>'slow')::bigint*2>=(issue.metric_at_open->>'total')::int
   group by bucket having sum(timed)>0 and sum(slow)*2>=sum(timed)
   union all
   select bucket from medians where (select sum(n) from points)>=5
    and (issue.metric_at_open->>'p50')::numeric>(issue.metric_at_open->>'baseline_p95')::int
    and (issue.metric_at_open->>'p50')::numeric>=coalesce(issue.metric_at_open->>'baseline_p50',issue.metric_at_open->>'baseline')::numeric+500
    and p50>(issue.metric_at_open->>'baseline_p95')::int
    and p50>=coalesce(issue.metric_at_open->>'baseline_p50',issue.metric_at_open->>'baseline')::numeric+500
  )
  select min(bucket) from abnormal;
$$;

create function private.first_failure_at(issue public.incidents) returns timestamptz
language sql stable set search_path='' as $$
 with cutoff as (
  select coalesce(max(closed_at),'-infinity'::timestamptz) previous_close from public.incidents
  where feature_id=issue.feature_id and kind='failure' and id<>issue.id and status in ('resolved','quiet')
   and closed_at between issue.opened_at-interval '1 hour' and issue.opened_at
 ), deep_results as (
  select a.ended_at,a.status,row_number() over(order by a.ended_at desc,a.attempt_id) position
  from public.attempts a,cutoff where a.app_id=issue.app_id and a.feature_id=issue.feature_id
   and a.ended_at between issue.opened_at-interval '30 minutes' and issue.opened_at
   and a.ended_at>previous_close and a.status in ('success','failure')
 ), failures as (
  select s.bucket at from public.stats_5m s,cutoff where s.app_id=issue.app_id and s.feature_id=issue.feature_id
   and s.bucket between date_bin('5 minutes',issue.opened_at-interval '30 minutes','epoch') and issue.opened_at
   and s.bucket>previous_close and s.failures>0
  union all select ended_at from deep_results where status='failure' and
   ((issue.metric_at_open->>'total')::int>=5 and (issue.metric_at_open->>'failures')::bigint*5>=(issue.metric_at_open->>'total')::int
    or (issue.metric_at_open->>'consecutive')::boolean and position<=3)
 )
 select min(at) from failures
$$;

create function private.snapshot_incident_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='slow' then new.first_slow_bucket := private.first_slow_bucket(new);
 else new.first_failure_at := private.first_failure_at(new); end if;
 return new;
end $$;
revoke all on function private.first_slow_bucket(public.incidents),private.first_failure_at(public.incidents),private.snapshot_incident_start()
 from public,anon,authenticated,service_role;
create trigger snapshot_incident_start before insert on public.incidents for each row when (new.kind in ('slow','failure'))
 execute function private.snapshot_incident_start();
update public.incidents i set first_slow_bucket=private.first_slow_bucket(i)
 where i.kind='slow' and i.opened_at>=now()-interval '7 days';
update public.incidents i set first_failure_at=private.first_failure_at(i)
 where i.kind='failure' and i.opened_at>=now()-interval '7 days';

-- Return compact aggregates for one owner's incident. No raw requests cross this boundary.
create function public.incident_prompt_context(incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 issue public.incidents;
 app_first timestamptz;
 feature_kind text;
 slow_start timestamptz;
 incident_start timestamptz;
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
 incident_start := coalesce(slow_start,issue.first_failure_at,issue.opened_at);
 start_bucket := date_bin('5 minutes',incident_start,'epoch');
 sample_start := incident_start-interval '10 minutes';

 with slots as (
  -- Count quiet minutes as well as busy ones. Before connection there is no exposure.
  select t from generate_series(greatest(start_bucket-interval '7 days',
   date_bin('5 minutes',app_first,'epoch')),start_bucket-interval '5 minutes',interval '5 minutes') t
  where not exists(select from public.incidents other where other.app_id=issue.app_id and other.id<>issue.id
   and coalesce(other.first_slow_bucket,other.first_failure_at,other.opened_at)<t+interval '5 minutes' and (other.closed_at is null or other.closed_at>t))
 ), hours as (
  -- Retention can split an hour across the 1h and 5m tables. Use both only if
  -- the whole rolled-up hour belongs to the comparison window.
  select h.bucket,sum(h.total) total from public.stats_1h h where h.app_id=issue.app_id
   and h.bucket between start_bucket-interval '7 days 1 hour' and start_bucket group by h.bucket
 ), usable as materialized (
  select s.t from (select t,date_trunc('hour',t) hour,count(*) over(partition by date_trunc('hour',t)) n from slots) s
  left join hours h on h.bucket=s.hour where h.bucket is null or s.n=12
 ), usual as (
  select ((select coalesce(sum(s.total),0) from public.stats_5m s join usable u on u.t=s.bucket
    where s.app_id=issue.app_id and s.bucket>=start_bucket-interval '7 days' and s.bucket<start_bucket)
   +(select coalesce(sum(h.total),0) from hours h join usable u on u.t=h.bucket))
   /nullif((select count(*)*5 from usable),0)::numeric rpm
 ), traffic as (
  -- A closed partial bucket may already include later traffic. Use only its
  -- completed predecessors; for a live incident use elapsed minutes so far.
  select case when start_bucket=incident_start then start_bucket else start_bucket+interval '5 minutes' end since_at,
   case when issue.closed_at is null then stop_at else date_bin('5 minutes',stop_at,'epoch') end until_at
 ), current_rate as (
  select case when t.until_at>t.since_at then coalesce(sum(s.total),0)/(extract(epoch from (t.until_at-t.since_at))/60) end rpm
  from traffic t left join public.stats_5m s on s.app_id=issue.app_id and s.bucket>=t.since_at and s.bucket<t.until_at
  group by t.since_at,t.until_at
 ), scoped_features as materialized (
  select f.id,f.kind from public.features f where f.app_id=issue.app_id and (f.id=issue.feature_id or exists(
   select from public.incidents i where i.app_id=issue.app_id and i.feature_id=f.id
    and i.opened_at between incident_start-interval '10 minutes' and incident_start+interval '10 minutes'))
 ), errors as (
  select s.*,s.bucket>=sample_start and s.bucket+interval '5 minutes'<=stop_at complete
  from public.stats_5m s join scoped_features f on f.id=s.feature_id where s.app_id=issue.app_id
   and s.bucket between date_bin('5 minutes',sample_start,'epoch') and stop_at
 ), error_counts as (
  select e.feature_id,e.complete,e.client_errors,e.server_errors,e.failures,
   count(x.id) filter(where x.at between sample_start and stop_at and c.is_client) client_in,
   count(x.id) filter(where x.at not between sample_start and stop_at and c.is_client) client_out,
   count(x.id) filter(where x.at between sample_start and stop_at and x.http_status>=500) server_in,
   count(x.id) filter(where x.at not between sample_start and stop_at and x.http_status>=500) server_out
  from errors e left join public.error_samples x on x.feature_id=e.feature_id and x.version=e.version
   and x.at>=e.bucket and x.at<e.bucket+interval '5 minutes'
  cross join lateral (select x.http_status between 400 and 499 or (x.http_status is null and e.failures=0) is_client) c
  group by e.feature_id,e.bucket,e.version,e.complete,e.client_errors,e.server_errors,e.failures
 ), counts as (
  select feature_id,sum(case when complete then client_errors else client_in end) clients,
   bool_or(not complete and client_errors>client_in+client_out) client_partial,
   coalesce(sum(case when complete then coalesce(server_errors,server_in) else server_in end),0) servers,
   bool_or(case when complete then server_errors is null and failures>server_in
    else coalesce(server_errors,failures)>server_in+server_out end) server_partial
  from error_counts group by feature_id
 ), totals as (
  select sum(coalesce(c.servers,0)) filter(where f.kind='auto') all_servers,
   bool_or(f.kind='deep' or coalesce(c.server_partial,false)) all_partial
  from scoped_features f left join counts c on c.feature_id=f.id
 )
 select jsonb_build_object('slow_start',slow_start,'incident_start',incident_start,'usual_rpm',case when start_bucket-interval '7 days'>=now()-interval '30 days' then usual.rpm end,
  'incident_rpm',case when start_bucket>=now()-interval '7 days' then current_rate.rpm end,
  'client_errors',case when feature_kind='auto' and sample_start>=now()-interval '7 days' then coalesce(counts.clients,0) end,
  'server_errors',case when feature_kind='auto' and sample_start>=now()-interval '7 days' then coalesce(counts.servers,0) end,
  'related_server_errors',case when sample_start>=now()-interval '7 days' then totals.all_servers end,
  'related_server_partial',totals.all_partial,
  'client_partial',coalesce(counts.client_partial,false),'server_partial',coalesce(counts.server_partial,false))
 into result from usual cross join current_rate cross join totals left join counts on counts.feature_id=issue.feature_id;
 return result;
end $$;
revoke all on function public.incident_prompt_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.incident_prompt_context(uuid) to authenticated;
