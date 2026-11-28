create index on private.queue_success_5m(app_id,feature_id,bucket);
create or replace view private.latency_profiles as
 select q.app_id,q.feature_id,q.bucket,q.version,true inclusive,q.hist,q.counts,q.lo,q.hi,
   q.sum_ms::numeric/nullif(q.n,0) mean_ms,q.slow_count,q.threshold_ms
 from private.queue_success_5m q where q.n>0
 union all
 select s.app_id,s.feature_id,s.bucket,s.version,false,
     case when q.n is null then s.success_hist else private.add_hist(s.success_hist,
     array(select -v from unnest(q.hist) v)) end,
     case when q.n is null then s.duration_counts when s.duration_counts is not null and q.counts is not null
     then (select coalesce(jsonb_object_agg(key,n),'{}') from (
       select key,value::int-coalesce((q.counts->>key)::int,0) n from jsonb_each_text(s.duration_counts)
     ) d where n>0) end,
     case when q.n is null then s.complete_min end,case when q.n is null then s.complete_max end,
     case when q.n is null then s.mean_ms when s.failures+s.client_errors=0
       then (s.duration_sum_ms-q.sum_ms)::numeric/nullif(s.total-q.n,0) end,
     s.slow_count-coalesce(q.slow_count,0),
     case when s.result_count=s.total-s.client_errors
       and (q.n is null or q.threshold_ms=s.threshold_ms)
       and (s.failures=0 or s.slow_count=0 or s.duration_counts is distinct from '{}'::jsonb)
       then s.threshold_ms end
 from private.speed_buckets s
 left join private.queue_success_5m q using(app_id,feature_id,version,bucket)
 left join public.feature_timing_5m t using(app_id,feature_id,version,bucket)
 where s.total-s.client_errors-s.failures>coalesce(q.n,0) and s.success_hist is not null
     -- Pre-upgrade mixed timing aggregates don't identify individual successes.
     and (q.n is not null or (coalesce(t.queue_count,0)=0 and exists(
       select from private.queue_success_5m seen where seen.feature_id=s.feature_id)));

-- A constant distribution with complete exact counts has one weighted point.
create function private.baseline_points(h int[], counts jsonb, lo int, hi int, mean_ms numeric)
returns table(ms int,n int) language plpgsql immutable parallel safe set search_path='' as $$
declare weight bigint;
begin
 if lo=hi and counts ? lo::text then
  select sum(v) into weight from unnest(h) v;
  if weight between 1 and 2147483647 and counts=jsonb_build_object(lo::text,weight) then
   return query select lo,weight::int;
   return;
  end if;
 end if;
 return query select p.ms,p.n from private.duration_points(h,counts,lo,hi,mean_ms) p;
end $$;
revoke all on function private.baseline_points(int[],jsonb,int,int,numeric) from public,anon,authenticated,service_role;

