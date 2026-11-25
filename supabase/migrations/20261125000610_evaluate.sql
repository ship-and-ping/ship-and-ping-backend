-- Older all-success buckets still carry a usable success histogram.
create view private.speed_buckets as
 select s.*,case when s.failures+s.client_errors=0 then s.hist else b.success_hist end as success_hist,
  b.min_ms,b.max_ms,b.result_count,b.threshold_ms,b.slow_count,b.tail
 from public.stats_5m s left join private.evaluation_buckets b using(app_id,feature_id,version,bucket);

create function private.refresh_baselines() returns void
language sql set search_path='' as $$
 with due as materialized (
  select f.id,b.first_sample_at from public.features f left join public.baselines b on b.feature_id=f.id
  where b.p50_ms is null or b.computed_at<=now()-interval '6 hours'
 ), deep_bins as (
  select a.feature_id,private.duration_bin(a.duration_ms) bin,count(*)::int n,
   min(a.ended_at) stamp,min(a.duration_ms) lo,max(a.duration_ms) hi
  from public.attempts a join due d on a.feature_id=d.id
  where a.status='success' and a.duration_ms is not null and a.ended_at between now()-interval '7 days' and now()
  group by 1,2
 ), samples as (
  select s.feature_id,s.bucket as stamp,s.success_hist h,s.min_ms,s.max_ms
  from private.speed_buckets s join due d on s.feature_id=d.id
  where s.bucket between now()-interval '7 days' and now()
  union all
  select feature_id,stamp,array(select case when i=bin then n else 0 end
    from generate_series(1,16) i order by i),lo,hi from deep_bins
 ), totals as (
  select feature_id,private.sum_hist(h) h,min(min_ms) lo,max(max_ms) hi,min(stamp) first_recent
  from samples group by feature_id
 ), older as (
  select s.feature_id,sum(s.total-s.failures-s.client_errors) n,min(s.min_ms) lo,max(s.max_ms) hi,min(bucket) first_stamp
  from private.speed_buckets s join due d on d.id=s.feature_id where bucket<now()-interval '7 days' group by 1
  union all
  select a.feature_id,count(*),min(duration_ms),max(duration_ms),min(ended_at)
  from public.attempts a join due d on d.id=a.feature_id
  where ended_at<now()-interval '7 days' and status='success' group by 1
  union all
  select s.feature_id,sum(total-failures-client_errors),null,null,min(bucket)
  from public.stats_1h s join due d on d.id=s.feature_id group by 1
 ), history as (
  select feature_id,sum(n) n,min(lo) lo,max(hi) hi,min(first_stamp) first_stamp from older group by 1
 ), observations as (
  select d.id,t.h,least(t.lo,h.lo) lo,greatest(t.hi,h.hi) hi,
   coalesce((select sum(n) from unnest(t.h) n),0)::int recent_n,coalesce(h.n,0)::int older_n,
   least(d.first_sample_at,t.first_recent,h.first_stamp,
     case when d.first_sample_at is null then (select min(bucket) from public.stats_5m where feature_id=d.id) end,
     case when d.first_sample_at is null then (select min(started_at) from public.attempts where feature_id=d.id) end,
     case when d.first_sample_at is null then (select min(ended_at) from public.attempts where feature_id=d.id) end) first_stamp
  from due d left join totals t on t.feature_id=d.id left join history h on h.feature_id=d.id
 ), eligible as (
  select *,recent_n+older_n>=30 and first_stamp<=now()-interval '3 days' and recent_n>0 ready from observations
 )
 insert into public.baselines(feature_id,first_sample_at,sample_count,observed_min_ms,observed_max_ms,p50_ms,p90_ms,computed_at)
 select id,first_stamp,case when ready then recent_n else recent_n+older_n end,lo,hi,
  case when ready then private.hist_percentile(h,0.5) end,
  case when ready then private.hist_percentile(h,0.9) end,now()
 from eligible where first_stamp<=now()
 on conflict(feature_id) do update set first_sample_at=excluded.first_sample_at,sample_count=excluded.sample_count,
  observed_min_ms=excluded.observed_min_ms,observed_max_ms=excluded.observed_max_ms,
  p50_ms=excluded.p50_ms,p90_ms=excluded.p90_ms,computed_at=excluded.computed_at
$$;

-- One row per feature and signal, including signals currently below threshold.
create view private.evaluation_signals as
 with auto as (
  select s.feature_id,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(s.total) timed,private.hist_percentile(private.sum_hist(s.hist),0.5) p50,
   sum(case when s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else (select coalesce(sum(n),0) from unnest(s.hist) with ordinality bins(n,pos)
          where pos>private.duration_bin(f.slow_threshold_ms)) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from private.speed_buckets s join public.features f on f.id=s.feature_id
  where s.bucket between now()-interval '30 minutes' and now() group by s.feature_id
 ), deep as (
  select a.feature_id,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,percentile_disc(0.5) within group(order by duration_ms) p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] streak,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version
  from public.attempts a join public.features f on f.id=a.feature_id
  where ended_at between now()-interval '30 minutes' and now() and status in ('success','failure') group by a.feature_id
 ), missing as (
  select feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts where started_at between now()-interval '1 hour' and now() group by feature_id
 ), recent as (
  select *,false as consecutive from auto
  union all select feature_id,results,failures,timed,p50,slow,latest,version,streak from deep
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then r.timed>=5 and case when b.p50_ms is null then r.slow*2>=r.timed else r.p50>=2*b.p50_ms end
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then case when b.p50_ms is null then r.slow::numeric/nullif(r.timed,0) else r.p50::numeric/nullif(b.p50_ms,0) end
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'slow',r.slow)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id left join recent r on r.feature_id=f.id
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';

