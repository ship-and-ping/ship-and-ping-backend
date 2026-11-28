begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000005401'),('00000000-0000-0000-0000-000000005402');
insert into apps(id,owner_id,name) select id,id,'test' from auth.users;
insert into app_keys(app_id,kind,prefix,key_hash) select id,'srv','test',repeat(right(id::text,1),64) from apps;
do $$
begin
 for i in 1..8 loop
   perform write_app_profile(repeat('1',64),jsonb_build_object('framework','Spring '||i));
 end loop;
 perform write_app_profile(repeat('1',64),'{"framework":"Spring 8"}');
end $$;
select is((select jsonb_array_length(history) from app_profiles),5,'only five previous versions survive');
select is((select history->0->'profile'->>'framework' from app_profiles),'Spring 7','identical profile preserves history');

select throws_ok($test$select write_app_profile(repeat('1',64),'{"metrics":"https://example.org"}')$test$,'22023','invalid profile','reject unsafe direct RPC');
select throws_ok($test$select write_app_profile(repeat('1',64),'{"services":[{"feature":"ok","name":"ok","kind":"ai","extra":0}]}')$test$,'22023','invalid profile','reject unknown nested fields');
create temporary table saved_profile as select profile,history from app_profiles;
select throws_ok(format('select write_app_profile(repeat(''1'',64),%L::jsonb)',payload),
  '22023','invalid profile','reject profile text: '||label)
from unnest(array['Bearer abc','Use Be arer abc','sk live example','sk-demo','s k - demo','c2VjcmV0','Use QUJD',
  'YW Jj ZG Vm','Use YW Jj ZG Vm now','%42earer','Ｂｅａｒｅｒ abc','abcdefghijklmnop','abcd efgh ijkl mnop','ab12cd34ef56gh78',
  'a8Kd 9fQ2 xL7p','a8Kd f9Q2 xL7p','a8KdR xL7pQ t4ZmN j6VaH','a8KdR-xL7pQ-t4ZmN-j6VaH']) label
cross join lateral (values (jsonb_build_object('rollback',label)),
  (jsonb_build_object('services',jsonb_build_array(jsonb_build_object('kind','map','feature','지도','name',label))))) cases(payload);
select results_eq('select profile,history from app_profiles','select profile,history from saved_profile',
  'rejected writes preserve both the current profile and history');
select ok(private.valid_profile(jsonb_build_object('metrics',label)),'accept profile text: '||label)
from unnest(array['Flask-SQLAlchemy','flask-login','C++','Next.js','Spring 8','이전 릴리스 다시 배포','Check the server dashboard',
  'PyTorch','TensorFlow','NestJS','Socket.IO','spring-boot-starter-web','google-cloud-storage','Django REST framework',
  'React','React Native','Angular','Express','Koa','Fastify','Hapi',
  'Svelte','SvelteKit','Astro','Nuxt.js','Vue.js','Node.js','ASP.NET',
  '.NET','C#','Laravel','Symfony','CakePHP','Ruby on Rails','Sinatra',
  'Hanami','Spring Boot','Micronaut','Quarkus','Hibernate','MyBatis','JUnit',
  'Mockito','Log4j','FastAPI','Flask','Pydantic','SQLAlchemy','Celery',
  'NumPy','SciPy','pandas','Matplotlib','scikit-learn','Starlette','Tornado',
  'Gin','Echo','Fiber','Gorilla Mux','Actix Web','Axum','Tokio',
  'Serde','Diesel','Prisma','Sequelize','TypeORM','Jest','Vitest',
  'Playwright','Cypress','Rollup','Webpack','Vite']) label;
select ok(not private.valid_resources('{"gc_pause_ms":-1}') and not private.valid_resources('{"mem_used_pct":101}'),'DB enforces resource bounds');

