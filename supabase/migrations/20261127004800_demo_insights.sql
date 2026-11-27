-- Keep successful durations identifiable when mixed five-minute buckets become hours.
-- An all-success hour can use its existing histogram, including pre-migration rows.
alter table public.stats_1h add column success_hist integer[];

create or replace function private.rollup_5m(as_of timestamptz) returns void
language sql set search_path = '' as $$
 with expired as (
  delete from public.stats_5m where bucket < as_of - interval '7 days' returning *
 ), hours as (
  select e.app_id,e.feature_id,e.version,date_bin('1 hour',e.bucket,timestamptz 'epoch') bucket,
   sum(e.total) total,sum(e.failures) failures,sum(e.client_errors) client_errors,
   sum(e.duration_sum_ms) duration_sum_ms,private.sum_hist(e.hist) hist,
   case when sum(e.failures+e.client_errors)>0 then private.sum_hist(
    case when e.failures+e.client_errors=0 then e.hist else b.success_hist end) end success_hist
  from expired e left join private.evaluation_buckets b using(app_id,feature_id,version,bucket)
  group by 1,2,3,4
 )
 insert into public.stats_1h as s
  (app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist,success_hist)
 select * from hours
 on conflict (app_id,feature_id,version,bucket) do update set
  total=s.total+excluded.total,failures=s.failures+excluded.failures,
  client_errors=s.client_errors+excluded.client_errors,duration_sum_ms=s.duration_sum_ms+excluded.duration_sum_ms,
  hist=private.add_hist(s.hist,excluded.hist),
  success_hist=case when s.failures+s.client_errors+excluded.failures+excluded.client_errors>0 then
   (select private.sum_hist(h) from (values
    (case when s.failures+s.client_errors=0 then s.hist else s.success_hist end),
    (case when excluded.failures+excluded.client_errors=0 then excluded.hist else excluded.success_hist end)
   ) parts(h)) end
$$;

-- The chart and this RPC share T46's successful timings and its fallback for older buckets.
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
 ), profiles as materialized (
  select s.feature_id,s.version,s.bucket>=now()-interval '1 hour' recent,
   s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms,count(*) copies,sum(s.failures) failed
  from private.speed_buckets s join features f on f.id=s.feature_id and f.kind='auto'
  where s.app_id=target_app and s.bucket between now()-interval '30 days' and now()
   and (s.bucket>=now()-interval '1 hour' or s.version in (select v.version from versions v))
  group by 1,2,3,4,5,6,7,8
 ), attempts as materialized (
  select a.feature_id,a.version,a.ended_at>=now()-interval '1 hour' recent,a.duration_ms,a.status,count(*) n
  from public.attempts a join features f on f.id=a.feature_id and f.kind='deep'
  where a.app_id=target_app and a.ended_at between now()-interval '30 days' and now()
   and a.status in ('success','failure')
   and (a.ended_at>=now()-interval '1 hour' or a.version in (select v.version from versions v))
  group by 1,2,3,4,5
 ), points as materialized (
  select s.feature_id,s.version,s.recent,p.ms,p.n*s.copies n
  from profiles s cross join lateral
   private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
  where s.success_hist is not null
  union all select h.feature_id,h.version,false,p.ms,p.n from public.stats_1h h
  join features f on f.id=h.feature_id and f.kind='auto'
  join versions v on v.version=h.version
  cross join lateral private.duration_points(
   case when h.failures+h.client_errors=0 then h.hist else h.success_hist end,null,null,null,
   case when h.failures+h.client_errors=0 then h.duration_sum_ms::numeric/nullif(h.total,0) end) p
  where h.app_id=target_app and h.bucket between now()-interval '30 days' and now()
  union all select a.feature_id,a.version,a.recent,a.duration_ms,a.n from attempts a
  where a.status='success' and a.duration_ms is not null
 ), hourly as (
  select p.feature_id,sum(p.n) measured,sum(p.n) filter(where p.ms<=f.p95_ms) fast
  from points p join features f on f.id=p.feature_id where p.recent group by 1
 ), failed as (
  select r.feature_id,sum(r.n)::bigint n from (
   select s.feature_id,s.failed n from profiles s where s.recent
   union all select a.feature_id,a.n from attempts a where a.recent and a.status='failure'
  ) r group by 1
 ), grouped as (
  select p.feature_id,v.pos,p.ms,sum(p.n)::bigint n
  from points p join versions v on v.version=p.version group by 1,2,3
 ), medians as (
  select g.feature_id,g.pos,sum(g.n)::bigint n,
   (private.duration_quantiles(array_agg(g.ms order by g.ms),array_agg(g.n order by g.ms),array[0.5]))[1]::numeric ms
  from grouped g group by 1,2
 )
 select f.id,case when f.p95_ms is not null then coalesce(h.fast,0)::bigint end,coalesce(h.measured,0)::bigint,
  coalesce(e.n,0),prev.ms,cur.ms,coalesce(prev.n,0),coalesce(cur.n,0)
 from features f left join hourly h on h.feature_id=f.id left join failed e on e.feature_id=f.id
 left join medians prev on prev.feature_id=f.id and prev.pos=2
 left join medians cur on cur.feature_id=f.id and cur.pos=1 order by f.id;
end $$;
revoke all on function public.demo_insights(uuid) from public,anon,authenticated,service_role;
grant execute on function public.demo_insights(uuid) to authenticated;
