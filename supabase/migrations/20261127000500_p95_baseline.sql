-- A bucket retains counts per distinct successful duration, with no event order
-- or identifiers. Bound its size on high-cardinality traffic and use T45 bins
-- when the exact distribution is incomplete (including pre-migration data).
alter table private.evaluation_buckets add column duration_counts jsonb default '{}'::jsonb;

create function private.merge_duration_counts(a jsonb,b jsonb) returns jsonb
language sql immutable strict parallel safe set search_path='' as $$
 select case when count(*)<=32 then coalesce(jsonb_object_agg(key,n),'{}'::jsonb) end
 from (select key,sum(value::integer) n from (
  select * from jsonb_each_text(a) union all select * from jsonb_each_text(b)
 ) entries group by key) counts
$$;

create or replace function private.ingest_duration_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 result jsonb := private.ingest_batch(app_key_hash,payload);
 app uuid;
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
 select app_id into strict app from public.app_keys where key_hash=app_key_hash;
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
  insert into private.latest_results
   select app,feature,version_name,received,
    case when jsonb_typeof(t->0)='number' then (t->>0)::bigint else legacy_offset+n end,
    (t->>1)::int,(t->>2)::boolean
   from jsonb_array_elements(item->'timings') with ordinality as rows(t,n) where t->>2 is not null;
  legacy_offset := legacy_offset + jsonb_array_length(item->'timings');
  delete from private.latest_results r where r.app_id=app and r.feature_id=feature and r.version=version_name
   and (r.received_at,r.position) in (select received_at,position from private.latest_results
    where app_id=app and feature_id=feature and version=version_name order by received_at desc,position desc offset 20);
 end loop;
 return result;
end $$;

-- Convert each occupied bin into a weighted duration. Exact counters win only
-- when they cover all measured successes. For legacy buckets, interpolate
-- inside each bin using the all-success mean or the midpoint when unavailable.
create function private.duration_points(h integer[], counts jsonb, lo integer, hi integer, mean_ms numeric)
returns table(ms integer,n integer) language sql immutable parallel safe set search_path='' as $$
 with exact as materialized (
  select key::int ms,value::int n from jsonb_each_text(counts)
 ), coverage as (
  select (select sum(e.n) from exact e)=(select sum(x) from unnest(h) x) complete
 ), bins as (
  select greatest(0,lo,lower_ms+1) low,least(hi,upper_ms) high,b.n
  from private.hist_intervals(h) b where (select complete from coverage) is not true
 ), bounds as (
  select *,sum(low::numeric*n) over()/sum(n) over() mean_low,
   sum(high::numeric*n) over()/sum(n) over() mean_high from bins
 ), centers as (
  select *,low+(high-low)*least(1,greatest(0,coalesce((mean_ms-mean_low)/nullif(mean_high-mean_low,0),0.5))) center,
   case when lo is not null and hi is not null and low<high then least(n,33) else 1 end groups
  from bounds
 ), strata as (
  select low,high,center,c.n,g*c.n::bigint/groups first_rank,(g+1)*c.n::bigint/groups past_last
  from centers c cross join lateral generate_series(0,groups-1) g
 ), positions as (
  select *,coalesce((first_rank+past_last-1)::numeric/nullif(n-1,0),1) position from strata
 )
 select e.ms,e.n from exact e where (select complete from coverage)
 union all
 select round(case when position<=1 then low+(center-low)*position
              else center+(high-center)*(position-1) end)::int,(past_last-first_rank)::int
 from positions
$$;

-- percentile_cont over weighted millisecond values without expanding counts to rows.
create function private.duration_quantiles(durations integer[], counts bigint[], fractions numeric[])
returns double precision[] language sql immutable strict parallel safe set search_path='' as $$
 with ranks as (
  select ms,n,sum(n) over(order by ms rows unbounded preceding) last_rank,sum(n) over() total
  from unnest(durations,counts) points(ms,n)
 ), targets as (
  select fraction,ms,last_rank-n+1 first_rank,last_rank,1+(total-1)*fraction rank
  from ranks cross join unnest(fractions) fraction
 ), quantiles as (
  select fraction,max(ms) filter(where floor(rank) between first_rank and last_rank) low,
   max(ms) filter(where ceil(rank) between first_rank and last_rank) high,max(rank-floor(rank)) part
  from targets group by fraction
 )
 select array_agg((low+(high-low)*part)::double precision order by fraction) from quantiles
$$;
revoke all on function private.merge_duration_counts(jsonb,jsonb),
 private.duration_points(integer[],jsonb,integer,integer,numeric),
 private.duration_quantiles(integer[],bigint[],numeric[]) from public,anon,authenticated,service_role;

