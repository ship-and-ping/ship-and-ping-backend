begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000061','owner@example.invalid',now());
select ok(not has_function_privilege('anon','public.issue_install_code(text,text,text)','execute') and
 not has_function_privilege('authenticated','public.consume_install_code(text,text,text)','execute'),'code RPCs restricted to worker');
create function pg_temp.issue(address text, proof text) returns jsonb language sql as $$
 select public.issue_install_code(address,'test-ip',proof)
$$;
create function pg_temp.verify(proof text) returns uuid language sql as $$
 select public.consume_install_code('owner@example.invalid','test-ip',proof)
$$;
select is(pg_temp.issue('absent@example.invalid','first'),null::jsonb,'unknown users never get mail');
select is((select count(*) from auth.users where email='absent@example.invalid'),0::bigint,'unknown users are never created');
select ok(pg_temp.issue('owner@example.invalid','first') is not null,'verified member receives a code');
select is(pg_temp.issue('owner@example.invalid','new'),null::jsonb,'rapid resend preserves the active challenge');
select is(pg_temp.verify('wrong'),null::uuid,'wrong code refused') from generate_series(1,5);
select is(pg_temp.verify('first'),null::uuid,'correct code after five mistakes is locked');
update private.install_mail_events set sent_at=now()-interval '2 minutes';
select ok(pg_temp.issue('owner@example.invalid','second') is not null,'may request a fresh code after cooldown');
select is(pg_temp.verify('first'),null::uuid,'replacement invalidates old code');
select is(pg_temp.verify('second'),'00000000-0000-0000-0000-000000000061'::uuid,'fresh correct code authenticates');
select is(pg_temp.verify('second'),null::uuid,'successful code is consumed once');
update private.install_mail_events set sent_at=now()-interval '2 minutes';
select ok(pg_temp.issue('owner@example.invalid','third') is not null,'issue expiry test code');
select ok((select expires_at between now()+interval '9 minutes' and clock_timestamp()+interval '10 minutes' from private.install_login_codes),'ten minute lifetime');
update private.install_login_codes set expires_at=now()-interval '1 second';
select is(pg_temp.verify('third'),null::uuid,'expired correct code denied');
select * from finish();
rollback;
