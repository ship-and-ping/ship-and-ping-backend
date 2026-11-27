begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(2);

insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000047','member@example.invalid');
insert into apps(owner_id,name) values ('00000000-0000-0000-0000-000000000047','first evaluation');
insert into app_versions(app_id,version) select id,'v1' from apps;
insert into features(app_id,kind,name,route,method)
 select id,'auto',route,route,'GET' from apps cross join unnest(array['/sparse','/busy']) route;

-- Align the 12:13 example with the current five-minute bucket so CI can run at any time.
with traffic(route,stamp,n,ms,bin) as (values
 ('/sparse',time '08:00',30,200,3),('/busy',time '08:00',30,200,3),
 ('/sparse',time '11:44',1,1400,8),('/sparse',time '12:12',4,1400,8),
 ('/busy',time '12:12',10,1400,8)
)
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select f.app_id,f.id,'v1',date_bin('5 minutes',now(),'epoch')
  + (date_bin('5 minutes',date '2000-01-01'+t.stamp,timestamp 'epoch')
     -date_bin('5 minutes',timestamp '2000-01-01 12:13',timestamp 'epoch')),
  n,0,0,n*ms,array_fill(0,array[bin-1])||array[n]||array_fill(0,array[16-bin])
 from traffic t join features f using(route);

select evaluate_all();
select results_eq($$select (metric_at_open->>'window')::int,(metric_at_open->>'total')::int,
 (metric_at_open->>'p50')::int from incidents i join features f on f.id=i.feature_id
 where f.route='/sparse' and i.kind='slow' and i.status='open'$$,
 'values (30,5,1400)','12:13 evaluation includes one 11:44 and four 12:12 successes in the fallback window');
select results_eq($$select f.route,c.email,c.digest from claim_notifications(10) c
 join incidents i on i.id=c.incident join features f on f.id=i.feature_id
 where c.channel='email' and c.event='open' and c.kind='slow' order by f.route$$,
 $$values ('/busy','member@example.invalid',false),('/sparse','member@example.invalid',false)$$,
 'first evaluation queues a separate immediate email for each newly slow feature of the same member');
select * from finish();
rollback;
