create table public.stats_1d (
  app_id uuid not null,
  feature_id uuid not null,
  version text not null,
  bucket timestamptz not null check (bucket = date_trunc('day',bucket,'Asia/Seoul')),
  total integer not null check (total >= 0),
  failures integer not null check (failures >= 0),
  client_errors integer not null check (client_errors >= 0 and failures::bigint + client_errors <= total),
  duration_sum_ms bigint not null check (duration_sum_ms >= 0),
  hist integer[] not null check (private.valid_hist(hist,total)),
  primary key (app_id,feature_id,version,bucket),
  foreign key (app_id,feature_id) references public.features(app_id,id) on delete cascade,
  foreign key (app_id,version) references public.app_versions on delete cascade
);
create index on public.stats_1d(app_id,feature_id,bucket desc);

alter table public.stats_1d enable row level security;
revoke all on public.stats_1d from public, anon, authenticated, service_role;
grant select on public.stats_1d to authenticated, grafana_reader;
create policy owned_app on public.stats_1d for select to authenticated
  using (app_id in (select id from public.apps));
create policy metrics on public.stats_1d for select to grafana_reader using (true);

create or replace function private.cleanup_daily() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rollup_5m(now());
  with expired as (
    delete from public.stats_1h where bucket < now() - interval '720 hours'
    returning *
  )
  insert into public.stats_1d as s
    (app_id, feature_id, version, bucket, total, failures, client_errors, duration_sum_ms, hist)
  select app_id, feature_id, version, date_trunc('day',bucket,'Asia/Seoul'),
    sum(total), sum(failures), sum(client_errors), sum(duration_sum_ms), private.sum_hist(hist)
  from expired group by 1, 2, 3, 4
  on conflict (app_id, feature_id, version, bucket) do update set
    total = s.total + excluded.total,
    failures = s.failures + excluded.failures,
    client_errors = s.client_errors + excluded.client_errors,
    duration_sum_ms = s.duration_sum_ms + excluded.duration_sum_ms,
    hist = private.add_hist(s.hist, excluded.hist);

  delete from public.stats_1d where bucket <
    (date_trunc('day',now() at time zone 'Asia/Seoul') - interval '1 year') at time zone 'Asia/Seoul';
  delete from public.error_samples where at < now()-interval '30 days';
  delete from public.attempts where coalesce(ended_at,started_at) < now()-interval '30 days';
  delete from public.notifications where sent_at < now()-interval '30 days';
  delete from public.incidents where status <> 'open' and coalesce(closed_at,opened_at) < now()-interval '30 days';
  delete from public.ingest_batches where received_at < now()-interval '24 hours';
end $$;
