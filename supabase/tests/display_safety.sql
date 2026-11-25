begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values('12000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
insert into apps(id,name,url) values('12000000-0000-4000-8000-000000000002','App','https://example.test/path');
select throws_ok(format('update apps set url=%L',bad),'23514',null,description)
from (values ('http://example.test','HTTPS required'),('https:///path','host required'),
 ('https://user@example.test','credentials denied'),('https://example.test/a b','whitespace denied'),
 ('https://example.test/'||repeat('a',2048),'URL length bounded')) v(bad,description);
select lives_ok('update apps set url=null','optional URL');
insert into features(app_id,kind,method,route,name)
select id,'auto','GET','/route'||n,'Feature' from apps,generate_series(1,199) n;
insert into feature_map_suggestions(app_id,method,route,name)
select id,'GET',route,'Proposal' from apps cross join (values('/last'),('/overflow')) routes(route);
set local role authenticated;
select lives_ok($$select confirm_feature_names('12000000-0000-4000-8000-000000000002',
 '[{"method":"GET","route":"/last","name":"Last","hidden":false},{"method":"GET","route":"/overflow","name":"Overflow","hidden":true}]')$$,'batch across cap uses overflow group');
select is((select count(*) from features where method<>'*'),200::bigint,'exactly 200 concrete routes');
select results_eq($$select name,hidden from features where method='*' and route='*'$$,$$select '기타'::text,false$$,'overflow keeps shared name and visibility');
select is((select count(*) from feature_map_suggestions where applied),2::bigint,'handled proposals no longer appear as pending');
select * from finish();
rollback;
