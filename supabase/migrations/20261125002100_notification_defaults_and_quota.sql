create function private.create_alert_channel() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.alert_channels(app_id,owner_id,email_enabled) values(new.id,new.owner_id,true);
 return new;
end $$;
create trigger create_alert_channel after insert on public.apps
 for each row execute function private.create_alert_channel();

insert into public.alert_channels(app_id,owner_id,email_enabled)
 select id,owner_id,true from public.apps on conflict(app_id) do nothing;

-- Previous buckets used Seoul dates. Conservatively carry all overlapping usage
-- for this UTC day because individual reservation times were not recorded.
insert into private.mail_quota(day,used)
 select (now() at time zone 'UTC')::date,least(90,coalesce(sum(used),0)) from private.mail_quota
 where day between (now() at time zone 'UTC')::date and (now() at time zone 'Asia/Seoul')::date
 on conflict(day) do update set used=excluded.used;
delete from private.mail_quota where day>(now() at time zone 'UTC')::date;

create table private.member_mail_quota(
 owner_id uuid primary key references auth.users on delete cascade,
 day date not null, used integer not null
);
drop function public.reserve_mail();
create function public.reserve_mail(app uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare
 today date := (now() at time zone 'UTC')::date;
 member uuid;
 global_used integer;
begin
 select owner_id into strict member from public.apps where id=app;
 insert into private.mail_quota(day,used) values(today,0) on conflict do nothing;
 select used into global_used from private.mail_quota where day=today for update;
 if global_used>=90 then return false; end if;
 insert into private.member_mail_quota as q(owner_id,day,used) values(member,today,1)
 on conflict(owner_id) do update set day=today,used=case when q.day=today then q.used+1 else 1 end
 where q.day<>today or q.used<20;
 if not found then return false; end if;
 update private.mail_quota set used=used+1 where day=today;
 return true;
end $$;
revoke all on function public.reserve_mail(uuid) from public,anon,authenticated;
grant execute on function public.reserve_mail(uuid) to service_role;

create or replace function public.defer_mail(id uuid,token uuid) returns void
language sql security definer set search_path='' as $$
 update public.notifications n set digest=true,claim_token=null,claimed_at=null,
 available_at=(((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC')
 where n.claim_token=$2 and n.channel='email'
 and exists(select from public.notifications leader where leader.id=$1 and leader.claim_token=$2)
$$;