create or replace view private.speed_buckets as
 select s.*,case when s.failures+s.client_errors=0 then s.hist else b.success_hist end as success_hist,
  b.min_ms,b.max_ms,b.result_count,b.threshold_ms,b.slow_count,b.duration_counts,
  case when b.result_count=s.total-s.client_errors then b.min_ms end complete_min,
  case when b.result_count=s.total-s.client_errors then b.max_ms end complete_max,
  case when s.failures+s.client_errors=0 then s.duration_sum_ms::numeric/nullif(s.total,0) end mean_ms
 from public.stats_5m s left join private.evaluation_buckets b using(app_id,feature_id,version,bucket);

-- Computed field for the member dashboard. Read the stored row and authenticate
-- its owner even when the function is called directly with a composite argument.
create function public.success_durations(public.stats_5m) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(ms,n),'{}'::jsonb) from (
  select p.ms,sum(p.n) n from private.speed_buckets s
  join public.apps a on a.id=s.app_id and a.owner_id=(select auth.uid())
  cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
  where (s.app_id,s.feature_id,s.version,s.bucket)=(($1).app_id,($1).feature_id,($1).version,($1).bucket)
  group by p.ms
 ) points
$$;
revoke all on function public.success_durations(public.stats_5m) from public,anon,authenticated,service_role;
grant execute on function public.success_durations(public.stats_5m) to authenticated;

alter table public.baselines add column p95_ms integer;
update public.baselines b set p50_ms=null,p90_ms=null from public.features f
 where f.id=b.feature_id and f.method='*';

create or replace function private.refresh_baselines() returns void
language sql set search_path='' as $$
 with due as materialized (
  select f.id,f.kind,b.first_sample_at from public.features f left join public.baselines b on b.feature_id=f.id
  where f.method is distinct from '*' and (b.p95_ms is null or b.computed_at<=now()-interval '6 hours')
 ), outages as (
  select i.feature_id,i.opened_at,i.closed_at from public.incidents i join due on due.id=i.feature_id
  where i.kind in ('slow','failure') and (i.closed_at is null or i.closed_at>=now()-interval '7 days')
 ), deep as (
  select a.feature_id,count(*)::int n,min(a.ended_at) stamp,min(a.duration_ms) lo,max(a.duration_ms) hi,
   percentile_cont(array[0.5,0.9,0.95]) within group(order by a.duration_ms) quantiles
  from public.attempts a join due d on a.feature_id=d.id and d.kind='deep'
  where a.status='success' and a.duration_ms is not null and a.ended_at>=now()-interval '7 days' and a.ended_at<now()-interval '10 minutes'
   and not exists(select from outages i where i.feature_id=a.feature_id and a.ended_at>=i.opened_at
    and (i.closed_at is null or a.ended_at<i.closed_at))
  group by 1
 ), profiles as materialized (
  select s.feature_id,s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms,
   count(*) copies,min(s.bucket) stamp,min(s.min_ms) lo,max(s.max_ms) hi
  from private.speed_buckets s join due d on d.id=s.feature_id and d.kind='auto'
  where s.bucket>=now()-interval '7 days'
   and s.bucket<date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch') and s.success_hist is not null
   and not exists(select from outages i where i.feature_id=s.feature_id and s.bucket+interval '5 minutes'>i.opened_at
    and (i.closed_at is null or s.bucket<i.closed_at))
  group by 1,2,3,4,5,6
 ), points as (
  select s.feature_id,p.ms,sum(p.n*s.copies)::bigint n,min(s.stamp) stamp,min(s.lo) lo,max(s.hi) hi
  from profiles s cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
  group by 1,2
 ), auto as (
  select feature_id,sum(n)::int n,min(stamp) stamp,min(lo) lo,max(hi) hi,
   private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5,0.9,0.95]) quantiles
  from points group by feature_id
 ), observations as (
  select d.id,least(d.first_sample_at,s.stamp) first_stamp,coalesce(s.n,0) n,s.lo,s.hi,s.quantiles
  from due d left join (select * from deep union all select * from auto) s on s.feature_id=d.id
 )
 insert into public.baselines(feature_id,first_sample_at,sample_count,observed_min_ms,observed_max_ms,p50_ms,p90_ms,p95_ms,computed_at)
 select id,first_stamp,n,lo,hi,
  case when n>=30 then round(quantiles[1])::int end,case when n>=30 then round(quantiles[2])::int end,
  case when n>=30 then round(quantiles[3])::int end,now()
 from observations
 on conflict(feature_id) do update set first_sample_at=excluded.first_sample_at,sample_count=excluded.sample_count,
  observed_min_ms=excluded.observed_min_ms,observed_max_ms=excluded.observed_max_ms,
  p50_ms=excluded.p50_ms,p90_ms=excluded.p90_ms,p95_ms=excluded.p95_ms,computed_at=excluded.computed_at
