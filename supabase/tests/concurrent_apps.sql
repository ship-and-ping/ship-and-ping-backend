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
-- Drain the error result before submitting a second asynchronous command.
select * from dblink_get_result('second_writer') as t(n int);
-- The two contenders use distinct app keys. Other apps occupy 99 global slots.
select gen_random_uuid() seed_owner_a,gen_random_uuid() seed_owner_b \gset
select dblink_exec('first_writer',format('insert into auth.users(id) values(%L),(%L)',:'seed_owner_a',:'seed_owner_b'));
select dblink_exec('first_writer',format($q$insert into apps(owner_id,name)
 select %1$L,'seed-a-'||n from generate_series(1,3) n union all
 select %2$L::uuid,'seed-b-'||n from generate_series(1,2) n$q$,:'seed_owner_a',:'seed_owner_b'));
select dblink_exec('first_writer',format($q$insert into features(app_id,kind,method,route,name,last_record_at)
 select id,'auto','GET','/seed-'||n,'seed',now() from apps cross join generate_series(1,20) n
 where owner_id in (%L,%L) and (name<>'seed-b-2' or n<20)$q$,:'seed_owner_a',:'seed_owner_b'));
select dblink_exec('first_writer',format($q$insert into app_keys(app_id,kind,prefix,key_hash)
 select id,'pub','race',repeat(case name when 'One' then 'a' else 'b' end,64)
 from apps where owner_id=%L and name in ('One','Three')$q$,current_setting('test.quota_owner')));
select format('select public.ingest_batch(%%L,%L::jsonb)',jsonb_build_object(
 'batch_id',gen_random_uuid(),'app_version','v1','stats',jsonb_build_array(jsonb_build_object(
 'method','GET','route','/race','bucket',date_trunc('hour',now()),'total',1,'failures',0,
 'client_errors',0,'hist',array[1]||array_fill(0,array[15]),'duration_sum_ms',1)))) race_query \gset
select dblink_exec('first_writer','begin');
select * from dblink('first_writer',format(:'race_query',repeat('a',64))) as r(result jsonb);
select dblink_send_query('second_writer',format(:'race_query',repeat('b',64)));
do $$begin
  for i in 1..100 loop
    exit when cardinality(pg_blocking_pids(current_setting('test.writer_pid')::int))>0;
    perform pg_sleep(0.02);
  end loop;
end$$;
select ok(cardinality(pg_blocking_pids(current_setting('test.writer_pid')::int))>0,'second app waits for last global slot');
select dblink_exec('first_writer','commit');
select * from dblink_get_result('second_writer') as r(result jsonb);
select is(private.active_feature_count(),100::bigint,'two competing apps occupy exactly one last slot');
select results_eq($q$select a.name,f.route,s.total from stats_5m s join features f on f.id=s.feature_id
 join apps a on a.id=f.app_id where a.owner_id=current_setting('test.quota_owner')::uuid order by a.name$q$,
 $q$values ('One'::text,'/race'::text,1),('Three','*',1)$q$,'losing app keeps its record in its own 기타');
select dblink_exec('first_writer',format('delete from auth.users where id in (%L,%L,%L)',
 current_setting('test.quota_owner'),:'seed_owner_a',:'seed_owner_b'));
select dblink_disconnect('first_writer');
select dblink_disconnect('second_writer');
select * from finish();
rollback;
