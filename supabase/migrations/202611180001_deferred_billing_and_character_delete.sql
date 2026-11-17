-- Reserve capacity without debiting the wallet; settle only a stored, successful result.
-- Existing version-1 jobs retain their original prepaid/refund semantics.
begin;
alter table public.generation_jobs add column if not exists settlement_version smallint not null default 1 check(settlement_version in (1,2));
alter table public.generation_jobs add column if not exists held_bonus integer not null default 0 check(held_bonus>=0);
alter table public.generation_jobs add column if not exists held_transferable integer not null default 0 check(held_transferable>=0);
alter table public.generation_jobs add column if not exists held_free integer not null default 0 check(held_free between 0 and 1);
alter table public.documents add column if not exists deleted_at timestamptz;
create index if not exists generation_active_holds on public.generation_jobs(user_id) where status='reserved' and settlement_version=2;

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
 cost:=case p_kind when 'character' then 50 when 'chat' then 2 when 'story' then 15 when 'illustration' then 50 when 'outfit' then 30 else null end;
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

-- Old deployments can coexist with this migration, but now also defer debits.
create or replace function public.reserve_generation(p_user uuid,p_id uuid,p_kind text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin return reserve_generation_v2(p_user,p_id,p_kind,p_fingerprint); end $$;

create or replace function public.finish_generation(p_user uuid,p_id uuid,p_result jsonb,p_storage text default null,p_success boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare j generation_jobs; w wallets;
begin
 select * into w from wallets where user_id=p_user for update;
 select * into j from generation_jobs where id=p_id and user_id=p_user for update;
 if not found then raise exception 'invalid_job'; end if;
 if j.status<>'reserved' then return; end if;
 if p_success then
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>500000 then raise exception 'invalid_result'; end if;
  if j.settlement_version=2 then
   if j.kind in ('character','outfit','illustration') then
    if p_storage is distinct from p_user::text||'/'||p_id::text||'.jpg' or jsonb_typeof(p_result->'headers') is distinct from 'object' then raise exception 'invalid_result'; end if;
   else
    if jsonb_typeof(p_result->'events') is distinct from 'array' then raise exception 'invalid_result'; end if;
    if not exists(select 1 from jsonb_array_elements(p_result->'events') e where e->>'type'='done')
     or exists(select 1 from jsonb_array_elements(p_result->'events') e where e->>'type'='error')
     or not exists(select 1 from jsonb_array_elements(p_result->'events') e where e->>'type'=case when j.kind='story' then 'chapter' else 'delta' end and length(btrim(coalesce(e->>'text','')))>0)
    then raise exception 'invalid_result'; end if;
   end if;
   if w.bonus<j.held_bonus or w.transferable<j.held_transferable or w.free_chats<j.held_free then raise exception 'insufficient_hearts'; end if;
   update wallets set bonus=bonus-j.held_bonus,transferable=transferable-j.held_transferable,free_chats=free_chats-j.held_free where user_id=p_user;
   insert into heart_ledger(user_id,reference,transferable,bonus,free_chats,reason)
   values(p_user,'generation:'||p_id,-j.held_transferable,-j.held_bonus,-j.held_free,j.kind);
  end if;
  update generation_jobs set status='completed',result=p_result,storage_path=p_storage,completed_at=now(),
   spent_bonus=case when settlement_version=2 then held_bonus else spent_bonus end,
   spent_transferable=case when settlement_version=2 then held_transferable else spent_transferable end,
   spent_free=case when settlement_version=2 then held_free else spent_free end,
   held_bonus=0,held_transferable=0,held_free=0 where id=p_id;
 else
  if j.settlement_version=1 then
   update wallets set bonus=bonus+j.spent_bonus,transferable=transferable+j.spent_transferable,free_chats=free_chats+j.spent_free where user_id=p_user;
   insert into heart_ledger(user_id,reference,transferable,bonus,free_chats,reason)
   values(p_user,'refund:'||p_id,j.spent_transferable,j.spent_bonus,j.spent_free,'generation_failed');
  end if;
  update generation_jobs set status='failed',result=p_result,completed_at=now(),held_bonus=0,held_transferable=0,held_free=0 where id=p_id;
 end if;
end $$;

-- A purchase and its entitlement are committed in one transaction. Respect pending generation holds.
create or replace function public.buy_listing(p_user uuid,p_id uuid,p_listing uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare l store_listings; price integer; fee integer; o store_orders; held integer; balance integer;
begin
 select * into l from store_listings where id=p_listing and active for update;
 if not found or l.seller_id=p_user then raise exception 'invalid_listing'; end if;
 perform 1 from wallets where user_id in (p_user,l.seller_id) order by user_id for update;
 select * into o from store_orders where listing_id=p_listing and buyer_id=p_user;
 if found then return to_jsonb(o); end if;
 price:=case l.kind when 'character' then 30 else 10 end;
 fee:=case l.kind when 'character' then 5 else 2 end;
 select transferable into balance from wallets where user_id=p_user;
 select coalesce(sum(held_transferable),0) into held from generation_jobs where user_id=p_user and status='reserved' and settlement_version=2;
 if balance-held<price+fee then
  if balance>=price+fee and held>0 then raise exception 'hearts_in_use'; end if;
  raise exception 'insufficient_hearts';
 end if;
 insert into store_orders(id,listing_id,buyer_id,seller_id,base_price,buyer_fee,seller_fee)
 values(p_id,p_listing,p_user,l.seller_id,price,fee,fee) returning * into o;
 update wallets set transferable=transferable-price-fee where user_id=p_user;
 update wallets set transferable=transferable+price-fee where user_id=l.seller_id;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'buy:'||p_id,-price-fee,'store_purchase');
 insert into heart_ledger(user_id,reference,transferable,reason) values(l.seller_id,'sell:'||p_id,price-fee,'store_sale');
 return to_jsonb(o);
end $$;

-- Keep financial results and buyers' immutable copies. Hide the owner's library graph and stop its sales.
create or replace function public.delete_character(p_user uuid,p_document uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d documents; ids uuid[];
begin
 select * into d from documents where id=p_document and user_id=p_user and kind in ('studio','character') for update;
 if not found then raise exception 'invalid_document'; end if;
 if d.deleted_at is not null then return jsonb_build_object('documentIds',jsonb_build_array(p_document)); end if;
 select array_agg(id) into ids from documents where user_id=p_user and deleted_at is null
 and (id=p_document or (kind='chapter' and (payload->>'id'=p_document::text or id::text=d.payload->'story'->>'documentId')));
 update documents set deleted_at=now(),updated_at=now() where user_id=p_user and id=any(ids);
 update store_listings set active=false where seller_id=p_user and (
  (kind='character' and ((content->>'sourceDocumentId'=p_document::text) or (not(content ? 'sourceDocumentId') and content->>'imageJobId'=d.payload->'art'->>'jobId')))
  or (kind='chapter' and exists(select 1 from unnest(ids) i where i::text=content->'novel'->>'id')));
 return jsonb_build_object('documentIds',to_jsonb(ids));
end $$;
revoke execute on function public.reserve_generation_v2(uuid,uuid,text,text), public.delete_character(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_generation_v2(uuid,uuid,text,text), public.delete_character(uuid,uuid) to service_role;
commit;
