begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('13000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);

-- Seed a row as it could have existed before URL validation was introduced.
set local session_replication_role = replica;
insert into apps(id,name,url) values ('13000000-0000-4000-8000-000000000002','Legacy','http://legacy.test');
set local session_replication_role = origin;
insert into features(app_id,kind,method,route,name)
select id,'auto','GET','/item'||n,'Feature' from apps,generate_series(1,199) n;
insert into feature_map_suggestions(app_id,method,route,name)
select id,'GET',route,'Proposal' from apps cross join (values('/last'),('/extra')) routes(route);
select is(private.mask('/task_list desk_ sk_short /sk_0123456789abcdef xSp_pub_demo'),
  '/task_list desk_ sk_short /[가림] x[가림]', 'stored text follows the same key boundaries');
select is(private.mask(leading_text || prefix || '51Habcdefgh'), leading_text || '[가림]',
          'mask ' || leading_text || prefix || ' at the 16-character threshold')
from (values ('','sk_live_'), ('/','sk_test_'), ('_','pk_live_'),
             ('한글','rk_live_'), ('오류','sk_live_')) cases(leading_text, prefix);
select is(private.mask('sk_live_51Habcdefg xsk_live_51Habcdefgh 2rk_live_51Habcdefgh'),
          'sk_live_51Habcdefg xsk_live_51Habcdefgh 2rk_live_51Habcdefgh',
          'preserve short suffixes and prefixes following ASCII letters or digits');
set local role authenticated;
select lives_ok($$update apps set name='Renamed'$$,'owner can rename an app with a legacy URL');
select is((select name from apps),'Renamed','owner updated legacy app');
select throws_ok($$update apps set url='http://other.test'$$,'23514',null,'invalid replacement denied');
select throws_ok($$insert into apps(name,url) values ('New','http://new.test')$$,'23514',null,'invalid new URL denied');
select lives_ok($$update apps set url='https://fixed.test'$$,'owner can correct URL');
select is(confirm_feature_names('13000000-0000-4000-8000-000000000002',
  '[{"method":"GET","route":"/last","name":"Last","hidden":false},{"method":"GET","route":"/extra","name":"Extra","hidden":true}]'),
  '[{"method":"GET","route":"/extra"}]'::jsonb,'mixed batch reports exactly the discarded label');
select * from finish();
rollback;
