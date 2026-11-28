-- All user-originated labels use the display sanitizer before leaving Postgres.
create function private.ai_text(label text) returns text language sql immutable strict set search_path='' as $$
 -- Preserve whitespace boundaries for the shared credential matcher, including folded lines.
 select left(btrim(regexp_replace(private.mask(translate(private.normalize_text(label),E'\n',' ')),
                                  '[[:cntrl:]]','','g')),160)
$$;

create function private.ai_metrics(app uuid, feature uuid, span interval)
returns table(feature_id uuid,total bigint,failures bigint,p50_ms float8,p95_ms float8,fast bigint,measured bigint)
language sql stable set search_path='' as $$
 with buckets as materialized (
  select s.* from private.speed_buckets s where s.app_id=app and (feature is null or s.feature_id=feature)
   and s.bucket>=date_bin('5 minutes',now()-span,timestamptz 'epoch') and s.bucket<=now()
 ), attempts as materialized (
  select a.* from public.attempts a where a.app_id=app and (feature is null or a.feature_id=feature)
   and a.ended_at between now()-span and now() and a.status in ('success','failure')
 ), totals as (
  select t.feature_id,sum(t.n)::bigint n,sum(t.failed)::bigint failed from (
   select s.feature_id,s.total n,s.failures failed from buckets s
   union all select a.feature_id,1,(a.status='failure')::int from attempts a
  ) t group by t.feature_id
 ), points as (
  select u.feature_id,u.ms,sum(u.n)::bigint n from (
   select s.feature_id,p.ms,p.n from buckets s cross join lateral
    private.duration_points(s.success_hist,s.duration_counts,s.complete_min,s.complete_max,s.mean_ms) p
   where s.success_hist is not null
   union all select a.feature_id,a.duration_ms,1 from attempts a where a.status='success' and a.duration_ms is not null
  ) u group by u.feature_id,u.ms
 ), distribution as (
  select p.feature_id,private.duration_quantiles(array_agg(p.ms),array_agg(p.n),array[0.5,0.95]) q,
   sum(p.n) filter(where p.ms<=b.p95_ms)::bigint fast,sum(p.n)::bigint measured
  from points p left join public.baselines b on b.feature_id=p.feature_id group by p.feature_id
 )
 select f.id,coalesce(t.n,0),coalesce(t.failed,0),d.q[1],d.q[2],
  case when b.p95_ms is not null then coalesce(d.fast,0) end,coalesce(d.measured,0)
 from public.features f left join totals t on t.feature_id=f.id left join distribution d on d.feature_id=f.id
 left join public.baselines b on b.feature_id=f.id where f.app_id=app and (feature is null or f.id=feature)
$$;

create function private.ai_incident(i public.incidents) returns jsonb
language plpgsql stable set search_path='' as $$
declare f public.features; progress record; baseline public.baselines; latest text; previous text; evidence jsonb;
 cutoff timestamptz:=i.opened_at-case when i.kind='unconfirmed' then interval '1 hour' else interval '30 minutes' end;
begin
 select * into f from public.features where app_id=i.app_id and id=i.feature_id;
 select * into baseline from public.baselines where feature_id=f.id;
 select * into progress from private.verification_progress(i);
 latest:=coalesce(i.resolved_version,progress.version);
 select version into previous from public.app_versions where app_id=i.app_id and version<>i.opened_version
  and first_seen_at<i.opened_at order by first_seen_at desc,version limit 1;
 select coalesce(jsonb_object_agg(key,value),'{}') into evidence from jsonb_each(coalesce(i.metric_worst,i.metric_at_open,'{}'))
 where key in ('total','failures','p50','baseline','baseline_p50','baseline_p95','window','unconfirmed','severity')
 and jsonb_typeof(value)='number';
 if i.kind='silent' and i.metric_at_open->>'last_received' ~
  '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
  evidence:=evidence || jsonb_build_object('last_received',i.metric_at_open->'last_received');
 end if;
 return jsonb_build_object('id',i.id,'kind',i.kind,'status',i.status,'opened',i.opened_at,'closed',i.closed_at,
 'feature',coalesce(private.ai_text(f.name),'앱 전체'),'route',private.ai_text(private.route(f.route)),'feature_id',i.feature_id,
 'versions',case when latest is not null then array[latest,i.opened_version] else array_remove(array[i.opened_version,previous],null) end,
 'mode',case when i.status='open' and (progress.latest_success=false or
   (i.kind='slow' and progress.latest_duration_ms>least(f.slow_threshold_ms,baseline.p95_ms+500,
     greatest(baseline.p95_ms,baseline.p50_ms+499)))) then 'again'
  when exists(select from public.notifications where incident_id=i.id and event='worse') then 'worse' else 'first' end,
 'consecutive',i.metric_at_open->'consecutive'='true'::jsonb,'evidence',evidence,
 'step',(select private.step_name(a.step) from public.attempts a where a.app_id=i.app_id and a.feature_id=f.id
  and a.ended_at between cutoff and coalesce(i.closed_at,now()) and a.status='failure' and a.step is not null order by a.ended_at desc limit 1),
 'errors',(select coalesce(jsonb_agg(to_jsonb(s) order by s.at desc),'[]') from (
  select e.at,private.error_kind(e.error_kind) error_kind,private.error_name(e.message) message
  from public.error_samples e where e.app_id=i.app_id and e.feature_id=f.id and e.at between cutoff and coalesce(i.closed_at,now())
  order by e.at desc,e.id limit 5) s));
end $$;

-- One transaction binds quota, audit and the data query to the same unrevoked key.
create function public.mcp_read(p_hash text,p_tool text,p_args jsonb) returns jsonb
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
revoke all on function private.ai_text(text),private.ai_metrics(uuid,uuid,interval),private.ai_incident(public.incidents),
 public.mcp_read(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mcp_read(text,text,jsonb) to service_role;
