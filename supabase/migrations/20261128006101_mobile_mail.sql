-- Only the Worker authenticates the member and reserves a provider send.
drop function public.reserve_install_mail();
create table private.install_mail_events (
 receipt uuid primary key default gen_random_uuid(),
 member uuid references auth.users on delete set null,
 kind text not null check (kind in ('guide','code')),
 day date not null default ((now() at time zone 'UTC')::date),
 sent_at timestamptz not null default now()
);
create index on private.install_mail_events(member,kind,sent_at);
-- Keep already-used allowances during a rolling deployment.
insert into private.install_mail_events(member,kind,day,sent_at)
 select q.owner_id,'guide',q.day,q.last_sent
 from private.install_mail_quota q cross join lateral generate_series(1,q.used);
drop table private.install_mail_quota;

create function private.reserve_mobile_mail(p_member uuid,p_kind text) returns jsonb
language plpgsql set search_path='' as $$
declare
 today date := (now() at time zone 'UTC')::date;
 cooldown interval := case when p_kind='guide' then interval '10 minutes' else interval '1 minute' end;
 recipient text;
 ticket uuid;
begin
 select email into recipient from auth.users where id=p_member and email_confirmed_at is not null
   and email<>'' and deleted_at is null and (banned_until is null or banned_until<=now());
 if recipient is null then return null; end if;
 insert into private.mail_quota(day,used) values(today,0) on conflict do nothing;
 perform from private.mail_quota where day=today and used<90 for update;
 if not found then return null; end if;
 if exists(select from private.install_mail_events where member=p_member and kind=p_kind and sent_at>now()-cooldown)
 or (select count(*) from private.install_mail_events where member=p_member and kind=p_kind and day=today)>=5 then
   return null;
 end if;
 insert into private.install_mail_events(member,kind) values(p_member,p_kind) returning receipt into ticket;
 update private.mail_quota set used=used+1 where day=today;
 return jsonb_build_object('receipt',ticket,'email',recipient);
end $$;

create function public.reserve_install_mail(p_member uuid) returns jsonb
language sql security definer set search_path='' as $$ select private.reserve_mobile_mail(p_member,'guide') $$;

create table private.install_login_codes (
 member uuid primary key references auth.users on delete cascade,
 receipt uuid not null references private.install_mail_events on delete cascade,
 proof text not null,
 mistakes smallint not null default 0 check (mistakes between 0 and 5),
 expires_at timestamptz not null
);

create function public.release_install_mail(p_receipt uuid) returns void
language plpgsql security definer set search_path='' as $$
declare booked date;
begin
 select day into booked from private.install_mail_events where receipt=p_receipt;
 if booked is null then return; end if;
 perform from private.mail_quota where day=booked for update;
 delete from private.install_mail_events where receipt=p_receipt;
 if found then update private.mail_quota set used=greatest(0,used-1) where day=booked; end if;
end $$;

create function public.issue_install_code(p_email text,p_ip text,p_proof text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; ticket jsonb;
begin
 if not private.login_allow('install-code-request',p_ip,20) then return null; end if;
 select id into uid from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if uid is null then return null; end if;
 ticket := private.reserve_mobile_mail(uid,'code');
 if ticket is null then return null; end if;
 insert into private.install_login_codes(member,receipt,proof,expires_at)
 values(uid,(ticket->>'receipt')::uuid,p_proof,clock_timestamp()+interval '10 minutes')
 on conflict(member) do update set receipt=excluded.receipt,proof=excluded.proof,mistakes=0,expires_at=excluded.expires_at;
 return ticket;
end $$;

create function public.consume_install_code(p_email text,p_ip text,p_proof text) returns uuid
language plpgsql security definer set search_path='' as $$
declare challenge private.install_login_codes;
begin
 if not private.login_allow('install-code-verify',p_ip,50) then return null; end if;
 select c.* into challenge from private.install_login_codes c join auth.users u on u.id=c.member
 where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()) for update of c;
 if not found or challenge.expires_at<=clock_timestamp() or challenge.mistakes>=5 then return null; end if;
 if challenge.proof is distinct from p_proof then
   update private.install_login_codes set mistakes=mistakes+1 where member=challenge.member;
   return null;
 end if;
 delete from private.install_login_codes where member=challenge.member;
 return challenge.member;
end $$;

alter function private.cleanup_daily() rename to cleanup_before_install_mail;
create function private.cleanup_daily() returns void language plpgsql set search_path='' as $$
begin
 perform private.cleanup_before_install_mail();
 delete from private.install_login_codes where expires_at<=now();
 delete from private.install_mail_events where sent_at<now()-interval '2 days';
end $$;
revoke all on private.install_mail_events,private.install_login_codes from public,anon,authenticated,service_role;
revoke all on function private.reserve_mobile_mail(uuid,text),private.cleanup_daily() from public,anon,authenticated,service_role;
revoke all on function public.reserve_install_mail(uuid),public.release_install_mail(uuid),
 public.issue_install_code(text,text,text),public.consume_install_code(text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_install_mail(uuid),public.release_install_mail(uuid),
 public.issue_install_code(text,text,text),public.consume_install_code(text,text,text) to service_role;
