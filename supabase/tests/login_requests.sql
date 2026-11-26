begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
select has_table('private', 'login_requests', 'login requests are private');
select ok(not has_table_privilege('anon', 'private.login_requests', 'SELECT'), 'anonymous clients cannot read requests');
select ok(not has_table_privilege('authenticated', 'private.login_requests', 'SELECT'), 'members cannot read requests directly');
create temporary table challenge as select public.login_create('member@example.test','ip','Firefox','서울') as c;
create function pg_temp.act(action text, code text default '', email text default 'member@example.test', secret text default '') returns jsonb language sql as $$
 select public.login_step((c->>'request_id')::uuid,action,email,'ip',secret,code,'test-key','fixture-token') from challenge
$$;
select is(pg_temp.act('inspect')->>'status','pending','authenticated owner sees challenge');
select is(pg_temp.act('inspect','','other@example.test')->>'status','missing','other member cannot inspect');
select is(pg_temp.act('poll')->>'status','missing','missing poll secret fails');
select is(pg_temp.act('claim',c->>'match_code')->>'status','issuing','correct answer reserves request') from challenge;
select is(pg_temp.act('claim',c->>'match_code')->>'status','used','cannot approve twice') from challenge;
select is(pg_temp.act('seal')->>'status','approved','stores encrypted grant');
select ok(position(convert_to('fixture-token','UTF8') in token_cipher)=0,'grant is not stored in plaintext') from private.login_requests;
select ok(r.poll_secret_hash=extensions.digest(c->>'poll_secret','sha256'),'PC secret stored as digest') from private.login_requests r,challenge;
select ok(expires_at-created_at=interval '10 minutes','ten minute lifetime') from private.login_requests;
select is(pg_temp.act('poll','','',c->>'poll_secret')->>'token_hash','fixture-token','PC retrieves grant') from challenge;
select is(pg_temp.act('poll','','',c->>'poll_secret')->>'status','used','poll consumes grant') from challenge;
update challenge set c=public.login_create('member@example.test','ip','Safari','대한민국');
select is(pg_temp.act('claim','000')->>'status','incorrect','first wrong answer');
select is(pg_temp.act('claim','000')->>'status','incorrect','second wrong answer');
select is(pg_temp.act('claim','000')->>'status','denied','third wrong answer closes request');
select is(pg_temp.act('poll','','',c->>'poll_secret')->>'status','denied','PC sees denial') from challenge;
update challenge set c=public.login_create('member@example.test','ip','Safari','대한민국');
update private.login_requests set expires_at=now()-interval '1 second';
select is(pg_temp.act('claim',c->>'match_code')->>'status','expired','expired challenge fails') from challenge;
select public.cleanup_daily();
select is((select count(*) from private.login_requests),0::bigint,'daily cleanup removes expired requests');
update challenge set c=public.login_create('member@example.test','ip','Safari','대한민국');
select is(pg_temp.act('deny')->>'status','denied','owner may decline without selecting a code');
select is(pg_temp.act('claim',c->>'match_code')->>'status','used','denied requests stay closed') from challenge;
update challenge set c=public.login_create('member@example.test','ip','Safari','대한민국');
select is(pg_temp.act('local')->>'status','missing','local completion requires PC secret');
select is(pg_temp.act('local','','member@example.test',c->>'poll_secret')->>'status','used','local completion needs both credentials') from challenge;
select is(public.login_create('MEMBER@example.test','different-ip','Chrome','KR')->>'status','limited','creation limit follows normalized email across IPs');
do $$ begin
 for n in 1..30 loop perform public.login_create('person'||n||'@example.test','burst-ip','Chrome','KR'); end loop;
end $$;
select is(public.login_create('last@example.test','burst-ip','Chrome','KR')->>'status','limited','creation limited by IP across emails');
update private.login_limits set hits=600 where bucket=extensions.digest('poll-email:member@example.test','sha256');
select is(pg_temp.act('poll','','',c->>'poll_secret')->>'status','limited','PC polls limited across IPs by email') from challenge;
update private.login_limits set hits=100 where bucket=extensions.digest('approve-ip:ip','sha256');
select is(pg_temp.act('inspect')->>'status','limited','IP approval budget enforced');
update private.login_limits set hits=0 where bucket=extensions.digest('approve-ip:ip','sha256');
update private.login_limits set hits=40 where bucket=extensions.digest('approve-email:member@example.test','sha256');
select is(pg_temp.act('inspect')->>'status','limited','email approval budget enforced');
select is(has_function_privilege(role_name,fn,'execute'),role_name='service_role','RPC privilege '||role_name)
 from unnest(array['anon','authenticated','service_role']) role_name,
 unnest(array['public.login_create(text,text,text,text)','public.login_step(uuid,text,text,text,text,text,text,text)']) fn;
select * from finish();
rollback;
