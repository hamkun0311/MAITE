create or replace function public.buy_store_listing(p_user uuid, p_id uuid, p_listing uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare l store_listings; price integer; seller_fee integer; o store_orders; held integer; balance integer;
begin
 select * into l from store_listings where id=p_listing and active for update;
 if not found or l.seller_id=p_user then raise exception 'invalid_listing'; end if;
 perform 1 from wallets where user_id in (p_user,l.seller_id) order by user_id for update;
 select * into o from store_orders where listing_id=p_listing and buyer_id=p_user;
 if found then return to_jsonb(o); end if;
 price:=case l.kind when 'character' then 30 else 10 end;
 seller_fee:=case l.kind when 'character' then 5 else 2 end;
 select transferable into balance from wallets where user_id=p_user;
 select coalesce(sum(held_transferable),0) into held from generation_jobs where user_id=p_user and status='reserved' and settlement_version=2;
 if balance-held<price then
  if balance>=price and held>0 then raise exception 'hearts_in_use'; end if;
  raise exception 'insufficient_hearts';
 end if;
 insert into store_orders(id,listing_id,buyer_id,seller_id,base_price,buyer_fee,seller_fee)
 values(p_id,p_listing,p_user,l.seller_id,price,0,seller_fee) returning * into o;
 update wallets set transferable=transferable-price where user_id=p_user;
 update wallets set transferable=transferable+price-seller_fee where user_id=l.seller_id;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'buy:'||p_id,-price,'store_purchase');
 insert into heart_ledger(user_id,reference,transferable,reason) values(l.seller_id,'sell:'||p_id,price-seller_fee,'store_sale');
 return to_jsonb(o);
end $$;

revoke execute on function public.buy_store_listing(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.buy_store_listing(uuid,uuid,uuid) to service_role;

-- Existing deployments still call this RPC. Use the same pricing transaction.
create or replace function public.buy_listing(p_user uuid, p_id uuid, p_listing uuid) returns jsonb
language sql security definer set search_path=public as $$
 select public.buy_store_listing(p_user, p_id, p_listing);
$$;
