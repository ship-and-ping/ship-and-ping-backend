begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into apps(id,owner_id,name) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','one'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','two');
insert into app_keys(id,app_id,kind,prefix,key_hash) values
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','pub','fixture',repeat('1',64)),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012','pub','fixture',repeat('2',64));
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select throws_ok($$select revoke_app_key('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000022')$$,'42501','app unavailable','foreign app rejected');
select throws_ok($$select revoke_app_key('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022')$$,'42501','key unavailable','foreign key rejected');
select lives_ok($$select revoke_app_key('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021')$$,'owner revokes key');
reset role;
select throws_ok($$select private.lock_key(repeat('1',64))$$,'PT401','invalid app key','next ingestion rejected');
update app_keys set revoked_at = '2026-01-01' where key_hash = repeat('1',64);
set local role authenticated;
select lives_ok($$select revoke_app_key('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021')$$,'repeat succeeds');
reset role;
select is((select revoked_at from app_keys where key_hash=repeat('1',64)), '2026-01-01'::timestamptz,'original revocation preserved');
select * from finish();
rollback;
