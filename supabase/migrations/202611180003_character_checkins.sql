begin;
create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 push_enabled boolean not null default false,
 quiet_hours boolean not null default true,
 awaiting_document uuid,
 last_checkin_at timestamptz
);
create table public.push_devices (
 token text primary key check(length(token) between 20 and 4096),
 user_id uuid not null references auth.users(id) on delete cascade,
 updated_at timestamptz not null default now()
);
create index on public.push_devices(user_id);
create table public.character_activity (
 document_id uuid primary key references public.documents(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 user_turns integer not null,
 last_user_at timestamptz not null
);
create index on public.character_activity(user_id,last_user_at desc);
create table public.character_checkins (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 document_id uuid not null references public.documents(id) on delete cascade,
 day date not null,
 user_turns integer not null,
 body text not null,
 character_name text not null,
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
 unique(user_id,day)
);
alter table public.notification_preferences enable row level security;
alter table public.push_devices enable row level security;
alter table public.character_activity enable row level security;
alter table public.character_checkins enable row level security;
revoke all on public.notification_preferences,public.push_devices,public.character_activity,public.character_checkins from anon,authenticated;
grant all on public.notification_preferences,public.push_devices,public.character_activity,public.character_checkins to service_role;

-- Only a newly persisted, completed user exchange resets the inactivity clock.
create function public.track_character_activity() returns trigger language plpgsql security definer set search_path=public as $$
declare turns integer; previous integer;
begin
 if new.kind not in ('studio','character') or new.deleted_at is not null then return new; end if;
 select count(*) into turns from jsonb_array_elements(coalesce(new.payload->'chat'->'archive',new.payload->'chat'->'committed','[]'::jsonb)) m where m->>'role'='user';
 if turns=0 then return new; end if;
 insert into notification_preferences(user_id) values(new.user_id) on conflict do nothing;
 perform 1 from notification_preferences where user_id=new.user_id for update;
 select user_turns into previous from character_activity where document_id=new.id;
 if previous is null or turns>previous then
  insert into character_activity(document_id,user_id,user_turns,last_user_at) values(new.id,new.user_id,turns,now())
  on conflict(document_id) do update set user_turns=excluded.user_turns,last_user_at=excluded.last_user_at;
  update notification_preferences set awaiting_document=null where user_id=new.user_id and awaiting_document=new.id;
  update character_checkins set status='cancelled' where user_id=new.user_id and document_id=new.id and status='pending';
 end if;
 return new;
end $$;
create trigger track_character_activity after insert or update of payload on public.documents for each row execute function public.track_character_activity();

-- Reserve at most one greeting per KST date across every character, under an account lock.
create function public.prepare_character_checkins(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path=public as $$
declare pref notification_preferences; candidate record; total integer:=0; nickname text; greeting text; stamp timestamptz:=p_now;
begin
 for pref in select p.* from notification_preferences p where p.push_enabled and p.awaiting_document is null
 and exists(select 1 from push_devices t where t.user_id=p.user_id)
 and exists(select 1 from character_activity a join documents d on d.id=a.document_id where a.user_id=p.user_id and d.deleted_at is null and d.kind in ('studio','character'))
 and not exists(select 1 from character_activity a join documents d on d.id=a.document_id where a.user_id=p.user_id and d.deleted_at is null and d.kind in ('studio','character') and a.last_user_at>stamp-interval '24 hours')
 and (not p.quiet_hours or extract(hour from stamp at time zone 'Asia/Seoul') between 8 and 21)
 and (p.last_checkin_at is null or (p.last_checkin_at at time zone 'Asia/Seoul')::date < (stamp at time zone 'Asia/Seoul')::date)
 order by p.user_id limit 20 for update skip locked loop
  select a.*,d.payload->'art'->'profile'->>'name' as character_name into candidate
  from character_activity a join documents d on d.id=a.document_id
  where a.user_id=pref.user_id and d.deleted_at is null and d.kind in ('studio','character')
  order by a.last_user_at desc,a.document_id limit 1;
  if not found or candidate.last_user_at>stamp-interval '24 hours' then continue; end if;
  select coalesce(nullif(raw_user_meta_data->'maite_profile'->>'nickname',''),'당신') into nickname from auth.users where id=pref.user_id;
  greeting:=case floor(random()*3)::integer when 0 then '뭐해?' when 1 then '나 안 보고 싶어?' else '보고 싶어, '||left(nickname,32)||case when nickname ~ '[가-힣]$' then case when (ascii(right(nickname,1))-44032)%28=0 then '야.' else '아.' end else '.' end end;
  insert into character_checkins(user_id,document_id,day,user_turns,body,character_name)
  values(pref.user_id,candidate.document_id,(stamp at time zone 'Asia/Seoul')::date,candidate.user_turns,greeting,coalesce(candidate.character_name,'캐릭터')) on conflict do nothing;
  if found then update notification_preferences set awaiting_document=candidate.document_id,last_checkin_at=stamp where user_id=pref.user_id; total:=total+1; end if;
 end loop;
 return total;
end $$;

-- Claim once before FCM; uncertain delivery is not retried to avoid duplicate pushes.
create function public.claim_character_checkins() returns setof public.character_checkins language plpgsql security definer set search_path=public as $$
begin
 update character_checkins c set status='cancelled' where c.status='pending' and (
 not exists(select 1 from documents d where d.id=c.document_id and d.deleted_at is null)
 or not exists(select 1 from notification_preferences p where p.user_id=c.user_id and p.push_enabled and p.awaiting_document=c.document_id));
 return query update character_checkins c set status='sending' where c.id in (
 select q.id from character_checkins q join notification_preferences p on p.user_id=q.user_id
 where q.status='pending' and p.push_enabled and p.awaiting_document=q.document_id
 and (not p.quiet_hours or extract(hour from now() at time zone 'Asia/Seoul') between 8 and 21)
 order by q.created_at limit 20 for update of q skip locked) returning c.*;
end $$;
revoke execute on function public.track_character_activity(),public.prepare_character_checkins(timestamptz),public.claim_character_checkins() from public,anon,authenticated;
grant execute on function public.prepare_character_checkins(timestamptz),public.claim_character_checkins() to service_role;
commit;
