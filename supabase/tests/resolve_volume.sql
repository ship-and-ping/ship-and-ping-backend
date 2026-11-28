begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000053');
insert into apps(owner_id,name) select id,'volume' from auth.users;
insert into alert_channels(app_id,owner_id,email_enabled) select id,owner_id,true from apps
 on conflict(app_id) do update set email_enabled=true;
insert into features(app_id,kind,method,route,name)
 select a.id,'auto','GET','/'||f.name,f.name from apps a cross join (values ('busy'),('rare'),('expired')) f(name);
insert into app_versions(app_id,version) select id,'old' from apps;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'old',date_bin('5 minutes',now(),timestamptz 'epoch')-age*interval '1 minute',n,0,0,60000*n,array_fill(0,array[15])||array[n]
 from features cross join (values (10,1800,5),(5,200,10),(0,500,500)) buckets(age,busy,rare)
 cross join lateral (select case name when 'rare' then rare else busy end n) x;
select evaluate_all();
select is((select i.kind from incidents i join features f on f.id=i.feature_id where f.name='busy'),'slow','heavy traffic opens a slow incident');
select is((select (metric_at_open->>'requests_per_minute')::numeric from incidents i join features f on f.id=i.feature_id where f.name='busy'),200::numeric,'two complete buckets include 1800 + 200 and exclude partial bucket');
select is((select (metric_at_open->>'requests_per_minute')::numeric from incidents i join features f on f.id=i.feature_id where f.name='rare'),1.5::numeric,'rare opening rate');
delete from stats_5m;
update incidents set opened_at=now()-interval '20 minutes';
insert into app_versions(app_id,version) select id,'new' from apps;
insert into private.latest_results(app_id,feature_id,version,received_at,position,ms,success)
 select app_id,id,'new',now()-interval '1 minute',n,10,true from features cross join generate_series(1,5) n;
insert into stats_5m(app_id,feature_id,version,bucket,total,failures,client_errors,duration_sum_ms,hist)
 select app_id,id,'new',date_bin('5 minutes',now(),timestamptz 'epoch')-interval '5 minutes',n,0,0,n,array[n]||array_fill(0,array[15])
 from features cross join lateral (select case name when 'rare' then 1 else 50 end n) x;
select evaluate_all();
select ok((select volume_quiet_since is not null and status='open' from incidents i join features f on f.id=i.feature_id where f.name='busy'),'200 to 5/min waits for comparable load');
select is((select status from incidents i join features f on f.id=i.feature_id where f.name='rare'),'resolved','low-volume feature skips comparison');
update incidents set volume_quiet_since=now()-interval '24 hours' where feature_id=(select id from features where name='expired');
select evaluate_all();
select ok((select i.status='quiet' and i.closed_at is not null and i.resolved_version is null
 and (private.volume_comparison(i)->>'volume_unverified')::boolean from incidents i join features f on f.id=i.feature_id
 where f.name='expired'),'24 hours without comparable traffic closes as unverified');
select ok(exists(select from claim_notifications(100) where event='volume_unverified'),'unverified closure notification can be delivered');
update stats_5m set total=999,hist=array[999]||array_fill(0,array[15]);
select evaluate_all();
select ok((select volume_recovered_at is null and status='open' from incidents i join features f on f.id=i.feature_id where f.name='busy'),'just below half still waits');
select is((select count(*) from notifications n join incidents i on i.id=n.incident_id join features f on f.id=i.feature_id
 where f.name='busy' and n.channel='email' and n.event='volume_quiet'),1::bigint,'quiet notification queued once');
update stats_5m set total=1000,hist=array[1000]||array_fill(0,array[15]);
select evaluate_all();
select is((select status from incidents i join features f on f.id=i.feature_id where f.name='busy'),'open','old proof cannot resolve after load returns');
select ok((select private.volume_comparison(i) @> '{"volume_quiet":false,"volume_recovering":true}'::jsonb
 from incidents i join features f on f.id=i.feature_id where f.name='busy'),'recovering traffic clears the low-volume guidance before proof arrives');
insert into private.latest_results(app_id,feature_id,version,received_at,position,ms,success)
 select app_id,id,'new',clock_timestamp(),n,10,true from features cross join generate_series(6,10) n;
select evaluate_all();
select is((select status from incidents i join features f on f.id=i.feature_id where f.name='busy'),'resolved','five fresh successes at half the opening rate resolve');
select * from finish();
rollback;
