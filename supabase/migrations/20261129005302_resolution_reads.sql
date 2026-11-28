create or replace function public.incident_verification(incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 issue public.incidents;
 progress record;
begin
 select i.* into issue from public.incidents i join public.apps a on a.id=i.app_id
 where i.id=$1 and a.owner_id=auth.uid();
 if not found then raise exception 'incident unavailable' using errcode='42501'; end if;
 select * into progress from private.verification_progress(issue);
 return jsonb_build_object('version',progress.version,'consecutive_successes',coalesce(progress.consecutive_successes,0),
  'latest_duration_ms',progress.latest_duration_ms,'latest_success',progress.latest_success) || private.volume_comparison(issue);
end $$;

create or replace function public.mcp_read(p_hash text,p_tool text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k private.ai_keys; stamp timestamptz; span interval; item uuid; issue public.incidents; data jsonb;
begin
 select * into k from private.ai_keys where key_hash=p_hash for update;
 stamp:=clock_timestamp();
 if k.id is null or k.revoked_at is not null or k.expires_at<=stamp then return '{"status":401}'; end if;
 if (select count(*) from private.ai_access where key_id=k.id and used_at>stamp-interval '1 minute')>=60 then
  return '{"status":429}';
 end if;
 if p_tool is null or p_tool not in ('initialize','notifications/initialized','server/discover','ping','tools/list','invalid',
  'list_apps','get_status','list_incidents','get_incident','get_feature_metrics','get_server_metrics','check_resolution') then
  p_tool:='invalid';
 end if;
 insert into private.ai_access values(k.id,p_tool,stamp);
 update private.ai_keys set last_used_at=stamp where id=k.id;
 if p_tool in ('get_feature_metrics','get_server_metrics') then
  span:=case p_args->>'range' when '5m' then interval '5 min' when '1h' then interval '1 hour' end;
  if span is null then return '{"status":400}'; end if;
 end if;
 if p_tool in ('get_incident','check_resolution','get_feature_metrics') then
  begin
   item:=(p_args->>(case when p_tool='get_feature_metrics' then 'feature' else 'id' end))::uuid;
  exception when invalid_text_representation then return '{"status":400}'; end;
 end if;
 case p_tool
 when 'list_apps' then
  select jsonb_build_object('apps',jsonb_build_array(jsonb_build_object('id',id,'name',private.ai_text(name))))
   into data from public.apps where id=k.app_id;
 when 'get_status' then
  with rows as (
   select f.id,private.ai_text(f.name) name,m.fast,m.measured,m.total,
    (select count(*) from public.incidents i where i.app_id=k.app_id and i.feature_id=f.id and i.status='open') issues
   from private.ai_metrics(k.app_id,null,interval '1 hour') m join public.features f on f.id=m.feature_id where not f.hidden
  ) select jsonb_build_object('open_incidents',(select count(*) from public.incidents where app_id=k.app_id and status='open'),
   'satisfaction_percent',round(100.0*sum(fast)/nullif(sum(measured) filter(where fast is not null),0)),
   'features',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'open_incidents',issues,'status',
     case when issues>0 then 'incident' when total>0 then 'observed' else 'no_data' end) order by id),'[]')) into data from rows;
 when 'list_incidents' then
  select jsonb_build_object('incidents',coalesce(jsonb_agg(to_jsonb(r) order by opened_at desc,id),'[]')) into data from (
   select i.id,i.feature_id,i.kind,i.status,i.opened_at,i.closed_at,coalesce(private.ai_text(f.name),'앱 전체') feature
   from public.incidents i left join public.features f on f.app_id=i.app_id and f.id=i.feature_id
   where i.app_id=k.app_id and i.status in ('open','resolved')
   order by i.opened_at desc,i.id limit 40) r;
 when 'get_incident','check_resolution' then
  select * into issue from public.incidents where app_id=k.app_id and id=item;
  if not found then return '{"status":404}'; end if;
  if p_tool='get_incident' then data:=private.ai_incident(issue);
  else
   select jsonb_build_object('id',issue.id,'status',issue.status,'resolved',issue.status='resolved',
    'version',coalesce(issue.resolved_version,p.version),'consecutive_successes',coalesce(p.consecutive_successes,0),
    'required_successes',5,'latest_success',p.latest_success,'latest_duration_ms',p.latest_duration_ms)
   || private.volume_comparison(issue)
   into data from (values(1)) seed(dummy) left join lateral private.verification_progress(issue) p on true;
  end if;
 when 'get_feature_metrics' then
  if item is null then return '{"status":400}'; end if;
  select jsonb_build_object('feature_id',m.feature_id,'range',p_args->>'range','total',m.total,'failures',m.failures,
   'p50_ms',m.p50_ms,'p95_ms',m.p95_ms,'baseline_p50_ms',b.p50_ms,'baseline_p95_ms',b.p95_ms)
   into data from private.ai_metrics(k.app_id,item,span) m left join public.baselines b on b.feature_id=m.feature_id;
  if not found then return '{"status":404}'; end if;
 when 'get_server_metrics' then
  data:=jsonb_build_object('available',false,'range',p_args->>'range','samples','[]'::jsonb);
  if to_regclass('public.server_minutes') is not null then
   select jsonb_build_object('available',count(*)>0,'range',p_args->>'range',
    'samples',coalesce(jsonb_agg(to_jsonb(r) order by bucket),'[]')) into data from (
    select s.bucket,s.last_received,(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(s.resources)
     where key in ('process_cpu_pct','system_cpu_pct','steal_pct','mem_used_pct','gc_pause_ms','event_loop_lag_ms',
      'busy_threads','db_pool_in_use','db_pool_max') and jsonb_typeof(value)='number') resources
    from public.server_minutes s where s.app_id=k.app_id and s.bucket between date_trunc('minute',now()-span) and now()
    order by s.bucket desc limit 61) r;
  end if;
 else data:='{}';
 end case;
 return jsonb_build_object('status',200,'data',data);
end $$;
