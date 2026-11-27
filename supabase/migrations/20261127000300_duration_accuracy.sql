-- The new layout retains every legacy upper bound and splits (3000,7500] at
-- 300 ms intervals. Array length identifies the format, including during rollout.
create function private.duration_bounds(size integer) returns integer[]
language sql immutable strict parallel safe set search_path='' as $$
 select case size when 16 then private.duration_bounds() when 30 then
  array[50,100,200,300,500,750,1000,1500,2000,3000,
   3300,3600,3900,4200,4500,4800,5000,5100,5400,5700,6000,6300,6600,6900,7200,7500,
   10000,20000,30000,600000] end
$$;

create function private.duration_bin(ms integer,size integer) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select least(size,width_bucket(ms-1,private.duration_bounds(size))+1)
$$;

create or replace function private.valid_hist(h integer[], n integer) returns boolean
language sql immutable set search_path='' as $$
 select array_ndims(h)=1 and array_lower(h,1)=1 and cardinality(h) in (16,30) and
  (select count(x)=cardinality(h) and min(x)>=0 and sum(x)=n from unnest(h) x)
$$;

-- At a mixed-format merge put legacy counts at their original upper bounds.
-- Keeping legacy-only sums at length 16 also preserves the retention wire format.
create function private.expand_hist(h integer[]) returns integer[]
language sql immutable strict parallel safe set search_path='' as $$
 select case when cardinality(h)=16 then
  h[1:10] || array_fill(0,array[6]) || h[11:11] || array_fill(0,array[8]) || h[12:16]
 else h end
$$;

create or replace function private.add_hist(a integer[],b integer[]) returns integer[]
language plpgsql immutable strict set search_path='' as $$
begin
 if cardinality(a)<>cardinality(b) then
  a := private.expand_hist(a);
  b := private.expand_hist(b);
 end if;
 return array(select a[i]+b[i] from generate_subscripts(a,1) i order by i);
end $$;

create or replace function private.hist_percentile(h integer[],fraction numeric) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select (private.duration_bounds(cardinality(h)))[pos] from (
  select pos,n,sum(n) over(order by pos) as running,sum(n) over() as total
  from unnest(h) with ordinality as bins(n,pos)
 ) b where n>0 and running>=fraction*total order by pos limit 1
$$;

create function private.hist_above(h integer[],threshold_ms integer) returns bigint
language sql immutable strict parallel safe set search_path='' as $$
 select coalesce(sum(n),0) from unnest(h) with ordinality bins(n,pos)
 where pos>private.duration_bin(threshold_ms,cardinality(h))
$$;

revoke all on function private.duration_bounds(integer), private.duration_bin(integer,integer),
 private.expand_hist(integer[]), private.hist_above(integer[],integer) from public,anon,authenticated,service_role;

create or replace function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
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
   min(ms) filter(where success),max(ms) filter(where success),count(success),count(*) filter(where success is not null and ms>threshold),
   threshold
  from timings
  on conflict(app_id,feature_id,version,bucket) do update set
   success_hist=private.add_hist(b.success_hist,excluded.success_hist),
   min_ms=least(b.min_ms,excluded.min_ms),max_ms=greatest(b.max_ms,excluded.max_ms),
   result_count=b.result_count+excluded.result_count,slow_count=b.slow_count+excluded.slow_count,
   threshold_ms=case when b.threshold_ms=excluded.threshold_ms then b.threshold_ms else -1 end;
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
-- The exact over-threshold count still takes precedence over the histogram fallback.
create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), kinds(kind) as (values ('failure'),('slow')), auto as (
  select s.feature_id,k.kind,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(s.total-s.client_errors) timed,private.hist_percentile(private.sum_hist(s.success_hist),0.5) p50,
   sum(case when s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else coalesce(private.hist_above(case when s.client_errors=0 then s.hist else s.success_hist end,f.slow_threshold_ms),0) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from private.speed_buckets s join public.features f on f.id=s.feature_id and f.kind='auto' cross join kinds k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket between now()-interval '30 minutes' and now()
   and (c.closed_at is null or s.bucket>c.closed_at) group by s.feature_id,k.kind
 ), deep as (
  select a.feature_id,k.kind,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] streak,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version
  from public.attempts a join public.features f on f.id=a.feature_id and f.kind='deep' cross join kinds k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where ended_at between now()-interval '30 minutes' and now() and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), recent as (
  select *,false as consecutive from auto
  union all select feature_id,kind,results,failures,timed,p50,slow,latest,version,streak from deep
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then r.timed>=5 and case when b.p50_ms is null then r.slow*2>=r.timed else r.p50>=2*b.p50_ms end
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/f.slow_threshold_ms
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures,'consecutive',r.consecutive)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'slow',r.slow,'threshold',f.slow_threshold_ms)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';
