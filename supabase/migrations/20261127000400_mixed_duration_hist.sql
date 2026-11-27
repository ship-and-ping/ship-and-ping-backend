-- A mixed histogram has 30 refined counters followed by the two legacy
-- counters whose intervals were subdivided: (3000,5000] and (5000,7500].
create or replace function private.expand_hist(h integer[]) returns integer[]
language sql immutable strict parallel safe set search_path='' as $$
 select case cardinality(h)
  when 16 then h[1:10] || array_fill(0,array[16]) || h[13:16] || h[11:12]
  when 30 then h || array[0,0]
  else h end
$$;

create or replace function private.valid_hist(h integer[], n integer) returns boolean
language sql immutable set search_path='' as $$
 select array_ndims(h)=1 and array_lower(h,1)=1 and cardinality(h) in (16,30,32) and
  (select count(x)=cardinality(h) and min(x)>=0 and sum(x)=n from unnest(h) x)
$$;

create or replace function private.add_hist(a integer[],b integer[]) returns integer[]
language plpgsql immutable strict set search_path='' as $$
declare merged integer[];
begin
 if cardinality(a)<>cardinality(b) then
  a := private.expand_hist(a);
  b := private.expand_hist(b);
 end if;
 merged := array(select a[i]+b[i] from generate_subscripts(a,1) i order by i);
 if cardinality(merged)=32 and merged[31]=0 and merged[32]=0 then
  return merged[1:30];
 end if;
 return merged;
end $$;

create function private.hist_intervals(h integer[])
returns table(lower_ms integer,upper_ms integer,n integer)
language sql immutable strict parallel safe set search_path='' as $$
 select case pos when 31 then 3000 when 32 then 5000 else coalesce(edges[pos-1],-1) end,
        case pos when 31 then 5000 when 32 then 7500 else edges[pos] end,n
 from unnest(h) with ordinality bins(n,pos)
 cross join (select private.duration_bounds(least(cardinality(h),30)) edges) layout
 where n>0
$$;
revoke all on function private.hist_intervals(integer[]) from public,anon,authenticated,service_role;

create or replace function private.hist_percentile(h integer[],fraction numeric) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select upper_ms from (
  select upper_ms,sum(n) over(order by upper_ms) running,sum(n) over() total
  from private.hist_intervals(h)
 ) bins where running>=fraction*total order by upper_ms limit 1
$$;

create or replace function private.hist_above(h integer[],threshold_ms integer) returns bigint
language sql immutable strict parallel safe set search_path='' as $$
 select coalesce(sum(n),0) from private.hist_intervals(h) where lower_ms>=threshold_ms
$$;

-- Keep the established ingest transaction (including idempotency and locks).
-- Translate only the optional refined field before passing it the payload.
alter function public.ingest_batch(text,jsonb) rename to ingest_duration_batch;
alter function public.ingest_duration_batch(text,jsonb) set schema private;
revoke all on function private.ingest_duration_batch(text,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- The two trailing counters are produced only by database rollups.
 if payload @? '$.stats[*].hist ? (@.size() == 32)'
    or payload @? '$.stats[*].hist_30 ? (@.type() != "array" || @.size() != 30)' then
  raise exception 'invalid histogram layout' using errcode='22023';
 end if;
 if payload @? '$.stats[*].hist_30' then
  payload := jsonb_set(payload,'{stats}',(
   select jsonb_agg(case when item ? 'hist_30' then jsonb_set(item,'{hist}',item->'hist_30')
                    else item end order by pos)
   from jsonb_array_elements(payload->'stats') with ordinality stats(item,pos)
  ));
 end if;
 return private.ingest_duration_batch(app_key_hash,payload);
end $$;
revoke all on function public.ingest_batch(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_batch(text,jsonb) to service_role;