-- Replay the upgrade with one real request and one empty legacy batch.
create temporary table legacy as select jsonb_build_object('batch_id',gen_random_uuid(),'platform','server',
  'app_version','v1','stats','[]'::jsonb,'attempts','[]'::jsonb,'error_samples','[]'::jsonb) payload;
select is((select private.ingest_before_resources(repeat('2',64),payload)->>'accepted' from legacy),'0','legacy empty batch accepted no records');
select is((select private.ingest_before_resources(repeat('1',64),payload||jsonb_build_object('stats',jsonb_build_array(
  jsonb_build_object('method','GET','route','/status','total',1,'failures',0,'client_errors',0,'duration_sum_ms',5,
  'hist',array[1]||array_fill(0,array[15]),'bucket',date_trunc('hour',now())-interval '1 day'))))->>'accepted' from legacy),'1','legacy request accepted');
update app_versions set first_seen_at=now()-interval '1 day',last_seen_at=now()-interval '1 day';
select private.backfill_server_minutes();
select is((select count(*) from server_minutes where right(app_id::text,1)='2'),0::bigint,'empty batch version timestamp never establishes an active hour');
select is((select count(*) from server_minutes where right(app_id::text,1)='1'),1::bigint,'accepted history establishes an active hour');
insert into server_minutes select id,date_trunc('minute',now()-interval '9 minutes 59 seconds'),now()-interval '9 minutes 59 seconds','v1',null from apps;
select evaluate_silence();
select is((select count(*) from incidents where kind='silent'),0::bigint,'nine minutes and 59 seconds cannot open an incident');
update server_minutes set bucket=date_trunc('minute',now()-interval '10 minutes'),last_received=now()-interval '10 minutes'
  where last_received=now()-interval '9 minutes 59 seconds';
select evaluate_silence();
select evaluate_silence();
select is((select count(*) from incidents where kind='silent'),1::bigint,'opens once at ten minutes only during a historically active hour');
select is((select right(app_id::text,1) from incidents),'1','normally quiet app stays quiet');
select is((select count(*) from notifications where event='open'),1::bigint,'one opening notification');
create temporary table claimed_open as select * from claim_notifications(10) where event='open';
select is((select count(*) from claimed_open where kind='silent' and feature is null),1::bigint,'claim a featureless opening before heartbeat');
create temporary table batch as select jsonb_build_object('batch_id',gen_random_uuid(),'platform','server',
 'app_version','v1','resources',jsonb_build_object('process_cpu_pct',0),'stats','[]'::jsonb,'attempts','[]'::jsonb,
 'error_samples','[]'::jsonb) payload;
select is((select ingest_batch(repeat('1',64),payload)->>'accepted' from batch),'1','resource-only heartbeat accepted');
select is((select ingest_batch(repeat('1',64),payload)->>'accepted' from batch),'0','retry ignored');
select is((select status from incidents),'resolved','heartbeat resolves without release change');
select is((select count(*) from notifications where event='resolved'),1::bigint,'one recovery notification');
select complete_notification(id,claim_token,false,'temporary failure') from claimed_open;
update notifications set available_at=now() where event='open';
select results_eq($$select event from claim_notifications(10)$$,$$values ('resolved'::text)$$,
  'late failure of the first send cannot requeue a resolved opening');
select is((select ingest_batch(repeat('1',64),payload||jsonb_build_object('batch_id',gen_random_uuid(),
 'resources','{"process_cpu_pct":99}'::jsonb))->>'dropped' from batch),'1','excess minute sample reported as dropped');
select is((select resources->>'process_cpu_pct' from server_minutes where resources ? 'process_cpu_pct'),'0','second resource sample cannot overwrite first');
create temporary table timed_batch as select payload || jsonb_build_object('batch_id',gen_random_uuid(),
 'stats',jsonb_build_array(jsonb_build_object('method','GET','route','/status','total',2,'failures',0,'client_errors',0,
 'duration_sum_ms',40,'hist',array[2]||array_fill(0,array[15]),'bucket',date_bin('5 minutes',now(),'epoch'),
 'db_ms_count',1,'db_ms_sum',0,'external_ms_count',2,'external_ms_sum',15))) as payload from batch;
