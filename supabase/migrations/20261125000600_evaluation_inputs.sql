-- stats_5m.hist includes failures and client errors. Keep a success-only
-- histogram, exact extrema, threshold count and a bounded per-version tail.
-- The bounded tail contains only a timestamp, duration and success flag.
create function private.duration_bounds() returns integer[]
language sql immutable parallel safe set search_path='' as $$
 select array[50,100,200,300,500,750,1000,1500,2000,3000,5000,7500,10000,20000,30000,600000]
$$;
create function private.duration_bin(ms integer) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select least(16,width_bucket(ms-1,private.duration_bounds())+1)
$$;
create function private.hist_percentile(h integer[], fraction numeric) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select (private.duration_bounds())[pos] from (
  select pos,sum(n) over(order by pos) as running,sum(n) over() as total
  from unnest(h) with ordinality as bins(n,pos)
 ) b where total>0 and running>=fraction*total order by pos limit 1
$$;
create function private.last_five(items jsonb) returns jsonb
language sql immutable strict set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_array(stamp,ms,success) order by stamp desc,success,ms desc),'[]') from (
  select (item->>0)::timestamptz stamp,(item->>2)::boolean success,(item->>1)::int ms
  from jsonb_array_elements(items) item where item->>2 is not null order by stamp desc,success,ms desc limit 5
 ) latest
$$;
create table private.evaluation_buckets (
 app_id uuid, feature_id uuid, version text, bucket timestamptz,
 success_hist integer[] not null, min_ms integer,max_ms integer,
 result_count integer not null, slow_count integer not null, threshold_ms integer not null,
 primary key(app_id,feature_id,version,bucket),
 foreign key(app_id,feature_id,version,bucket) references public.stats_5m on delete cascade
);
create table private.latest_results (
 app_id uuid, feature_id uuid, version text, bucket timestamptz not null, tail jsonb not null,
 primary key(app_id,feature_id,version),
 foreign key(app_id,feature_id,version,bucket) references public.stats_5m on delete cascade
);
create index on public.stats_5m(feature_id,bucket);
create index on public.attempts(feature_id,ended_at);
create index on public.attempts(feature_id,started_at);
create index on public.attempts(started_at) where status='pending';
alter function public.ingest_batch(text,jsonb) set schema private;
revoke all on function private.ingest_batch(text,jsonb) from public,anon,authenticated,service_role;

create function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 result jsonb := private.ingest_batch(app_key_hash,payload);
 app uuid;
 item jsonb;
 feature uuid;
 threshold integer;
begin
 -- The original function owns the per-app lock and returns zero for retries.
 if (result->>'accepted')::integer=0 then return result; end if;
 select app_id into strict app from public.app_keys where key_hash=app_key_hash;
 for item in select value from jsonb_array_elements(payload->'stats') where value ? 'timings' loop
  feature := private.auto_feature(app,item->>'method',item->>'route');
  select slow_threshold_ms into strict threshold from public.features where id=feature;
  insert into private.evaluation_buckets as b
  with timings as materialized (
   select (t->>1)::integer ms,(t->>2)::boolean success from jsonb_array_elements(item->'timings') t
  ), bins as (
   select private.duration_bin(ms) bin,count(*) n from timings where success group by 1
  )
  select app,feature,trim(payload->>'app_version'),(item->>'bucket')::timestamptz,
   array(select coalesce(n,0)::integer from generate_series(1,16) g left join bins on g=bin order by g),
   min(ms) filter(where success),max(ms) filter(where success),count(success),count(*) filter(where ms>threshold),
   threshold
  from timings
  on conflict(app_id,feature_id,version,bucket) do update set
   success_hist=private.add_hist(b.success_hist,excluded.success_hist),
   min_ms=least(b.min_ms,excluded.min_ms),max_ms=greatest(b.max_ms,excluded.max_ms),
   result_count=b.result_count+excluded.result_count,slow_count=b.slow_count+excluded.slow_count,
   threshold_ms=case when b.threshold_ms=excluded.threshold_ms then b.threshold_ms else -1 end;
  insert into private.latest_results as r
   select app,feature,trim(payload->>'app_version'),(item->>'bucket')::timestamptz,tail
   from (select private.last_five(item->'timings') tail) batch where tail<>'[]'::jsonb
   on conflict(app_id,feature_id,version) do update set
    bucket=greatest(r.bucket,excluded.bucket),tail=private.last_five(r.tail||excluded.tail);
 end loop;
 return result;
end $$;
revoke all on function public.ingest_batch(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_batch(text,jsonb) to service_role;

alter table public.baselines add column first_sample_at timestamptz;
alter table public.incidents add column below_since timestamptz;
alter table public.incidents add column last_worse_severity numeric;
create unique index incidents_one_open on public.incidents(feature_id,kind) where status='open';
-- sent_at/ok are null until T8 completes a delivery.
alter table public.notifications alter column sent_at drop not null, alter column ok drop not null;
alter table public.notifications add column queued_at timestamptz not null default now();
create index on public.notifications(queued_at) where sent_at is null;
