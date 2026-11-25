create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  url text, first_record_at timestamptz, created_at timestamptz not null default now()
);
create index on public.apps(owner_id);
create table public.app_keys (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps on delete cascade,
  kind text not null check (kind in ('pub','srv')),
  prefix text not null, key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz, revoked_at timestamptz
);
create index on public.app_keys(app_id,kind);
create table public.features (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps on delete cascade,
  kind text not null check (kind in ('auto','deep')),
  route text, method text, feature_key text,
  name text not null, name_source text not null default 'route' check (name_source in ('route','suggested','confirmed')),
  start_definition text, success_definition text,
  slow_threshold_ms integer not null default 5000 check (slow_threshold_ms > 0),
  hidden boolean not null default false, created_at timestamptz not null default now(),
  unique(app_id,method,route), unique(app_id,feature_key), unique(app_id,id),
  check (case kind when 'auto' then method is not null and route is not null and feature_key is null
                   else method is null and route is null and feature_key is not null end)
);

-- Lock the parent before counting sibling rows, including direct service inserts.
create function private.limit_features() returns trigger language plpgsql set search_path='' as $$
declare limit_count integer := case new.kind when 'deep' then 5 else 200 end;
begin
  perform 1 from public.apps where id=new.app_id for update;
  if (select count(*) from public.features where app_id=new.app_id and kind=new.kind
      and method is distinct from '*') > limit_count then
    raise exception 'feature limit exceeded' using errcode='23514';
  end if;
  return null;
end $$;
alter table public.features add check (method is distinct from '*' or route='*');
create trigger feature_limit after insert or update of app_id,kind,method on public.features
for each row execute function private.limit_features();

create table public.app_versions (
  app_id uuid references public.apps on delete cascade, version text,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  primary key(app_id,version)
);
create function private.valid_hist(h integer[], n integer) returns boolean
language sql immutable set search_path='' as $$
  select array_ndims(h)=1 and array_lower(h,1)=1 and cardinality(h)=16 and
    (select count(x)=16 and min(x)>=0 and sum(x)=n from unnest(h) x)
$$;
create table public.stats_5m (
  app_id uuid not null,
  feature_id uuid not null,
  version text not null,
  bucket timestamptz not null check (bucket = date_bin(interval '5 minutes',bucket,timestamptz 'epoch')),
  total integer not null check (total >= 0),
  failures integer not null check (failures >= 0),
  client_errors integer not null check (client_errors >= 0 and failures::bigint + client_errors <= total),
  duration_sum_ms bigint not null check (duration_sum_ms >= 0),
  hist integer[] not null check (private.valid_hist(hist,total)),
  primary key (app_id,feature_id,version,bucket),
  foreign key (app_id,feature_id) references public.features(app_id,id) on delete cascade,
  foreign key (app_id,version) references public.app_versions on delete cascade
);
create index on public.stats_5m(app_id,feature_id,bucket desc);
create table public.stats_1h (
  app_id uuid not null,
  feature_id uuid not null,
  version text not null,
  bucket timestamptz not null check (bucket = date_bin(interval '1 hour',bucket,timestamptz 'epoch')),
  total integer not null check (total >= 0),
  failures integer not null check (failures >= 0),
  client_errors integer not null check (client_errors >= 0 and failures::bigint + client_errors <= total),
  duration_sum_ms bigint not null check (duration_sum_ms >= 0),
  hist integer[] not null check (private.valid_hist(hist,total)),
  primary key (app_id,feature_id,version,bucket),
  foreign key (app_id,feature_id) references public.features(app_id,id) on delete cascade,
  foreign key (app_id,version) references public.app_versions on delete cascade
);
create index on public.stats_1h(app_id,feature_id,bucket desc);
create table public.attempts (
  app_id uuid, attempt_id uuid, feature_id uuid not null, version text not null,
  started_at timestamptz, ended_at timestamptz,
  status text not null check (status in ('pending','success','failure','abandon','unconfirmed')),
  source text check(source in ('server','browser')), step text, error_kind text, duration_ms integer check(duration_ms>=0),
  primary key(app_id,attempt_id), foreign key(app_id,feature_id) references public.features(app_id,id) on delete cascade,
  foreign key(app_id,version) references public.app_versions on delete cascade,
  check(started_at is not null or ended_at is not null)
);
create table public.error_samples (
  id uuid primary key default gen_random_uuid(), app_id uuid not null, feature_id uuid not null, version text not null,
  at timestamptz not null, error_kind text, message text check(length(message)<=300),
  foreign key(app_id,feature_id) references public.features(app_id,id) on delete cascade,
  foreign key(app_id,version) references public.app_versions on delete cascade
);
create index on public.error_samples(feature_id,version,at desc,id desc);
create table public.baselines (
  feature_id uuid primary key references public.features on delete cascade,
  p50_ms integer, p90_ms integer, sample_count integer not null, observed_min_ms integer, observed_max_ms integer,
  computed_at timestamptz not null default now()
);
create table public.incidents (
  id uuid primary key default gen_random_uuid(), app_id uuid not null, feature_id uuid not null,
  kind text not null check(kind in ('failure','slow','unconfirmed')),
  status text not null check(status in ('open','resolved','quiet','dismissed')),
  opened_at timestamptz not null, closed_at timestamptz, opened_version text not null, resolved_version text,
  metric_at_open jsonb, metric_worst jsonb, last_notified_at timestamptz, dismissed_until timestamptz,
  foreign key(app_id,feature_id) references public.features(app_id,id) on delete cascade
);
create index on public.incidents(app_id,feature_id);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), incident_id uuid not null references public.incidents on delete cascade,
  channel text not null check(channel in ('slack','email')), event text not null check(event in ('open','worse','resolved')),
  sent_at timestamptz not null default now(), ok boolean not null, error text
);
create index on public.notifications(incident_id);
create table public.alert_channels (
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  slack_webhook_secret_id uuid references vault.secrets(id) on delete set null, slack_channel_name text,
  email_enabled boolean not null default true
);
create table public.ingest_batches (
  app_id uuid references public.apps on delete cascade, batch_id uuid, received_at timestamptz not null default now(),
  primary key(app_id,batch_id)
);
create index on public.ingest_batches(received_at);
create table public.feature_map_suggestions (
  id uuid primary key default gen_random_uuid(), app_id uuid not null references public.apps on delete cascade,
  method text not null, route text not null, name text not null, received_at timestamptz not null default now(),
  applied boolean not null default false, unique(app_id,method,route)
);