select ingest_batch(repeat('1',64),payload) from timed_batch;
select ingest_batch(repeat('1',64),payload) from timed_batch;
select is((select array[db_ms_sum,db_ms_count,external_ms_sum,external_ms_count] from feature_timing_5m),
 array[0,1,15,2]::bigint[],'timing totals count measured requests only and survive retries');
select is((select count(*) from feature_timing_5m t join features f on f.id=t.feature_id and f.route='/status'),1::bigint,
 'timings use the same feature as the request bucket');
insert into server_minutes select id,date_trunc('hour',now())-interval '8 days',now()-interval '8 days','v0','{"steal_pct":3}' from apps;
select rollup_server_hours();
select rollup_server_hours();
select is((select count(*) from server_hours),2::bigint,'hourly retention idempotent');

-- A resolved featureless incident spanning only part of a sampled minute.
insert into incidents(id,app_id,kind,status,opened_at,closed_at,opened_version)
values('00000000-0000-0000-0000-000000005499','00000000-0000-0000-0000-000000005401','silent','resolved',
  '2026-01-01 12:00:10Z','2026-01-01 12:00:40Z','v1');
insert into server_minutes(app_id,bucket,last_received,version,resources)
select '00000000-0000-0000-0000-000000005401',date_trunc('minute',stamp),stamp,'v1',jsonb_build_object('steal_pct',peak)
from (values (timestamptz '2026-01-01 11:59:59Z',90),(timestamptz '2026-01-01 12:00:20Z',7),
  (timestamptz '2026-01-01 12:01:00Z',99)) m(stamp,peak);

select ok(not has_function_privilege('authenticated','write_app_profile(text,jsonb)','execute')
 and not has_function_privilege('anon','server_series(uuid,timestamptz,timestamptz,integer)','execute')
 and not has_function_privilege('authenticated','evaluate_silence()','execute'),'write, read and cron roles restricted');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000005402';
select ok(incident_server_context('00000000-0000-0000-0000-000000005499') is null,'foreign silent context hidden');
select is((select count(*) from app_profiles),0::bigint,'other profile hidden');
delete from app_profiles;
select is((select count(*) from server_hours),1::bigint,'only own hourly row visible');
select is((select count(*) from feature_timing_5m),0::bigint,'other feature timing is hidden');
select is((select peaks->>'steal_pct' from server_series('00000000-0000-0000-0000-000000005402',
 now()-interval '9 days',now()-interval '7 days',1)),'3','owner reads an hourly peak');
select is((select count(*) from server_series('00000000-0000-0000-0000-000000005401',now()-interval '9 days',now(),1)),0::bigint,'cross-app series hidden');
select is((select count(*) from server_minutes where right(app_id::text,1)='1'),0::bigint,'cross-app minutes hidden');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000005401';
select is((select count(*) from incidents where kind='silent' and feature_id is null),2::bigint,'owner can list featureless silent incidents');
select is(incident_server_context('00000000-0000-0000-0000-000000005499')->'peaks'->>'steal_pct','7',
  'owner reads the opening minute of a silent incident, excluding adjacent minutes');
select is(incident_server_context('00000000-0000-0000-0000-000000005499')->'profile',
  '{"framework":"Spring 8"}'::jsonb,'silent context contains the last accepted profile');
select is((select slot from server_series('00000000-0000-0000-0000-000000005401',
  '2026-01-01 12:00:10Z','2026-01-01 12:00:40Z',4)),0,'partial opening minute maps to slot zero');
select is((select count(*) from app_profiles),1::bigint,'owner can read after foreign delete');
delete from app_profiles;
select is((select count(*) from app_profiles),0::bigint,'owner deletes profile and history together');
select * from finish();
rollback;
