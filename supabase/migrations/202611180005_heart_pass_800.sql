-- Requires 202611180004_heart_product_amounts.sql.
-- Future pass purchases: 200 immediately + 20 per claim day for 30 days.
-- Existing balances, purchase receipts and pass daily_hearts are unchanged.
begin;

create or replace function public.grant_purchase(p_user uuid,p_hash text,p_product text,p_order text) returns boolean
language plpgsql security definer set search_path = public as $$
declare amount integer; d date := (now() at time zone 'Asia/Seoul')::date; existing payment_purchases;
begin
 perform 1 from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 select * into existing from payment_purchases where token_hash=p_hash;
 if found then
  if existing.user_id<>p_user or existing.product_id<>p_product then raise exception 'invalid_purchase'; end if;
  return false;
 end if;
 amount:=case p_product when 'hearts_100' then 150 when 'hearts_300' then 400 when 'hearts_700' then 1000 when 'heart_pass_30' then 200 else null end;
 if amount is null then raise exception 'invalid_product'; end if;
 if p_product='heart_pass_30' then
  if exists(select 1 from heart_passes where user_id=p_user and ends_on>d) then raise exception 'pass_active'; end if;
  insert into heart_passes(user_id,starts_on,ends_on,daily_hearts) values(p_user,d,d+30,20) on conflict(user_id) do update set starts_on=d,ends_on=d+30,daily_hearts=20;
 end if;
 insert into payment_purchases(token_hash,user_id,product_id,order_id) values(p_hash,p_user,p_product,p_order);
 update wallets set transferable=transferable+amount where user_id=p_user;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'purchase:'||p_hash,amount,p_product);
 return true;
end $$;

revoke execute on function public.grant_purchase(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.grant_purchase(uuid,text,text,text) to service_role;

commit;