create function private.refresh_app_legacy(target_app uuid) returns void
language sql set search_path='' as $$
 with due as materialized (
  select f.id,f.kind,b.first_sample_at from public.features f left join public.baselines b on b.feature_id=f.id
  where (target_app is null or f.app_id=target_app) and f.method is distinct from '*'
    and not exists(select from private.queue_success_5m q where q.feature_id=f.id)
    and (b.p95_ms is null or b.computed_at<=now()-interval '6 hours')
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
  where (target_app is null or s.app_id=target_app) and s.bucket>=now()-interval '7 days'
   and s.bucket<date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch') and s.success_hist is not null
   and not exists(select from outages i where i.feature_id=s.feature_id and s.bucket+interval '5 minutes'>i.opened_at
    and (i.closed_at is null or s.bucket<i.closed_at))
  group by 1,2,3,4,5,6
 ), points as (
  select s.feature_id,p.ms,sum(p.n*s.copies)::bigint n,min(s.stamp) stamp,min(s.lo) lo,max(s.hi) hi
  from profiles s cross join lateral private.baseline_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
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

create function private.refresh_app_baselines(target_app uuid) returns void language plpgsql set search_path='' as $$
begin
 perform private.refresh_app_legacy(target_app);
 with due as materialized (
   select f.id feature_id,mode.inclusive from public.features f cross join (values(true),(false)) mode(inclusive)
   left join private.latency_baselines b on b.feature_id=f.id and b.inclusive=mode.inclusive
   where (target_app is null or f.app_id=target_app) and f.method<>'*' and exists(select from private.queue_success_5m q where q.feature_id=f.id)
     and (b.feature_id is null or b.next_check_at<=now())
 ), profiles as materialized (
   -- Collapse repeated five-minute distributions before expanding their points.
   select p.feature_id,p.inclusive,p.hist,p.counts,p.lo,p.hi,p.mean_ms,count(*) copies,min(p.bucket) first_at
   from due join private.latency_profiles p using(feature_id,inclusive)
   where (target_app is null or p.app_id=target_app) and p.bucket>=now()-interval '7 days'
     and p.bucket<date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch')
     and not exists(select from public.incidents i where i.feature_id=p.feature_id and i.kind in ('failure','slow')
       and p.bucket+interval '5 minutes'>i.opened_at and (i.closed_at is null or p.bucket<i.closed_at))
   group by 1,2,3,4,5,6,7
 ), points as (
   select p.feature_id,p.inclusive,d.ms,sum(d.n*p.copies)::bigint n,min(p.first_at) first_at
   from profiles p cross join lateral private.baseline_points(p.hist,p.counts,p.lo,p.hi,p.mean_ms) d group by 1,2,3
 ), summaries as (
   select feature_id,inclusive,sum(n) n,min(ms) lo,max(ms) hi,min(first_at) first_at,
     case when sum(n)>=30 then private.duration_quantiles(array_agg(ms order by ms),array_agg(n order by ms),array[0.5,0.9,0.95]) end p
   from points group by 1,2
 ), pending as (
   select p.feature_id,p.inclusive,min(p.bucket)+interval '15 minutes' eligible_at
   from due join private.latency_profiles p using(feature_id,inclusive)
   where (target_app is null or p.app_id=target_app) and p.bucket between date_bin('5 minutes',now()-interval '10 minutes',timestamptz 'epoch') and now()
   group by 1,2
 ), refreshed as (
   insert into private.latency_baselines as b(feature_id,inclusive,n,lo,hi,p50,p90,p95,first_at,computed_at,next_check_at)
   select d.feature_id,d.inclusive,coalesce(s.n,0),s.lo,s.hi,round(s.p[1]),round(s.p[2]),round(s.p[3]),s.first_at,now(),
     least(now()+interval '6 hours',case when coalesce(s.n,0)<30 then pending.eligible_at end)
   from due d left join summaries s using(feature_id,inclusive) left join pending using(feature_id,inclusive)
   on conflict(feature_id,inclusive) do update set n=excluded.n,lo=excluded.lo,hi=excluded.hi,
     p50=excluded.p50,p90=excluded.p90,p95=excluded.p95,first_at=excluded.first_at,computed_at=excluded.computed_at,
     next_check_at=excluded.next_check_at returning *
 )
 insert into public.baselines(feature_id,sample_count,p50_ms,p90_ms,p95_ms,observed_min_ms,observed_max_ms,first_sample_at,computed_at)
 select feature_id,n,p50,p90,p95,lo,hi,first_at,computed_at from refreshed where inclusive
 on conflict(feature_id) do update set sample_count=excluded.sample_count,p50_ms=excluded.p50_ms,p90_ms=excluded.p90_ms,
   p95_ms=excluded.p95_ms,observed_min_ms=excluded.observed_min_ms,observed_max_ms=excluded.observed_max_ms,
   first_sample_at=excluded.first_sample_at,computed_at=excluded.computed_at;
end $$;

create or replace function private.refresh_baselines() returns void language plpgsql set search_path='' as $$
declare app uuid;
begin
 for app in select id from public.apps order by id loop
   begin
     perform private.refresh_app_baselines(app);
   exception when data_exception or integrity_constraint_violation then
     raise warning 'Skipping invalid baseline inputs for app %, SQLSTATE %',app,sqlstate;
   end;
 end loop;
end $$;
revoke all on function private.refresh_app_legacy(uuid),private.refresh_app_baselines(uuid) from public,anon,authenticated,service_role;
