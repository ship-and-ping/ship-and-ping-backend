begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into apps(id,name) values ('00000000-0000-0000-0000-000000000002','lookup');
insert into app_keys(app_id, kind, prefix, key_hash, revoked_at, expires_at)
select '00000000-0000-0000-0000-000000000002','pub','fixture',repeat(digit,64),revoked,expires
from (values ('1',null::timestamptz,now()+interval '1 hour'),
             ('2',now(),null),('3',null,now())) as fixtures(digit,revoked,expires);
select ok(not has_function_privilege('anon','public.lookup_key_app(text)','execute'),'anonymous denied');
select ok(not has_function_privilege('authenticated','public.lookup_key_app(text)','execute'),'members denied');
set local role service_role;
select is(lookup_key_app(repeat('1',64)), '00000000-0000-0000-0000-000000000002'::uuid, 'active key');
select is(lookup_key_app(repeat('2',64)), null::uuid, 'revoked key');
select is(lookup_key_app(repeat('3',64)), null::uuid, 'expired key');
select is(lookup_key_app(repeat('4',64)), null::uuid, 'missing key');
select * from finish();
rollback;
