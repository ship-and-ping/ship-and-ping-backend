alter table public.feature_timing_5m
 add column queue_ms_sum bigint not null default 0,
 add column queue_total_ms bigint not null default 0,
 add column queue_count bigint not null default 0,
 add check(queue_ms_sum between 0 and queue_total_ms and queue_total_ms between 0 and queue_count*600000);

-- Short-lived, aggregate counters only. Feature IDs are globally unique.
create table private.request_flow_seconds (
 feature_id uuid references public.features on delete cascade,
 stamp timestamptz, completed bigint not null check(completed>=0),
 interrupted bigint not null check(interrupted>=0), primary key(feature_id,stamp)
);
create index request_flow_expiry on private.request_flow_seconds(stamp);
revoke all on private.request_flow_seconds from public,anon,authenticated,service_role;

alter function public.ingest_batch(text,jsonb) rename to ingest_before_queue;
alter function public.ingest_before_queue(text,jsonb) set schema private;
revoke all on function private.ingest_before_queue(text,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_batch(app_key_hash text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 k public.app_keys := private.lock_key(app_key_hash);
 duplicate boolean := exists(select from public.ingest_batches where app_id=k.app_id and batch_id=(payload->>'batch_id')::uuid);
 result jsonb := private.ingest_before_queue(app_key_hash,payload);
 item jsonb;
 feature uuid;
 bucket_at timestamptz;
begin
 if duplicate then return result; end if;
 for item in select value from jsonb_array_elements(payload->'stats')
   where (value->>'queue_count')::int>0 or value ? 'flow' loop
   feature := private.auto_feature(k.app_id,item->>'method',item->>'route');
   bucket_at := (item->>'bucket')::timestamptz;
   if (item->>'queue_count')::int>0 then
     insert into public.feature_timing_5m as t
       (app_id,feature_id,version,bucket,db_ms_sum,db_ms_count,external_ms_sum,external_ms_count,
        queue_ms_sum,queue_total_ms,queue_count)
     values(k.app_id,feature,trim(payload->>'app_version'),bucket_at,0,0,0,0,
       (item->>'queue_ms_sum')::bigint,(item->>'queue_total_ms')::bigint,(item->>'queue_count')::bigint)
     on conflict(app_id,feature_id,version,bucket) do update set
       queue_ms_sum=t.queue_ms_sum+excluded.queue_ms_sum,queue_total_ms=t.queue_total_ms+excluded.queue_total_ms,
       queue_count=t.queue_count+excluded.queue_count;
   end if;
   insert into private.request_flow_seconds as s
     select feature,to_timestamp(key::bigint),(value->>0)::int,(value->>1)::int
     from jsonb_each(item->'flow')
     where to_timestamp(key::bigint) between now()-interval '6 minutes' and now()+interval '2 seconds'
       and date_bin('5 minutes',to_timestamp(key::bigint),timestamptz 'epoch')=bucket_at
     on conflict(feature_id,stamp) do update set
       completed=s.completed+excluded.completed,interrupted=s.interrupted+excluded.interrupted;
 end loop;
 return result;
end $$;
revoke all on function public.ingest_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_batch(text,jsonb) to service_role;

-- Evaluate sliding 10-second windows containing an interruption. Keep only
-- candidates whose preceding three minutes each sustained >=30 completions.
create view private.stalled_features as
 with candidates as materialized (
   select distinct feature_id,stamp-n*interval '1 second' start_at
   from private.request_flow_seconds cross join generate_series(0,9) n
   where interrupted>0 and stamp between now()-interval '100 seconds' and now()
 ), gaps as (
   select c.*,g.n from candidates c cross join lateral (
     select sum(interrupted) n from private.request_flow_seconds
     where feature_id=c.feature_id and stamp>=c.start_at and stamp<c.start_at+interval '10 seconds'
     having sum(completed)=0 and sum(interrupted)>=3
   ) g where c.start_at+interval '10 seconds'<=now()
 )
 select distinct on (g.feature_id) g.feature_id,g.start_at,g.n::bigint interruptions
 from gaps g where not exists (
   select from generate_series(1,3) m where
     (select coalesce(sum(completed),0) from private.request_flow_seconds
      where feature_id=g.feature_id and stamp>=g.start_at-m*interval '1 minute'
      and stamp<g.start_at-(m-1)*interval '1 minute')<30
 ) and exists(select from private.request_flow_seconds where feature_id=g.feature_id
     and completed>0 and stamp between g.start_at-interval '5 seconds' and g.start_at-interval '1 second')
 order by g.feature_id,g.n desc,g.start_at desc;

alter view private.evaluation_signals rename to evaluation_before_queue;
create view private.evaluation_signals as
 select s.app_id,s.feature_id,s.kind,s.breached or g.interruptions is not null breached,
   case when g.interruptions is not null then greatest(s.severity,1) else s.severity end severity,
   s.metric || jsonb_strip_nulls(jsonb_build_object('queue_ms',round(q.wait_ms/nullif(q.samples,0)),
     'queue_pct',round(100*q.wait_ms/nullif(q.total_ms,0)),'interruptions',g.interruptions,
     'stall_at',g.start_at)) metric,s.version,greatest(s.latest,g.start_at) latest
 from private.evaluation_before_queue s left join private.stalled_features g
 on g.feature_id=s.feature_id and s.kind='failure'
 left join lateral (
   select sum(t.queue_ms_sum) wait_ms,sum(t.queue_total_ms) total_ms,sum(t.queue_count) samples
   from public.feature_timing_5m t where t.app_id=s.app_id and t.feature_id=s.feature_id
   and t.bucket between date_bin('5 minutes',now()-coalesce((s.metric->>'window')::int,30)*interval '1 minute',
     timestamptz 'epoch') + case when s.metric->>'window'='10' then interval '5 minutes' else interval '0' end and now()
 ) q on true;
revoke all on private.evaluation_signals,private.stalled_features from public,anon,authenticated,service_role;

-- Reuse the existing minute cron to expire counters even when ingest stops.
alter function public.evaluate_silence() rename to evaluate_app_silence;
alter function public.evaluate_app_silence() set schema private;
revoke all on function private.evaluate_app_silence() from public,anon,authenticated,service_role;
create function public.evaluate_silence() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from private.request_flow_seconds where stamp<now()-interval '6 minutes';
 perform private.evaluate_app_silence();
end $$;
revoke all on function public.evaluate_silence() from public,anon,authenticated;
grant execute on function public.evaluate_silence() to service_role;

-- A completed stall may precede the cron that opened the incident. Include
-- its actual minute in T54's resource evidence (minutes are stored floored).
create or replace function public.incident_server_context(incident_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with bounds as (
   select i.*,least(i.opened_at,date_trunc('minute',(i.metric_at_open->>'stall_at')::timestamptz)) start_at,
     coalesce(i.closed_at,now()) until_at from public.incidents i where i.id=incident_id
 )
 select jsonb_build_object('profile',p.profile,'since',i.start_at,'until',i.until_at,
   'peaks',(select s.peaks from public.server_series(i.app_id,i.start_at,i.until_at,1) s))
 from bounds i left join public.app_profiles p on p.app_id=i.app_id;
$$;
