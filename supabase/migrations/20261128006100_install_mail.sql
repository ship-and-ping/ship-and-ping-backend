create table private.install_mail_quota (
 owner_id uuid primary key references auth.users on delete cascade,
 day date not null,
 used smallint not null,
 last_sent timestamptz not null
);

-- The Worker forwards the member JWT. There is no recipient or member argument.
create function public.reserve_install_mail() returns text
language plpgsql security definer set search_path='' as $$
declare
 member uuid := auth.uid();
 recipient text;
 today date := (now() at time zone 'UTC')::date;
 global_used integer;
begin
 select email into recipient from auth.users
 where id=member and email_confirmed_at is not null and email <> '';
 if recipient is null then raise exception 'verified member required' using errcode='42501'; end if;

 -- Use the same lock order and daily total as incident email reservations.
 insert into private.mail_quota(day,used) values(today,0) on conflict do nothing;
 select used into global_used from private.mail_quota where day=today for update;
 if global_used >= 90 then return null; end if;
 insert into private.install_mail_quota as q(owner_id,day,used,last_sent)
 values(member,today,1,now())
 on conflict(owner_id) do update
 set day=today, used=case when q.day=today then q.used+1 else 1 end, last_sent=now()
 where q.last_sent <= now()-interval '10 minutes' and (q.day<>today or q.used<5);
 if not found then return null; end if;
 update private.mail_quota set used=used+1 where day=today;
 return recipient;
end $$;
revoke all on function public.reserve_install_mail() from public,anon,service_role;
grant execute on function public.reserve_install_mail() to authenticated;
