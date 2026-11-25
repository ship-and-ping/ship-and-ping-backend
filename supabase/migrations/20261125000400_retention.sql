create function public.record_notification(incident_id uuid,channel text,event text,ok boolean,error text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare notification_id uuid;
begin
  insert into public.notifications(incident_id,channel,event,ok,error)
    values($1,$2,$3,$4,private.mask(regexp_replace($5,'https?://[^[:space:]]+','[가림]','gi')))
    returning id into notification_id;
  if $4 then update public.incidents set last_notified_at=now() where id=$1; end if;
  return notification_id;
end $$;
create function public.cleanup_daily() returns void language plpgsql security definer set search_path='' as $$
begin
  with expired as (
    delete from public.stats_5m where bucket < now()-interval '30 days' returning *
  )
  insert into public.stats_1h as s(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
    select app_id,feature_id,version,date_bin('1 hour',bucket,timestamptz 'epoch'),sum(total),sum(failures),sum(client_errors),
      sum(duration_sum_ms),private.sum_hist(hist)
    from expired group by 1,2,3,4
    on conflict(app_id,feature_id,version,bucket) do update set total=s.total+excluded.total,failures=s.failures+excluded.failures,
      client_errors=s.client_errors+excluded.client_errors,duration_sum_ms=s.duration_sum_ms+excluded.duration_sum_ms,
      hist=private.add_hist(s.hist,excluded.hist);
  delete from public.stats_1h where bucket < now()-interval '1 year';
  delete from public.error_samples where at < now()-interval '30 days';
  delete from public.attempts where coalesce(ended_at,started_at) < now()-interval '30 days';
  delete from public.notifications where sent_at < now()-interval '30 days';
  delete from public.incidents where status <> 'open' and coalesce(closed_at,opened_at) < now()-interval '30 days';
  delete from public.ingest_batches where received_at < now()-interval '24 hours';
end $$;
revoke all on function public.record_notification(uuid,text,text,boolean,text),public.cleanup_daily() from public,anon,authenticated,service_role;
grant execute on function public.record_notification(uuid,text,text,boolean,text),public.cleanup_daily() to service_role;
