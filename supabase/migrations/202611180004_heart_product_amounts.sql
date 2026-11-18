-- Update future purchases only. Existing balances and purchase receipts are preserved.
-- Keep the already registered Google Play product IDs and purchase-token idempotency.
begin;

-- Existing passes retain their originally purchased daily benefit.
alter table public.heart_passes add column if not exists daily_hearts integer not null default 10 check (daily_hearts between 0 and 100);

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
 amount:=case p_product when 'hearts_100' then 150 when 'hearts_300' then 400 when 'hearts_700' then 1000 when 'heart_pass_30' then 150 else null end;
 if amount is null then raise exception 'invalid_product'; end if;
 if p_product='heart_pass_30' then
  if exists(select 1 from heart_passes where user_id=p_user and ends_on>d) then raise exception 'pass_active'; end if;
  insert into heart_passes(user_id,starts_on,ends_on,daily_hearts) values(p_user,d,d+30,15) on conflict(user_id) do update set starts_on=d,ends_on=d+30,daily_hearts=15;
 end if;
 insert into payment_purchases(token_hash,user_id,product_id,order_id) values(p_hash,p_user,p_product,p_order);
 update wallets set transferable=transferable+amount where user_id=p_user;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'purchase:'||p_hash,amount,p_product);
 return true;
end $$;

create or replace function public.claim_daily(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; n integer; pass_amount integer; total integer := 0;
begin
 perform 1 from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 n := case when extract(dow from d)=0 then 15 else 5 end;
 insert into daily_claims values(p_user,d,'attendance',n) on conflict do nothing;
 if found then
  update wallets set bonus=bonus+n where user_id=p_user;
  insert into heart_ledger(user_id,reference,bonus,reason) values(p_user,'attendance:'||d,n,'attendance'); total:=total+n;
 end if;
 select daily_hearts into pass_amount from heart_passes where user_id=p_user and d>=starts_on and d<ends_on;
 if found and pass_amount>0 then
  insert into daily_claims values(p_user,d,'pass',pass_amount) on conflict do nothing;
  if found then
   update wallets set transferable=transferable+pass_amount where user_id=p_user;
   insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'pass:'||d,pass_amount,'pass'); total:=total+pass_amount;
  end if;
 end if;
 return jsonb_build_object('claimed',total,'day',d);
end $$;

revoke execute on function public.grant_purchase(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.grant_purchase(uuid,text,text,text) to service_role;

revoke execute on function public.claim_daily(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily(uuid) to service_role;

commit;