$$;

create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), windows(kind,minutes) as (values ('failure',30),('slow',30),('slow',10)), active as materialized (
  select s.*,f.slow_threshold_ms from private.speed_buckets s join public.features f on f.id=s.feature_id and f.kind='auto'
  where s.bucket between date_bin('5 minutes',now()-interval '30 minutes',timestamptz 'epoch') and now()
 ), window_buckets as materialized (
  select s.*,k.kind,k.minutes from active s cross join windows k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket>=date_bin('5 minutes',now()-k.minutes*interval '1 minute',timestamptz 'epoch')
   + case when k.minutes=10 then interval '5 minutes' else interval '0' end
   and (c.closed_at is null or s.bucket>c.closed_at)
 ), points as (
  select s.feature_id,s.minutes,p.ms,sum(p.n)::bigint n
  from window_buckets s cross join lateral private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
  where s.kind='slow' group by 1,2,3
 ), medians as (
  select feature_id,minutes,sum(n) successes,
   (private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5]))[1] p50
  from points group by 1,2
 ), totals as (
  select s.feature_id,s.kind,s.minutes,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(case when s.threshold_ms=s.slow_threshold_ms and s.result_count=s.total-s.client_errors
     and (s.failures=0 or s.slow_count=0 or s.duration_counts is distinct from '{}'::jsonb) then s.slow_count
    else coalesce((select coalesce(sum(value::int) filter(where key::int>s.slow_threshold_ms),0)
     from jsonb_each_text(s.duration_counts) having sum(value::int)=s.total-s.client_errors-s.failures),
     private.hist_above(s.success_hist,s.slow_threshold_ms),0) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from window_buckets s group by 1,2,3
 ), auto as (
  select t.feature_id,t.kind,t.minutes,t.results,t.failures,t.results-t.failures timed,coalesce(m.successes,0) successes,m.p50,t.slow,
   t.latest,t.version,false as consecutive from totals t left join medians m
   on t.kind='slow' and m.feature_id=t.feature_id and m.minutes=t.minutes
 ), deep as (
  select a.feature_id,k.kind,k.minutes,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) filter(where status='success') timed,count(duration_ms) filter(where status='success') successes,
   percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where status='success' and duration_ms>f.slow_threshold_ms) slow,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] consecutive
  from public.attempts a join public.features f on f.id=a.feature_id and f.kind='deep' cross join windows k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where ended_at between now()-interval '30 minutes' and now() and ended_at>=now()-k.minutes*interval '1 minute'
   and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind,k.minutes,f.slow_threshold_ms
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), observations as (
  select r.*,(r.kind='slow' and r.minutes=10 and r.timed>=5 and r.slow*2>=r.timed) cap_breached
  from (select * from auto union all select * from deep) r
 ), recent as (
  select distinct on (r.feature_id,r.kind) r.* from observations r
  join public.features f on f.id=r.feature_id left join public.baselines b on b.feature_id=r.feature_id
  where r.minutes=10 or r.kind='failure' or (b.p95_ms is not null and f.method is distinct from '*')
  -- A sparse short-window cap breach has its own evidence and takes priority.
  order by r.feature_id,r.kind,(r.minutes=10 and (r.cap_breached or r.successes>=10)) desc,r.minutes desc
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then coalesce(r.cap_breached or
    (r.successes>=5 and b.p95_ms is not null and r.p50>b.p95_ms and r.p50>=b.p50_ms::bigint+500),false)
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/nullif(coalesce(b.p50_ms,f.slow_threshold_ms),0)
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures,'consecutive',r.consecutive)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'baseline_p50',b.p50_ms,
    'baseline_p95',b.p95_ms,'window',coalesce(r.minutes,10),'slow',r.slow,'threshold',f.slow_threshold_ms)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id and f.method is distinct from '*' left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';

