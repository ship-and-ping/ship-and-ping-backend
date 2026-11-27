-- Read the same successful timings as the baseline. Public stats_5m.hist
-- includes failures and client errors and cannot be used for this percentage.
create function public.demo_insights(target_app uuid)
returns table(feature_id uuid, fast bigint, measured bigint, failures bigint,
 previous_ms numeric, current_ms numeric, previous_n bigint, current_n bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select from public.apps a where a.id=target_app and a.owner_id=auth.uid()) then
  raise exception 'app access denied' using errcode='42501';
 end if;
 return query
 with versions as (
  select v.version,row_number() over(order by v.first_seen_at desc,v.version) pos
  from public.app_versions v where v.app_id=target_app order by v.first_seen_at desc,v.version limit 2
 ), features as (
  select f.id,f.kind,b.p95_ms from public.features f left join public.baselines b on b.feature_id=f.id
  where f.app_id=target_app and not f.hidden
 ), auto_hist as (
  select s.feature_id,s.version,private.sum_hist(s.success_hist) h,
   private.sum_hist(s.success_hist) filter(where s.bucket>=now()-interval '1 hour') recent,
   sum(s.failures) filter(where s.bucket>=now()-interval '1 hour') failed
  from private.speed_buckets s join features f on f.id=s.feature_id and f.kind='auto'
  where s.app_id=target_app and s.bucket between now()-interval '7 days' and now()
   and (s.bucket>=now()-interval '1 hour' or s.version in (select v.version from versions v))
  group by s.feature_id,s.version
 ), results as (
  select a.feature_id,a.version,
   (select sum(i.n) from private.hist_intervals(a.recent) i where i.upper_ms<=f.p95_ms) quick,
   (select sum(i.n) from private.hist_intervals(a.recent) i) timed,a.failed,
   private.hist_percentile(a.h,0.5)::numeric median,(select sum(i.n) from private.hist_intervals(a.h) i) n
  from auto_hist a join features f on f.id=a.feature_id
  union all
  select a.feature_id,a.version,
   count(*) filter(where a.ended_at>=now()-interval '1 hour' and a.status='success' and a.duration_ms<=f.p95_ms),
   count(a.duration_ms) filter(where a.ended_at>=now()-interval '1 hour' and a.status='success'),
   count(*) filter(where a.ended_at>=now()-interval '1 hour' and a.status='failure'),
   (percentile_cont(0.5) within group(order by a.duration_ms) filter(where a.status='success'))::numeric,
   count(a.duration_ms) filter(where a.status='success')
  from public.attempts a join features f on f.id=a.feature_id and f.kind='deep'
  where a.app_id=target_app and a.ended_at between now()-interval '7 days' and now()
   and (a.ended_at>=now()-interval '1 hour' or a.version in (select v.version from versions v))
  group by a.feature_id,a.version
 )
 select f.id,case when f.p95_ms is not null then coalesce(sum(r.quick),0)::bigint end,
  coalesce(sum(r.timed),0)::bigint,coalesce(sum(r.failed),0)::bigint,
  max(r.median) filter(where v.pos=2),max(r.median) filter(where v.pos=1),
  coalesce(max(r.n) filter(where v.pos=2),0),coalesce(max(r.n) filter(where v.pos=1),0)
 from features f left join results r on r.feature_id=f.id left join versions v on v.version=r.version
 group by f.id,f.p95_ms order by f.id;
end $$;
revoke all on function public.demo_insights(uuid) from public,anon,authenticated,service_role;
grant execute on function public.demo_insights(uuid) to authenticated;
