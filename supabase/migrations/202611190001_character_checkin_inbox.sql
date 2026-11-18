-- Preserve existing greetings. Each character now has its own daily limit and read state.
begin;
alter table public.character_checkins add column if not exists read_at timestamptz;
alter table public.character_checkins drop constraint if exists character_checkins_user_id_day_key;
create unique index if not exists character_checkins_character_day_key
 on public.character_checkins(user_id,document_id,day);
create index if not exists character_checkins_unread_idx
 on public.character_checkins(user_id,document_id) where read_at is null and status in ('sent','sending','failed');
create index if not exists character_checkins_latest_idx
 on public.character_checkins(user_id,document_id,created_at desc);

create or replace function public.character_checkin_latest(p_user uuid)
returns table(document_id uuid,user_turns integer,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
 select distinct on (c.document_id) c.document_id,c.user_turns,c.created_at
 from character_checkins c where c.user_id=p_user and c.status in ('sent','sending','failed')
 order by c.document_id,c.created_at desc;
$$;
revoke all on function public.character_checkin_latest(uuid) from public,anon,authenticated;
grant execute on function public.character_checkin_latest(uuid) to service_role;
commit;
