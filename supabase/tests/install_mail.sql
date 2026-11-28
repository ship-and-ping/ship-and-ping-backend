begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000061','owner@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000062','other@example.invalid',now());
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000061","role":"authenticated"}',true);
select ok(not has_function_privilege('anon','public.reserve_install_mail()','execute'),'anonymous requests denied');
set local role authenticated;
select is(reserve_install_mail(),'owner@example.invalid','only the signed-in address is returned');
select is(reserve_install_mail(),null::text,'another send within ten minutes is denied');
reset role;
update private.install_mail_quota set last_sent=now()-interval '10 minutes', used=4;
select is(reserve_install_mail(),'owner@example.invalid','fifth send allowed after ten minutes');
update private.install_mail_quota set last_sent=now()-interval '11 minutes';
select is(reserve_install_mail(),null::text,'sixth daily send is denied');
update private.install_mail_quota set day=current_date-1;
select is(reserve_install_mail(),'owner@example.invalid','daily allowance resets');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000062","role":"authenticated"}',true);
select is(reserve_install_mail(),'other@example.invalid','accounts are independent');
update private.mail_quota set used=90;
update private.install_mail_quota set last_sent=now()-interval '11 minutes';
select is(reserve_install_mail(),null::text,'shared provider budget is respected');
select * from finish();
rollback;
