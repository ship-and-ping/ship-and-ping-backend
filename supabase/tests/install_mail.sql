begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000061','owner@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000062','other@example.invalid',now());
select ok(to_regprocedure('public.reserve_install_mail()') is null,'old member-facing RPC removed');
select ok(not has_function_privilege('anon','public.reserve_install_mail(uuid)','execute')
 and not has_function_privilege('authenticated','public.reserve_install_mail(uuid)','execute')
 and has_function_privilege('service_role','public.reserve_install_mail(uuid)','execute'),'only the Worker can reserve');
select ok(not has_function_privilege('authenticated','public.release_install_mail(uuid)','execute'),'members cannot refund');
select set_config('test.member','00000000-0000-0000-0000-000000000061',true);
create function pg_temp.reserve() returns jsonb language sql as $$
 select public.reserve_install_mail(current_setting('test.member')::uuid)
$$;
create temp table first_send as select pg_temp.reserve() reservation;
select is((select reservation->>'email' from first_send),'owner@example.invalid','uses the verified member address');
select is(pg_temp.reserve(),null::jsonb,'another send within ten minutes is denied');
select release_install_mail((select (reservation->>'receipt')::uuid from first_send));
select release_install_mail((select (reservation->>'receipt')::uuid from first_send));
select is((select used from private.mail_quota where day=(now() at time zone 'UTC')::date),0,'rejected delivery refunded exactly once');
select ok(pg_temp.reserve() is not null,'the member can retry a rejected delivery immediately');
update private.install_mail_events set sent_at=now()-interval '11 minutes';
insert into private.install_mail_events(member,kind,sent_at)
 select current_setting('test.member')::uuid,'guide',now()-interval '20 minutes' from generate_series(1,3);
select is(pg_temp.reserve()->>'email','owner@example.invalid','fifth send allowed after ten minutes');
update private.install_mail_events set sent_at=now()-interval '11 minutes';
select is(pg_temp.reserve(),null::jsonb,'sixth daily send is denied');
update private.install_mail_events set sent_at=now()-interval '1 day', day=(now() at time zone 'UTC')::date-1;
select is(pg_temp.reserve()->>'email','owner@example.invalid','daily allowance resets');
select set_config('test.member','00000000-0000-0000-0000-000000000062',true);
select is(pg_temp.reserve()->>'email','other@example.invalid','accounts are independent');
update private.mail_quota set used=90;
update private.install_mail_events set sent_at=now()-interval '11 minutes';
select is(pg_temp.reserve(),null::jsonb,'shared provider budget is respected');
select * from finish();
rollback;
