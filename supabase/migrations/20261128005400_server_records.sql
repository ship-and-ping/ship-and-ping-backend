-- Service writes enter through the existing app/key lock. Member reads use app RLS.
create function private.profile_label(v jsonb,lim integer) returns boolean
language sql immutable strict set search_path='' as $$
  select jsonb_typeof(v)='string' and length(s) between 1 and lim and s=btrim(s)
    and (s collate "C" ~ '^[a-zA-Z0-9가-힣 +#-]+$' or s in ('Node.js','Next.js','Nuxt.js','Vue.js','.NET','ASP.NET'))
    and s=private.mask(s) and s !~* '(sk-|glpat-|github_pat_|ghp_|xox[baprs]-|bearer |basic |[A-Za-z0-9]{24})'
  from (select v#>>'{}' s) input
$$;
create function private.valid_profile(p jsonb) returns boolean
language plpgsql immutable strict set search_path='' as $$
declare f record; s jsonb;
begin
  if jsonb_typeof(p)<>'object' or p='{}' then return false; end if;
  for f in select * from jsonb_each(p) loop
    case
    when f.key='services' then
      if jsonb_typeof(f.value)<>'array' then return false; end if;
      if jsonb_array_length(f.value)>40 then return false; end if;
      for s in select value from jsonb_array_elements(f.value) loop
        if jsonb_typeof(s)<>'object' or not(s ?& array['feature','name','kind'])
          or s-array['feature','name','kind']<>'{}' or not private.profile_label(s->'feature',40)
          or not private.profile_label(s->'name',40) or jsonb_typeof(s->'kind')<>'string'
          or s->>'kind' not in ('map','payment','ai','mail','storage','other') then return false; end if;
      end loop;
    when f.key in ('plan','database') then
      if jsonb_typeof(f.value)<>'string' or (f.key='plan' and f.value#>>'{}' not in ('free','paid','unknown'))
        or (f.key='database' and f.value#>>'{}' not in ('postgres','mysql','sqlite','mongo','none','other')) then return false; end if;
    when f.key in ('cpu_cores','memory_gb') then
      if jsonb_typeof(f.value)<>'number' then return false; end if;
      if (f.value#>>'{}')::numeric not between 0.001 and 65536 then return false; end if;
    when f.key in ('language','framework','hosting','deploy','rollback','metrics') then
      if not private.profile_label(f.value,case f.key when 'rollback' then 80 when 'metrics' then 120 else 40 end) then return false; end if;
    else return false;
    end case;
  end loop;
  return true;
end $$;

create function private.valid_resources(r jsonb) returns boolean language plpgsql immutable strict set search_path='' as $$
declare f record; n numeric;
begin
  if jsonb_typeof(r)<>'object' then return false; end if;
  for f in select * from jsonb_each(r) loop
    if jsonb_typeof(f.value)<>'number' then return false; end if;
    n := (f.value#>>'{}')::numeric;
    if n<0 or not (case
      when f.key in ('process_cpu_pct','system_cpu_pct','steal_pct','mem_used_pct') then n<=100
      when f.key in ('gc_pause_ms','event_loop_lag_ms') then n<=60000
      when f.key in ('busy_threads','db_pool_in_use','db_pool_max') then n=trunc(n) and n<=1000000
      else false end) then return false; end if;
  end loop;
  return coalesce((r->>'db_pool_in_use')::numeric <= (r->>'db_pool_max')::numeric,true);
end $$;
revoke all on function private.profile_label(jsonb,integer),private.valid_profile(jsonb),private.valid_resources(jsonb)
  from public,anon,authenticated,service_role;

create table public.app_profiles (
  app_id uuid primary key references public.apps on delete cascade,
  profile jsonb not null check(private.valid_profile(profile)), updated_at timestamptz not null default now(),
  history jsonb not null default '[]' check (jsonb_array_length(history) <= 5)
);
create table public.server_minutes (
  app_id uuid references public.apps on delete cascade, bucket timestamptz,
  last_received timestamptz not null, version text not null, resources jsonb check(private.valid_resources(resources)),
  primary key(app_id,bucket)
);
create index server_minutes_expiry on public.server_minutes(bucket);
create table public.server_hours (
  app_id uuid references public.apps on delete cascade, bucket timestamptz,
  peaks jsonb not null, primary key(app_id,bucket)
);
create table public.feature_timing_5m (
  app_id uuid, feature_id uuid, version text, bucket timestamptz,
  db_ms_sum bigint not null, db_ms_count bigint not null,
  external_ms_sum bigint not null, external_ms_count bigint not null,
  primary key(app_id,feature_id,version,bucket),
  foreign key(app_id,feature_id,version,bucket)
    references public.stats_5m(app_id,feature_id,version,bucket) on delete cascade
);
do $$
declare t text;
begin
  foreach t in array array['app_profiles','server_minutes','server_hours','feature_timing_5m'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy owned_app on public.%I for select to authenticated
      using (app_id in (select id from public.apps))',t);
  end loop;
end $$;
grant delete on public.app_profiles to authenticated;
create policy delete_own on public.app_profiles for delete to authenticated
  using (app_id in (select id from public.apps));

create function public.write_app_profile(app_key_hash text,profile jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.app_keys := private.lock_key(app_key_hash);
begin
  if private.valid_profile($2) is not true then raise exception 'invalid profile' using errcode='22023'; end if;
  insert into public.app_profiles as p(app_id,profile) values(k.app_id,$2)
  on conflict(app_id) do update set profile=excluded.profile, updated_at=now(),
    history=(select jsonb_agg(value order by pos) from jsonb_array_elements(
      jsonb_build_array(jsonb_build_object('profile',p.profile,'at',p.updated_at)) || p.history)
      with ordinality h(value,pos) where pos<=5)
    where p.profile is distinct from excluded.profile;
  return jsonb_build_object('accepted',1,'dropped',0);
end $$;
revoke all on function public.write_app_profile(text,jsonb) from public,anon,authenticated;
grant execute on function public.write_app_profile(text,jsonb) to service_role;

alter function public.ingest_batch(text,jsonb) rename to ingest_before_resources;
alter function public.ingest_before_resources(text,jsonb) set schema private;
revoke all on function private.ingest_before_resources(text,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  k public.app_keys := private.lock_key(app_key_hash);
  duplicate boolean := exists(select from public.ingest_batches b where b.app_id=k.app_id and b.batch_id=(payload->>'batch_id')::uuid);
  result jsonb := private.ingest_before_resources(app_key_hash,payload);
  received timestamptz := clock_timestamp();
  item jsonb;
  feature uuid;
  version_name text := trim(payload->>'app_version');
begin
  if duplicate then return result; end if;
  if payload ? 'resources' then
    if k.kind <> 'srv' or payload->>'platform' is distinct from 'server'
      or private.valid_resources(payload->'resources') is not true then
      raise exception 'invalid resources' using errcode='22023';
    end if;
  end if;
  if (result->>'accepted')::int>0 or payload ? 'resources' then
    insert into public.server_minutes as m(app_id,bucket,last_received,version,resources)
      values(k.app_id,date_trunc('minute',received),received,version_name,payload->'resources')
    on conflict(app_id,bucket) do update set last_received=excluded.last_received,version=excluded.version,
      resources=coalesce(m.resources,excluded.resources);
  end if;
  if payload ? 'resources' then
    result := jsonb_set(result,'{accepted}',to_jsonb((result->>'accepted')::int+1));
    update public.apps set first_record_at=received where id=k.app_id and first_record_at is null;
  end if;
  for item in select value from jsonb_array_elements(payload->'stats')
    where (value->>'db_ms_count')::int>0 or (value->>'external_ms_count')::int>0 loop
    feature := private.auto_feature(k.app_id,item->>'method',item->>'route');
    insert into public.feature_timing_5m as t values(k.app_id,feature,version_name,(item->>'bucket')::timestamptz,
      coalesce((item->>'db_ms_sum')::bigint,0),coalesce((item->>'db_ms_count')::int,0),
      coalesce((item->>'external_ms_sum')::bigint,0),coalesce((item->>'external_ms_count')::int,0))
    on conflict(app_id,feature_id,version,bucket) do update set
      db_ms_sum=t.db_ms_sum+excluded.db_ms_sum, db_ms_count=t.db_ms_count+excluded.db_ms_count,
      external_ms_sum=t.external_ms_sum+excluded.external_ms_sum, external_ms_count=t.external_ms_count+excluded.external_ms_count;
  end loop;
  return result;
end $$;
revoke all on function public.ingest_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_batch(text,jsonb) to service_role;

-- Retain the full boundary hour until all its minutes have aged out.
create function public.rollup_server_hours() returns void
language sql security definer set search_path='' as $$
  with moved as (delete from public.server_minutes where bucket<date_trunc('hour',now()-interval '7 days')
    returning app_id,bucket,resources), metrics as (
    select app_id,date_trunc('hour',bucket) hour,key,max(value::numeric) peak
    from moved cross join lateral jsonb_each_text(resources) group by 1,2,3
  )
  insert into public.server_hours(app_id,bucket,peaks)
    select app_id,hour,jsonb_object_agg(key,peak) from metrics group by 1,2;
  delete from public.server_hours where bucket<now()-interval '30 days';
$$;
revoke all on function public.rollup_server_hours() from public,anon,authenticated;
grant execute on function public.rollup_server_hours() to service_role;

-- Return peak values per equal time slice (the same slices as the dashboard).
create function public.server_series(target_app uuid, since timestamptz, until_at timestamptz, slices integer)
returns table(slot integer, peaks jsonb)
language sql stable security invoker set search_path='' as $$
  with samples as (
    select bucket,resources from public.server_minutes where app_id=target_app and bucket between since and until_at
    union all select bucket,h.peaks from public.server_hours h where app_id=target_app and bucket between since and until_at
  ), metrics as (
    select least(slices-1,floor(extract(epoch from (bucket-since))*slices/
      nullif(extract(epoch from (until_at-since)),0))::integer) i,key,max(value::numeric) peak
    from samples cross join lateral jsonb_each_text(resources)
    where slices between 1 and 168 and until_at>since group by 1,2
  )
  select i,jsonb_object_agg(key,peak) from metrics group by i order by i;
$$;
revoke all on function public.server_series(uuid,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.server_series(uuid,timestamptz,timestamptz,integer) to authenticated;

create function public.incident_server_context(incident_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('profile',p.profile,'since',i.opened_at,'until',coalesce(i.closed_at,now()),
    'peaks',(select s.peaks from public.server_series(i.app_id,i.opened_at,coalesce(i.closed_at,now()),1) s))
  from public.incidents i left join public.app_profiles p on p.app_id=i.app_id where i.id=incident_id;
$$;
revoke all on function public.incident_server_context(uuid) from public,anon;
grant execute on function public.incident_server_context(uuid) to authenticated;
