create function private.deep_field(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare
 cleaned text := private.mask(btrim(regexp_replace(regexp_replace(private.mask(raw), '["`~]|={4,}', '', 'g'), '[[:space:]]+', ' ', 'g')));
begin
 if cleaned is null or length(cleaned) not between 1 and 40 then
   raise exception 'invalid deep definition' using errcode='22023';
 end if;
 if cleaned ~* ('(이전|앞의|위의|기존|지금까지의?)\s*(의\s*)?(모든\s*)?(지시|명령|규칙|요청|내용).{0,12}(무시|잊)'
   || '|(지시|명령|규칙)[을를은는]?\s*(모두\s*)?(무시해|무시하고|무시하라|잊어)'
   || '|\m(ignore|disregard|forget)\s+((all|any|the|your)\s+)*(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|messages?|context)'
   || '|(시스템\s*프롬프트|system\s*prompt).{0,20}(출력해|보여\s*줘|알려\s*줘)|(print|show|reveal|repeat|output).{0,20}system\s*prompt'
   || '|(환경\s*변수|process\.env|\.env\M|비밀\s*키|서버\s*키|토큰).{0,60}(보내|전송해|출력해|알려|보여)\s*(줘|라|세요|주세요)'
   || '|\m(send|upload|post|leak|dump|print)\s+((all|every|the|your|my)\s+)*(env(ironment)?(\s*var(iable)?s?)?|process\.env|\.env|secrets?|api[\s_-]*keys?|credentials?|tokens?)\M') then
   raise exception 'unsafe deep definition' using errcode='22023';
 end if;
 return cleaned;
end $$;

-- Includes existing direct owner name edits, as well as writes through the RPC.
create function private.clean_deep_feature() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.name := private.deep_field(new.name);
 if new.start_definition is not null then new.start_definition := private.deep_field(new.start_definition); end if;
 if new.success_definition is not null then new.success_definition := private.deep_field(new.success_definition); end if;
 return new;
end $$;
create trigger clean_deep_feature before insert or update of name,start_definition,success_definition on public.features
 for each row when (new.kind='deep') execute function private.clean_deep_feature();

create function public.save_deep_feature(p_app uuid,p_feature uuid,p_name text,p_start text,p_success text)
returns public.features language plpgsql security definer set search_path='' as $$
declare saved public.features;
begin
 perform from public.apps where id=p_app and owner_id=auth.uid() for update;
 if not found then raise exception 'app unavailable' using errcode='42501'; end if;
 if p_start is null or p_success is null then raise exception 'missing definition' using errcode='22023'; end if;
 if p_feature is null then
   insert into public.features(app_id,kind,name,name_source,start_definition,success_definition,feature_key)
    values(p_app,'deep',p_name,'confirmed',p_start,p_success,translate(replace(gen_random_uuid()::text,'-',''),'0123456789','ghijklmnop'))
    returning * into saved;
 else
   update public.features set name=p_name,start_definition=p_start,success_definition=p_success
    where app_id=p_app and id=p_feature and kind='deep' returning * into saved;
   if not found then raise exception 'feature unavailable' using errcode='42501'; end if;
 end if;
 return saved;
end $$;

create function public.delete_deep_feature(p_app uuid,p_feature uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.features f using public.apps a where f.id=p_feature and f.kind='deep'
  and f.app_id=p_app and a.id=f.app_id and a.owner_id=auth.uid();
 if not found then raise exception 'feature unavailable' using errcode='42501'; end if;
end $$;
revoke all on function private.deep_field(text),private.clean_deep_feature(),
 public.save_deep_feature(uuid,uuid,text,text,text),public.delete_deep_feature(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.save_deep_feature(uuid,uuid,text,text,text),public.delete_deep_feature(uuid,uuid) to authenticated;
create index on public.attempts(feature_id,result_received_at,attempt_id) where ended_at is not null;

-- Keep the reason that triggered a failure incident in its opening snapshot.
create or replace view private.evaluation_signals as
 with cutoffs as (
  select feature_id,kind,max(closed_at) closed_at from public.incidents
  where closed_at>=now()-interval '1 hour' and status in ('resolved','quiet') group by 1,2
 ), kinds(kind) as (values ('failure'),('slow')), auto as (
  select s.feature_id,k.kind,sum(s.total-s.client_errors) results,sum(s.failures) failures,
   sum(s.total-s.client_errors) timed,private.hist_percentile(private.sum_hist(s.success_hist),0.5) p50,
   sum(case when s.threshold_ms=f.slow_threshold_ms and s.result_count=s.total-s.client_errors then s.slow_count
    else (select coalesce(sum(n),0) from unnest(case when s.client_errors=0 then s.hist else s.success_hist end) with ordinality bins(n,pos)
          where pos>private.duration_bin(f.slow_threshold_ms)) end) slow,
   max(s.bucket) latest,(array_agg(s.version order by s.bucket desc,s.version))[1] version
  from private.speed_buckets s join public.features f on f.id=s.feature_id cross join kinds k
  left join cutoffs c on c.feature_id=s.feature_id and c.kind=k.kind
  where s.bucket between now()-interval '30 minutes' and now()
   and (c.closed_at is null or s.bucket>c.closed_at) group by s.feature_id,k.kind
 ), deep as (
  select a.feature_id,k.kind,count(*) results,count(*) filter(where status='failure') failures,
   count(duration_ms) timed,percentile_cont(0.5) within group(order by duration_ms) filter(where status='success') p50,
   count(*) filter(where duration_ms>f.slow_threshold_ms) slow,
   (array_agg(status order by ended_at desc,attempt_id))[1:3]=array['failure','failure','failure'] streak,
   max(ended_at) latest,(array_agg(version order by ended_at desc,attempt_id))[1] version
  from public.attempts a join public.features f on f.id=a.feature_id cross join kinds k
  left join cutoffs c on c.feature_id=a.feature_id and c.kind=k.kind
  where ended_at between now()-interval '30 minutes' and now() and status in ('success','failure')
   and (c.closed_at is null or ended_at>c.closed_at) group by a.feature_id,k.kind
 ), missing as (
  select a.feature_id,count(*) tried,count(*) filter(where status='unconfirmed') missing,
   max(started_at) latest,(array_agg(version order by started_at desc,attempt_id))[1] version
  from public.attempts a left join cutoffs c on c.feature_id=a.feature_id and c.kind='unconfirmed'
  where started_at between now()-interval '1 hour' and now()
   and (c.closed_at is null or started_at>c.closed_at) group by a.feature_id
 ), recent as (
  select *,false as consecutive from auto
  union all select feature_id,kind,results,failures,timed,p50,slow,latest,version,streak from deep
 )
 select f.app_id,f.id feature_id,k.kind,
  case k.kind when 'failure' then (r.results>=5 and r.failures*5>=r.results) or r.consecutive
   when 'slow' then r.timed>=5 and case when b.p50_ms is null then r.slow*2>=r.timed else r.p50>=2*b.p50_ms end
   else m.tried>=10 and m.missing*2>=m.tried end as breached,
  case k.kind when 'failure' then r.failures::numeric/nullif(r.results,0)
   when 'slow' then r.p50::numeric/f.slow_threshold_ms
   else m.missing::numeric/nullif(m.tried,0) end severity,
  case k.kind when 'failure' then jsonb_build_object('total',r.results,'failures',r.failures,'consecutive',r.consecutive)
   when 'slow' then jsonb_build_object('total',r.timed,'p50',r.p50,'baseline',b.p50_ms,'slow',r.slow,'threshold',f.slow_threshold_ms)
   else jsonb_build_object('total',m.tried,'unconfirmed',m.missing) end metric,
  case when k.kind='unconfirmed' then m.version else r.version end version,
  case when k.kind='unconfirmed' then m.latest else r.latest end latest
 from public.features f cross join (values ('failure'),('slow'),('unconfirmed')) k(kind)
 left join public.baselines b on b.feature_id=f.id left join recent r on r.feature_id=f.id and r.kind=k.kind
 left join missing m on m.feature_id=f.id where k.kind<>'unconfirmed' or f.kind='deep';
