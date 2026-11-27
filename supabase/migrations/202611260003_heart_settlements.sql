begin;

create table public.heart_settlements (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 payout_on date not null check (extract(day from payout_on) = 10),
 hearts integer not null check (hearts between 500 and 1000000000 and hearts % 500 = 0),
 amount_won bigint generated always as (hearts::bigint * 2) stored,
 bank text not null check (char_length(btrim(bank)) between 1 and 60),
 account_number text not null check (account_number ~ '^[0-9]{4,32}$'),
 account_holder text not null check (char_length(btrim(account_holder)) between 1 and 80),
 consented_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index heart_settlements_owner on public.heart_settlements(user_id, created_at desc, id desc);
create index heart_settlements_schedule on public.heart_settlements(payout_on, created_at, id);
alter table public.heart_settlements enable row level security;
revoke all on public.heart_settlements from public, anon, authenticated;
grant select on public.heart_settlements to service_role;

create function public.request_heart_settlement(
 p_user uuid, p_id uuid, p_payout_on date, p_hearts integer, p_bank text,
 p_account_number text, p_account_holder text, p_consent boolean
) returns void language plpgsql security definer set search_path=public as $$
declare balance integer; held integer; existing heart_settlements;
begin
 if p_consent is distinct from true then raise exception 'settlement_consent_required'; end if;
 if p_hearts is null or p_hearts<500 or p_hearts>1000000000 or p_hearts % 500<>0 then
  raise exception 'invalid_settlement_amount';
 end if;
 select transferable into balance from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 select * into existing from heart_settlements where id=p_id;
 if found then
  if existing.user_id=p_user and existing.payout_on=p_payout_on and existing.hearts=p_hearts
   and existing.bank=p_bank and existing.account_number=p_account_number and existing.account_holder=p_account_holder then return; end if;
  raise exception 'invalid_settlement_request';
 end if;
 if p_payout_on is null or extract(day from p_payout_on)<>10 or p_payout_on<(now() at time zone 'Asia/Seoul')::date then
  raise exception 'invalid_settlement_month';
 end if;
 select coalesce(sum(held_transferable),0) into held from generation_jobs
 where user_id=p_user and status='reserved' and settlement_version=2;
 if balance-held<p_hearts then
  if balance>=p_hearts and held>0 then raise exception 'hearts_in_use'; end if;
  raise exception 'insufficient_settlement_hearts';
 end if;
 insert into heart_settlements(id,user_id,payout_on,hearts,bank,account_number,account_holder)
 values(p_id,p_user,p_payout_on,p_hearts,p_bank,p_account_number,p_account_holder);
 update wallets set transferable=transferable-p_hearts where user_id=p_user;
 insert into heart_ledger(user_id,reference,transferable,reason)
 values(p_user,'settlement:'||p_id,-p_hearts,'settlement_request');
end $$;
revoke execute on function public.request_heart_settlement(uuid,uuid,date,integer,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.request_heart_settlement(uuid,uuid,date,integer,text,text,text,boolean) to service_role;

create or replace function public.reserve_generation_v2(p_user uuid,p_id uuid,p_kind text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w wallets; j generation_jobs; cost integer; b integer; t integer; f integer:=0; hb integer; ht integer; hf integer;
begin
 select * into w from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 select * into j from generation_jobs where id=p_id;
 if found then
  if j.user_id<>p_user or j.kind<>p_kind or j.fingerprint<>p_fingerprint then raise exception 'invalid_job'; end if;
  return to_jsonb(j);
 end if;
 select coalesce(sum(held_bonus),0),coalesce(sum(held_transferable),0),coalesce(sum(held_free),0) into hb,ht,hf
 from generation_jobs where user_id=p_user and status='reserved' and settlement_version=2;
 cost:=case p_kind when 'character' then 50 when 'chat' then 2 when 'story' then 10 when 'illustration' then 50 when 'outfit' then 30 else null end;
 if cost is null then raise exception 'invalid_kind'; end if;
 if p_kind='chat' and w.free_chats-hf>0 then cost:=0; f:=1; end if;
 b:=least(cost,greatest(w.bonus-hb,0)); t:=cost-b;
 if w.transferable-ht<t then
  if w.bonus+w.transferable>=cost and hb+ht>0 then raise exception 'hearts_in_use'; end if;
  raise exception 'insufficient_hearts';
 end if;
 insert into generation_jobs(id,user_id,kind,fingerprint,settlement_version,held_bonus,held_transferable,held_free)
 values(p_id,p_user,p_kind,p_fingerprint,2,b,t,f) returning * into j;
 return to_jsonb(j);
end $$;

create function public.reserve_story_generation(p_user uuid,p_id uuid,p_fingerprint text) returns jsonb
language sql security definer set search_path=public as $$
 select public.reserve_generation_v2(p_user,p_id,'story',p_fingerprint);
$$;
revoke execute on function public.reserve_story_generation(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_story_generation(uuid,uuid,text) to service_role;

-- Bonus hearts stay outside settlement eligibility when passed to a seller.
create or replace function public.buy_store_listing(p_user uuid,p_id uuid,p_listing uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare l store_listings; o store_orders; w wallets; price integer; fee integer;
 hb integer; ht integer; b integer; t integer; seller_bonus integer; seller_transferable integer;
begin
 select * into l from store_listings where id=p_listing and active for update;
 if not found or l.seller_id=p_user then raise exception 'invalid_listing'; end if;
 perform 1 from wallets where user_id in (p_user,l.seller_id) order by user_id for update;
 select * into o from store_orders where listing_id=p_listing and buyer_id=p_user;
 if found then return to_jsonb(o); end if;
 select * into w from wallets where user_id=p_user;
 if not found then raise exception 'invalid_account'; end if;
 price:=case l.kind when 'character' then 30 else 10 end;
 fee:=case l.kind when 'character' then 5 else 2 end;
 select coalesce(sum(held_bonus),0),coalesce(sum(held_transferable),0) into hb,ht from generation_jobs
 where user_id=p_user and status='reserved' and settlement_version=2;
 b:=least(price,greatest(w.bonus-hb,0)); t:=price-b;
 if w.transferable-ht<t then
  if w.bonus+w.transferable>=price and hb+ht>0 then raise exception 'hearts_in_use'; end if;
  raise exception 'insufficient_hearts';
 end if;
 seller_bonus:=greatest(b-fee,0);
 seller_transferable:=price-fee-seller_bonus;
 insert into store_orders(id,listing_id,buyer_id,seller_id,base_price,buyer_fee,seller_fee)
 values(p_id,p_listing,p_user,l.seller_id,price,0,fee) returning * into o;
 update wallets set transferable=transferable-t,bonus=bonus-b where user_id=p_user;
 update wallets set transferable=transferable+seller_transferable,bonus=bonus+seller_bonus where user_id=l.seller_id;
 insert into heart_ledger(user_id,reference,transferable,bonus,reason) values
 (p_user,'buy:'||p_id,-t,-b,'store_purchase'),
 (l.seller_id,'sell:'||p_id,seller_transferable,seller_bonus,'store_sale');
 return to_jsonb(o);
end $$;

commit;
