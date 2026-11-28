create or replace function private.profile_label(v jsonb,lim integer) returns boolean
language plpgsql immutable strict set search_path='' as $$
declare
  s text := v#>>'{}';
  compact text := replace(s,' ','');
  suffix text := s;
  word text;
  fragment text;
  candidate text;
  short_run integer := 0;
  digit_groups integer := 0;
  credential constant text := '^(?:(?:bearer|basic)[- ]?[a-z0-9]{3}|[spr]k(?:-|live|test)[- ]?[a-z0-9]{4}|(?:glpat|xox[baprs]|githubpat|gh[pousr]|spsrv|sppub|sbsecret|apikey|accesstoken|password|akia|asia|aiza|eyj)[- ]?[a-z0-9]{8})';
begin
  if jsonb_typeof(v)<>'string' or length(s) not between 1 and lim
    or private.mask(s)<>s or private.mask(compact)<>compact or private.profile_encoded_text(compact) then return false; end if;
  foreach word in array string_to_array(replace(s,'-',' '),' ') loop
    if word collate "C" !~ '^(?:[가-힣]{1,16}|[A-Za-z][A-Za-z0-9]{0,14}|[0-9]{1,2}|C[+][+]|C#|[.]NET|[A-Za-z][A-Za-z0-9]{0,14}(?:[.][A-Za-z][A-Za-z0-9]{0,14})+)$'
      or replace(suffix,' ','') collate "C" ~* credential or private.profile_encoded_text(word) then return false; end if;
    if word collate "C" ~ '^[A-Za-z0-9]+$' and
       (length(word)<=4 or word collate "C" ~ '[0-9]') then
      short_run := short_run+length(word);
      digit_groups := digit_groups+(word collate "C" ~ '[0-9]')::int;
      if short_run>=16 or (short_run>=12 and digit_groups>=3) then return false; end if;
    else
      short_run := 0;
      digit_groups := 0;
    end if;
    candidate := '';
    foreach fragment in array string_to_array(suffix,' ') loop
      exit when length(candidate)+length(fragment)>=16 or fragment collate "C" !~ '^[A-Za-z0-9]+$';
      candidate := candidate||fragment;
      if private.profile_encoded_text(candidate) then return false; end if;
    end loop;
    suffix := substr(suffix,length(word)+2);
  end loop;
  return true;
end $$;

create or replace function private.ai_incident(i public.incidents) returns jsonb
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
  if pg_input_is_valid(i.metric_at_open->>'last_received','timestamptz') then
   evidence:=evidence || jsonb_build_object('last_received',i.metric_at_open->'last_received',
    'detected_at',i.opened_at,'silent_minutes',greatest(0,floor(extract(epoch from
     i.opened_at-(i.metric_at_open->>'last_received')::timestamptz)/60)));
  end if;
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