create or replace function private.verification_progress(issue public.incidents)
returns table(version text,consecutive_successes integer,latest_duration_ms integer,latest_success boolean)
language sql stable set search_path='' as $$
 select v.version,coalesce(array_position(proof.qualified,false)-1,cardinality(proof.qualified),0) as streak,
  proof.durations[1],proof.successes[1]
 from public.app_versions v join public.features f on f.id=issue.feature_id
 left join public.baselines b on b.feature_id=f.id and f.method is distinct from '*'
 cross join lateral (
  -- A qualifying result must also be on the healthy side of the opening rule.
  select array_agg(success and (issue.kind<>'slow' or coalesce(ms<=least(f.slow_threshold_ms,
    b.p95_ms::bigint+500,greatest(b.p95_ms::bigint,b.p50_ms::bigint+499)),false))
    order by rank) qualified,array_agg(ms order by rank) durations,array_agg(success order by rank) successes
  from (
   select success,ms,row_number() over w as rank from (
    select a.result_received_at stamp,0::bigint position,a.status='success' success,a.duration_ms ms
    from public.attempts a where a.feature_id=f.id and a.version=v.version and a.status in ('success','failure')
     and a.result_received_at>issue.opened_at
    union all
    select r.received_at,r.position,r.success,r.ms
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

create or replace function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 signal record;
 issue public.incidents;
 recovered text;
 change text;
 comparison_severity numeric;
 metric jsonb;
 channels text[];
 events jsonb := '[]';
begin
 if not pg_try_advisory_xact_lock(62911006) then return events; end if;
 update public.attempts set status='unconfirmed' where status='pending' and ended_at is null
  and started_at<=now()-interval '10 minutes';
 perform private.refresh_baselines();
 for signal in select s.*,i.id open_id from private.evaluation_signals s
  left join public.incidents i on i.feature_id=s.feature_id and i.kind=s.kind and i.status='open'
  where s.breached or i.id is not null order by s.feature_id,s.kind loop
  change := null;
  metric := signal.metric || jsonb_build_object('severity',signal.severity);
  if signal.open_id is null then
   if exists(select from public.incidents i where i.feature_id=signal.feature_id and i.kind=signal.kind
    and (i.dismissed_until>now() or i.closed_at>=signal.latest)) then continue; end if;
   insert into public.incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open,metric_worst,last_notified_at)
    values(signal.app_id,signal.feature_id,signal.kind,'open',now(),signal.version,metric,metric,now()) returning * into issue;
   change := 'open';
  else
   select * into issue from public.incidents where id=signal.open_id and status='open' for update;
   if not found or issue.dismissed_until>now() then continue; end if;
   select p.version into recovered from private.verification_progress(issue) p where p.consecutive_successes=5;
   if recovered is not null then
    update public.incidents set status='resolved',resolved_version=recovered,closed_at=now(),last_notified_at=now()
     where id=issue.id;
    change := 'resolved';
   elsif signal.breached then
    if issue.kind='failure' and (issue.metric_at_open->>'severity')::numeric>0.5 then
     -- Express current failure count relative to its opening count on the original scale.
     signal.severity := (issue.metric_at_open->>'severity')::numeric *
      (signal.metric->>'failures')::numeric/(issue.metric_at_open->>'failures')::numeric;
    end if;
    metric := signal.metric || jsonb_build_object('severity',signal.severity);
    -- Compare repeat alerts on the opening scale, even across a baseline refresh
    -- or an incident opened by the previous threshold-based release.
    comparison_severity := case when issue.kind='slow' then
      (metric->>'p50')::numeric / nullif((issue.metric_at_open->>'p50')::numeric,0)
      * (issue.metric_at_open->>'severity')::numeric else signal.severity end;
    if comparison_severity>=2*(issue.metric_at_open->>'severity')::numeric
     and (issue.last_worse_severity is null or comparison_severity>issue.last_worse_severity)
     and issue.last_notified_at<=now()-interval '6 hours' then
     change := 'worse';
    end if;
    update public.incidents set below_since=null,
     last_worse_severity=case when change='worse' then comparison_severity else last_worse_severity end,
     metric_worst=case when (case when issue.kind='slow' then (metric->>'p50')::numeric>(metric_worst->>'p50')::numeric
       else signal.severity>(metric_worst->>'severity')::numeric end) then metric else metric_worst end,
     last_notified_at=case when change='worse' then now() else last_notified_at end where id=issue.id;
   elsif not exists(select from public.app_versions where app_id=issue.app_id and version<>issue.opened_version and last_seen_at>issue.opened_at) then
    if issue.below_since is null then
     update public.incidents set below_since=now() where id=issue.id;
    elsif issue.below_since<=now()-interval '2 hours' then
     update public.incidents set status='quiet',closed_at=now() where id=issue.id;
    end if;
   end if;
  end if;
  if change is not null then
   with queued as (
    insert into public.notifications(incident_id,channel,event,sent_at,ok)
    select issue.id,ch.name,change,null,null from public.apps a join public.alert_channels c on c.app_id=a.id
    cross join lateral (values ('slack',c.slack_webhook_secret_id is not null and not c.broken),('email',c.email_enabled or c.broken)) ch(name,enabled)
    where a.id=issue.app_id and ch.enabled returning channel
   ) select array(select channel from queued order by channel) into channels;
   events := events||jsonb_build_object('incident_id',issue.id,'app_id',issue.app_id,'feature_id',issue.feature_id,
    'kind',issue.kind,'event',change,'channels',channels);
  end if;
 end loop;
 return events;
end $$;