create function private.recovery_version(issue public.incidents) returns text
language sql stable set search_path='' as $$
 select v.version from public.app_versions v join public.features f on f.id=issue.feature_id
 left join public.baselines b on b.feature_id=f.id
 cross join lateral (
  select count(*)=5 and bool_and(success and (issue.kind<>'slow' or ms<=coalesce(b.p50_ms*1.5,f.slow_threshold_ms))) recovered
  from (
   select success,ms from (
    select a.ended_at stamp,a.status='success' success,a.duration_ms ms
    from public.attempts a where a.feature_id=f.id and a.version=v.version and a.status in ('success','failure')
     and a.ended_at between issue.opened_at and now()
    union all
    select (t->>0)::timestamptz,(t->>2)::boolean,(t->>1)::int
    from private.speed_buckets s cross join lateral jsonb_array_elements(
     case when s.result_count=s.total-s.client_errors then s.tail else
      -- Legacy mixed buckets have unknown ordering. A failure breaks the streak.
      to_jsonb(array_fill(jsonb_build_array(s.bucket,private.hist_percentile(s.hist,1),s.failures=0),
       array[least(5,s.total-s.client_errors)])) end
    ) t where s.feature_id=f.id and s.version=v.version and s.bucket>=date_bin('5 minutes',issue.opened_at,'epoch')
   ) events where stamp between issue.opened_at and now() order by stamp desc,success,ms desc limit 5
  ) last_results
 ) proof
 where v.app_id=issue.app_id and v.first_seen_at>issue.opened_at and v.first_seen_at<=now() and proof.recovered
 order by v.first_seen_at,v.version limit 1
$$;

create function public.evaluate_all() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 signal record;
 issue public.incidents;
 recovered text;
 change text;
 metric jsonb;
 channel_name text;
 events jsonb := '[]';
begin
 if not pg_try_advisory_xact_lock(62911006) then return events; end if;
 update public.attempts set status='unconfirmed' where status='pending' and ended_at is null
  and started_at<=now()-interval '10 minutes';
 perform private.refresh_baselines();
 for signal in select s.*,i.id open_id from private.evaluation_signals s
  left join public.incidents i on i.feature_id=s.feature_id and i.kind=s.kind and i.status='open'
  where s.breached or i.id is not null order by s.feature_id,s.kind loop
  change := null;
  metric := signal.metric || jsonb_build_object('severity',signal.severity);
  if signal.open_id is null then
   if exists(select from public.incidents i where i.feature_id=signal.feature_id and i.kind=signal.kind
    and (i.dismissed_until>now() or i.closed_at>=signal.latest)) then continue; end if;
   insert into public.incidents(app_id,feature_id,kind,status,opened_at,opened_version,metric_at_open,metric_worst,last_notified_at)
    values(signal.app_id,signal.feature_id,signal.kind,'open',now(),signal.version,metric,metric,now()) returning * into issue;
   change := 'open';
  else
   select * into issue from public.incidents where id=signal.open_id and status='open' for update;
   if not found or issue.dismissed_until>now() then continue; end if;
   recovered := private.recovery_version(issue);
   if recovered is not null then
    update public.incidents set status='resolved',resolved_version=recovered,closed_at=now(),last_notified_at=now()
     where id=issue.id;
    change := 'resolved';
   elsif signal.breached then
    if signal.severity>=2*(issue.metric_at_open->>'severity')::numeric
     and (issue.last_worse_severity is null or signal.severity>issue.last_worse_severity)
     and issue.last_notified_at<=now()-interval '6 hours' then
     change := 'worse';
    end if;
    update public.incidents set below_since=null,
     last_worse_severity=case when change='worse' then signal.severity else last_worse_severity end,
     metric_worst=case when signal.severity>(metric_worst->>'severity')::numeric then metric else metric_worst end,
     last_notified_at=case when change='worse' then now() else last_notified_at end where id=issue.id;
   elsif not exists(select from public.app_versions where app_id=issue.app_id and first_seen_at>issue.opened_at) then
    if issue.below_since is null then
     update public.incidents set below_since=now() where id=issue.id;
    elsif issue.below_since<=now()-interval '2 hours' then
     update public.incidents set status='quiet',closed_at=now() where id=issue.id;
    end if;
   end if;
  end if;
  if change is not null then
   select case when c.slack_webhook_secret_id is not null then 'slack'
    when coalesce(c.email_enabled,true) then 'email' end into channel_name
   from public.apps a left join public.alert_channels c on c.owner_id=a.owner_id where a.id=issue.app_id;
   if channel_name is not null then
    insert into public.notifications(incident_id,channel,event,sent_at,ok) values(issue.id,channel_name,change,null,null);
   end if;
   events := events||jsonb_build_object('incident_id',issue.id,'app_id',issue.app_id,'feature_id',issue.feature_id,
    'kind',issue.kind,'event',change,'channel',channel_name);
  end if;
 end loop;
 return events;
end $$;
revoke all on function public.evaluate_all() from public,anon,authenticated,service_role;
grant execute on function public.evaluate_all() to service_role;
