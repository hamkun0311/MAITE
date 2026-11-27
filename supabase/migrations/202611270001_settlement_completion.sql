begin;

alter table public.heart_settlements
  add column completed_at timestamptz,
  add column completed_by uuid references auth.users(id),
  add constraint heart_settlements_completion_consistent check (
    (completed_at is null and completed_by is null) or
    (completed_at is not null and completed_by is not null and cancelled_at is null)
  );

create function public.complete_heart_settlement(p_id uuid, p_operator uuid) returns timestamptz
language plpgsql security definer set search_path=public as $$
declare entry heart_settlements;
begin
  select * into entry from heart_settlements where id=p_id for update;
  if not found then raise exception 'settlement_not_found'; end if;
  if entry.cancelled_at is not null then raise exception 'settlement_already_cancelled'; end if;
  if entry.completed_at is not null then return entry.completed_at; end if;

  update heart_settlements set completed_at=clock_timestamp(), completed_by=p_operator
    where id=entry.id returning completed_at into entry.completed_at;
  return entry.completed_at;
end $$;
revoke execute on function public.complete_heart_settlement(uuid,uuid) from public, anon, authenticated;
grant execute on function public.complete_heart_settlement(uuid,uuid) to service_role;

create or replace function public.cancel_heart_settlement(p_user uuid, p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare entry heart_settlements; cancelled timestamptz;
begin
  perform 1 from wallets where user_id=p_user for update;
  if not found then raise exception 'invalid_account'; end if;
  select * into entry from heart_settlements where id=p_id and user_id=p_user for update;
  if not found then raise exception 'settlement_not_found'; end if;
  if entry.cancelled_at is not null then return; end if;
  if entry.completed_at is not null then raise exception 'settlement_already_completed'; end if;
  cancelled:=clock_timestamp();
  if entry.payout_on<=(cancelled at time zone 'Asia/Seoul')::date then
    raise exception 'settlement_cancel_closed';
  end if;
  update wallets set transferable=transferable+entry.hearts where user_id=p_user;
  update heart_settlements set cancelled_at=cancelled where id=entry.id;
  insert into heart_ledger(user_id,reference,transferable,reason)
  values(p_user,'settlement-cancel:'||entry.id,entry.hearts,'settlement_cancelled');
end $$;

commit;
