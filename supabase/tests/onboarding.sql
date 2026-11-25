begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000a1'),('00000000-0000-4000-8000-0000000000b1');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
insert into apps(id,name) values ('00000000-0000-4000-8000-0000000000a2','Owned');
insert into apps(id,owner_id,name) values ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b1','Other');
insert into features(app_id,kind,method,route,name) select id,'auto','GET','/unnamed','이름 없는 기능' from apps;
insert into feature_map_suggestions(app_id,method,route,name)
  select id,'GET',route,'Proposed' from apps cross join (values('/one'),('/two')) as paths(route);
set local role authenticated;
select throws_ok($$select confirm_feature_names('00000000-0000-4000-8000-0000000000b2','[]')$$,
  '42501',null,'other owner cannot confirm any names');
select throws_ok($$select confirm_feature_names('00000000-0000-4000-8000-0000000000a2',
 '[{"method":"GET","route":"/one","name":"One","hidden":false},{"method":"GET","route":"/unknown","name":"Unknown","hidden":false}]')$$,
 '22023',null,'unknown route aborts the whole batch');
select is((select count(*) from features where route='/one'),0::bigint,'earlier row rolled back');
select throws_ok($$select confirm_feature_names('00000000-0000-4000-8000-0000000000a2',
 '[{"method":"GET","route":"/unnamed","name":"이름 없는 기능","hidden":false}]')$$,'22023',null,'placeholder cannot become confirmed');
select lives_ok($$select confirm_feature_names('00000000-0000-4000-8000-0000000000a2',
 '[{"method":"GET","route":"/one","name":"Edited","hidden":true}]')$$,'confirm suggestion before first use');
select results_eq($$select name,name_source,hidden from features where route='/one'$$,$$select 'Edited'::text,'confirmed'::text,true$$,'confirmed edits persisted');
select results_eq('select route,applied from feature_map_suggestions order by route',$$select * from (values('/one'::text,true),('/two'::text,false)) as expected(route,applied)$$,'only selected suggestion applied');
select is((select name_source from features where route='/unnamed'),'route','unnamed feature remains open to later suggestions');
select ok(not has_function_privilege('anon','public.confirm_feature_names(uuid,jsonb)','execute'),'anonymous access denied');
select * from finish();
rollback;
