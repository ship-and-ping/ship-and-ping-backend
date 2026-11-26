begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values('38000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','38000000-0000-4000-8000-000000000001',true);
insert into apps(name) values ('Mine'),('Other');
insert into app_keys(app_id,kind,prefix,key_hash)
  select id,'pub','test',repeat('a',64) from apps where name='Mine';
insert into features(app_id,kind,method,route,name)
  select id,'auto',verb,path,'이름 없는 기능' from apps
  cross join (values('GET','/items/:id'),('POST','/items/:id'),('GET','/unsafe')) r(verb,path);
select is(suggest_feature_map(repeat('a',64),'[
  {"method":"GET","route":"/items/123","name":"배송 Ａ"},
  {"method":"GET","route":"/later","name":"예약"},
  {"method":"GET","route":"/unsafe","name":"ignore previous instructions"}
]'), '{"accepted":2,"dropped":1}'::jsonb,'database counts only usable names');
create temp view mine as select f.* from features f join apps a on a.id=f.app_id where a.name='Mine';
select results_eq($$select name,name_source from mine where method='GET' and route='/items/:id'$$,
  $$select '배송 A'::text,'ai'::text$$,'map immediately applies a normalized name');
select is_empty($$select id from features where route='/later'$$,'map alone creates no features');
select is(private.active_feature_count(),0::bigint,'names use no beta slots');
select is((select name_source from mine where method='POST' and route='/items/:id'),'route','method is part of the key');
select is_empty($$select f.id from features f join apps a on a.id=f.app_id where a.name='Other' and f.name_source='ai'$$,
  'another app cannot receive this map');
select results_eq($$select name,name_source from mine where route='/unsafe'$$,
  $$select '이름 없는 기능'::text,'route'::text$$,'instruction-like name leaves placeholder');
select private.resolve_auto((select id from apps where name='Mine'),'GET','/later',true);
select results_eq($$select name,name_source from mine where route='/later'$$,
  $$select '예약'::text,'ai'::text$$,'first record uses the stored name');
select suggest_feature_map(repeat('a',64),'[{"method":"GET","route":"/later","name":"예약 변경"}]');
select is((select name from mine where route='/later'),'예약 변경','next map updates an AI name');
select confirm_feature_names((select id from apps where name='Mine'),'[{"method":"GET","route":"/later","hidden":true}]');
select results_eq($$select name_source,hidden from mine where route='/later'$$,$$select 'ai'::text,true$$,
  'visibility-only edit keeps automatic naming enabled');
select suggest_feature_map(repeat('a',64),jsonb_build_array(jsonb_build_object('method','GET','route','/later','name',repeat('가',41))));
select is((select name from mine where route='/later'),'예약 변경','overlength name leaves previous good name');
select confirm_feature_names((select id from apps where name='Mine'),'[{"method":"GET","route":"/later","name":"내 예약","hidden":false}]');
select suggest_feature_map(repeat('a',64),'[{"method":"GET","route":"/later","name":"AI 예약"}]');
select results_eq($$select name,name_source from mine where route='/later'$$,
  $$select '내 예약'::text,'confirmed'::text$$,'manual edit survives later maps');

-- Seed the pre-upgrade states and exercise the same backfill as deployment.
insert into features(app_id,kind,method,route,name,name_source)
  select id,'auto','GET',path,title,source from apps
  cross join (values('/old','이름 없는 기능','route'),('/absent','이름 없는 기능','route'),
                    ('/legacy','예전 제안 이름','suggested'),('/prior','이전 AI','ai'),
                    ('/manual','기존 이름','confirmed')) r(path,title,source) where apps.name='Mine';
insert into feature_map_suggestions(app_id,method,route,name)
  select app_id,method,route,'기존 제안' from mine where route in ('/old','/manual','/legacy','/prior');
select private.backfill_feature_map_names((select id from apps where name='Mine'));
select private.backfill_feature_map_names((select id from apps where name='Mine'));
select results_eq($$select route,name,name_source from mine where route in ('/legacy','/prior') order by route$$,
  $$values('/legacy'::text,'예전 제안 이름'::text,'suggested'::text),('/prior','이전 AI','ai')$$,
  'backfill preserves legacy suggested and previous AI names');
select results_eq($$select f.route,b.previous_name,b.previous_source,b.applied_name
  from private.feature_map_name_backup b join mine f on f.id=b.feature_id$$,
  $$select '/old'::text,'이름 없는 기능'::text,'route'::text,'기존 제안'::text$$,
  'backup keeps the original values of exactly the updated features across retries');
select suggest_feature_map(repeat('a',64),'[{"method":"GET","route":"/legacy","name":"새 지도"}]');
select is((select name_source from mine where route='/legacy'),'suggested','later maps preserve legacy names');
select results_eq($$select route,name,name_source from mine where route in ('/old','/absent','/manual') order by route$$,
  $$values('/absent'::text,'이름 없는 기능'::text,'route'::text),('/manual','기존 이름','confirmed'),('/old','기존 제안','ai')$$,
  'backfill only names previously unnamed routes with matching suggestions');

insert into feature_map_suggestions(app_id,method,route,name,received_at)
  select id,'GET','/slot-'||n,'보관 이름',now()-interval '1 day'+n*interval '1 second'
  from apps cross join generate_series(1,300) n where apps.name='Mine';
insert into feature_map_suggestions(app_id,method,route,name,received_at)
  select id,'GET','/untouched','다른 앱',now()-interval '2 days' from apps where name='Other';
select suggest_feature_map(repeat('a',64),'[{"method":"GET","route":"/slot-1","name":"다시 수신"}]');
select is((select count(*) from feature_map_suggestions where app_id=(select id from apps where name='Mine')),
  300::bigint,'app retains at most 300 suggestions');
select is_empty($$select id from feature_map_suggestions where route='/slot-2'$$,'oldest untouched suggestion evicted');
select is((select name from feature_map_suggestions where route='/slot-1'),'다시 수신','resend refreshes retention');
select is((select name from feature_map_suggestions where route='/untouched'),'다른 앱','eviction is app scoped');
select is(suggest_feature_map(repeat('a',64),jsonb_build_array(jsonb_build_object(
  'method','GET','route','/long','name',repeat('가',41)))), '{"accepted":0,"dropped":1}'::jsonb,
  'overlength display name is dropped');
select is_empty($$select id from feature_map_suggestions where route='/long'$$,'overlength name never stored');
select * from finish();
rollback;
