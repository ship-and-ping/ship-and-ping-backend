begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);
insert into auth.users(id) values (uuid_nil());
create temp table first_claim as select claim_withdrawal(uuid_nil()) as token;
select ok((select token is not null from first_claim), 'first Worker acquires claim');
select ok(claim_withdrawal(uuid_nil()) is null, 'different Worker cannot duplicate active withdrawal');
select release_withdrawal(uuid_nil(), gen_random_uuid());
select ok(claim_withdrawal(uuid_nil()) is null, 'stale release leaves claim intact');
update private.withdrawal_claims set expires_at = now() where member = uuid_nil();
create temp table second_claim as select claim_withdrawal(uuid_nil()) as token;
select ok((select token is not null from second_claim), 'abandoned claim expires');
select release_withdrawal(uuid_nil(), (select token from second_claim));
select ok(claim_withdrawal(uuid_nil()) is not null, 'known failure allows retry');
delete from auth.users where id = uuid_nil();
select is_empty('select * from private.withdrawal_claims where member = uuid_nil()', 'account deletion clears progress');
select is(has_function_privilege(role_name, signature, 'execute'), role_name = 'service_role',
          role_name || ' execute ' || signature)
from unnest(array['anon','authenticated','service_role']) roles(role_name)
cross join unnest(array['public.claim_withdrawal(uuid)','public.release_withdrawal(uuid,uuid)']) funcs(signature);
select * from finish();
rollback;
