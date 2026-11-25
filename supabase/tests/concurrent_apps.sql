begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

-- Reuse the local pg_prove connection. Keep its password out of TAP output.
\getenv db_test_password PGPASSWORD
select format('hostaddr=%s port=%s dbname=%L user=%L password=%L',inet_server_addr(),inet_server_port(),current_database(),current_user,:'db_test_password') as db_test_connection \gset
select dblink_connect('first_writer',:'db_test_connection');
select dblink_connect('second_writer',:'db_test_connection');
select set_config('test.quota_owner',gen_random_uuid()::text,true);
select dblink_exec('first_writer', format('insert into auth.users(id) values(%L)',current_setting('test.quota_owner')));
select dblink_exec('first_writer', format('insert into public.apps(owner_id,name) values(%1$L,''One''),(%1$L,''Two'')',current_setting('test.quota_owner')));
select dblink_exec('first_writer','begin');
select dblink_exec('first_writer',format('insert into public.apps(owner_id,name) values(%L,''Three'')',current_setting('test.quota_owner')));
select dblink_exec('second_writer',$$set statement_timeout='10s'$$);
select set_config('test.writer_pid',pid::text,true) from dblink('second_writer','select pg_backend_pid()') as t(pid int);
select dblink_send_query('second_writer',format('insert into public.apps(owner_id,name) values(%L,''Four'') returning 1',current_setting('test.quota_owner')));
do $$begin
  for i in 1..100 loop
    exit when cardinality(pg_blocking_pids(current_setting('test.writer_pid')::int))>0;
    perform pg_sleep(0.02);
  end loop;
end$$;
select ok(cardinality(pg_blocking_pids(current_setting('test.writer_pid')::int))>0,'concurrent writer waits for third registration');
select dblink_exec('first_writer','commit');
select throws_ok($$select * from dblink_get_result('second_writer') as t(n int)$$,'23514',null,'fourth concurrent registration rejected');
select is((select count(*) from apps where owner_id=current_setting('test.quota_owner')::uuid),3::bigint,'exactly three rows committed');
select dblink_exec('first_writer',format('delete from public.apps where owner_id=%L and name=''Two''',current_setting('test.quota_owner')));
select lives_ok(format('select extensions.dblink_exec(''first_writer'',%L)',format('insert into public.apps(owner_id,name) values(%L,''Replacement'')',current_setting('test.quota_owner'))),'deleting an app releases its slot');
select dblink_exec('first_writer',format('delete from auth.users where id=%L',current_setting('test.quota_owner')));
select dblink_disconnect('first_writer');
select dblink_disconnect('second_writer');
select * from finish();
rollback;
