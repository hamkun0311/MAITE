begin;

alter table public.heart_settlements add column cancelled_at timestamptz;

create function public.cancel_heart_settlement(p_user uuid, p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare entry heart_settlements; cancelled timestamptz;
begin
  perform 1 from wallets where user_id=p_user for update;
  if not found then raise exception 'invalid_account'; end if;
  select * into entry from heart_settlements where id=p_id and user_id=p_user for update;
  if not found then raise exception 'settlement_not_found'; end if;
  if entry.cancelled_at is not null then return; end if;
  cancelled:=clock_timestamp();
  if entry.payout_on<=(cancelled at time zone 'Asia/Seoul')::date then
    raise exception 'settlement_cancel_closed';
  end if;
  update wallets set transferable=transferable+entry.hearts where user_id=p_user;
  update heart_settlements set cancelled_at=cancelled where id=entry.id;
  insert into heart_ledger(user_id,reference,transferable,reason)
  values(p_user,'settlement-cancel:'||entry.id,entry.hearts,'settlement_cancelled');
end $$;
revoke execute on function public.cancel_heart_settlement(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cancel_heart_settlement(uuid,uuid) to service_role;

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index notices_recent on public.notices (created_at desc, id desc);
alter table public.notices enable row level security;
revoke all on public.notices from public, anon, authenticated;
grant select,insert on public.notices to service_role;

commit;
