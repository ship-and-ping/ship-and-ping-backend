create function private.rollup_5m(as_of timestamptz) returns void
language sql set search_path = '' as $$
  -- Only rows removed by this transaction contribute. Their evaluation inputs
  -- expire with them via the foreign key; those counts overlap the stats.
  with expired as (
    delete from public.stats_5m where bucket < as_of - interval '7 days'
    returning *
  )
  insert into public.stats_1h as s
    (app_id, feature_id, version, bucket, total, failures, client_errors, duration_sum_ms, hist)
  select app_id, feature_id, version, date_bin('1 hour', bucket, timestamptz 'epoch'),
    sum(total), sum(failures), sum(client_errors), sum(duration_sum_ms), private.sum_hist(hist)
  from expired group by 1, 2, 3, 4
  on conflict (app_id, feature_id, version, bucket) do update set
    total = s.total + excluded.total,
    failures = s.failures + excluded.failures,
    client_errors = s.client_errors + excluded.client_errors,
    duration_sum_ms = s.duration_sum_ms + excluded.duration_sum_ms,
    hist = private.add_hist(s.hist, excluded.hist);
$$;
revoke all on function private.rollup_5m(timestamptz) from public, anon, authenticated, service_role;

create or replace function private.cleanup_daily() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rollup_5m(now());
  delete from public.stats_1h where bucket < now()-interval '1 year';
  delete from public.error_samples where at < now()-interval '30 days';
  delete from public.attempts where coalesce(ended_at,started_at) < now()-interval '30 days';
  delete from public.notifications where sent_at < now()-interval '30 days';
  delete from public.incidents where status <> 'open' and coalesce(closed_at,opened_at) < now()-interval '30 days';
  delete from public.ingest_batches where received_at < now()-interval '24 hours';
end $$;
