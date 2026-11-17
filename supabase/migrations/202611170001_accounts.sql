-- Apply using Supabase migrations. Never expose service_role in the app.
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 display_name text not null default '', created_at timestamptz not null default now()
);
create table public.wallets (
 user_id uuid primary key references public.profiles on delete cascade,
 transferable integer not null default 0 check (transferable >= 0),
 bonus integer not null default 0 check (bonus >= 0),
 free_chats integer not null default 5 check (free_chats between 0 and 5)
);
create table public.heart_ledger (
 id bigint generated always as identity primary key, user_id uuid not null references public.profiles on delete cascade,
 reference text not null, transferable integer not null default 0, bonus integer not null default 0,
 free_chats integer not null default 0, reason text not null, created_at timestamptz not null default now(),
 unique(user_id, reference)
);
create table public.daily_claims (
 user_id uuid not null references public.profiles on delete cascade, day date not null,
 kind text not null check(kind in ('attendance','pass')), amount integer not null,
 primary key(user_id, day, kind)
);
create table public.heart_passes (
 user_id uuid primary key references public.profiles on delete cascade,
 starts_on date not null, ends_on date not null check (ends_on = starts_on + 30)
);
create table public.documents (
 id uuid primary key, user_id uuid not null references public.profiles on delete cascade,
 title text not null check(length(title) between 1 and 120),
 kind text not null check(kind in ('character','chapter','studio')),
 payload jsonb not null check(octet_length(payload::text) <= 500000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.generation_jobs (
 id uuid primary key, user_id uuid not null references public.profiles on delete cascade,
 kind text not null check(kind in ('character','chat','story','illustration','outfit')),
 fingerprint text not null, status text not null default 'reserved' check(status in ('reserved','completed','failed')),
 spent_transferable integer not null default 0, spent_bonus integer not null default 0, spent_free integer not null default 0,
 result jsonb, storage_path text, created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.payment_purchases (
 token_hash text primary key, user_id uuid not null references public.profiles on delete cascade,
 product_id text not null, order_id text, granted_at timestamptz not null default now(),
 acknowledged_at timestamptz
);
create table public.ad_reward_claims (
 transaction_id text primary key, user_id uuid not null references public.profiles on delete cascade,
 day date not null, created_at timestamptz not null default now()
);
create table public.store_listings (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles on delete cascade,
 kind text not null check(kind in ('character','chapter')), title text not null check(length(title) between 1 and 120),
 description text not null check(length(description) <= 2000),
 -- Immutable public-only snapshot. Never put private chat/memory here.
 content jsonb not null check(octet_length(content::text) <= 50000),
 storage_path text, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.store_orders (
 id uuid primary key, listing_id uuid not null references public.store_listings,
 buyer_id uuid not null references public.profiles on delete cascade,
 seller_id uuid not null references public.profiles on delete cascade,
 base_price integer not null, buyer_fee integer not null, seller_fee integer not null,
 created_at timestamptz not null default now(), unique(listing_id, buyer_id)
);
create table public.content_reports (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 listing_id uuid references public.store_listings, job_id uuid references public.generation_jobs,
 reason text not null check(length(reason) between 1 and 2000), created_at timestamptz not null default now()
);

create function public.initialize_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
 insert into profiles(id, display_name) values(new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''),80));
 insert into wallets(user_id) values(new.id);
 insert into heart_ledger(user_id,reference,free_chats,reason) values(new.id,'signup',5,'signup');
 return new;
end $$;
create trigger on_account_created after insert on auth.users for each row execute procedure public.initialize_account();
-- Existing auth accounts receive the one-time grant too; never re-grant on login.
insert into profiles(id) select id from auth.users on conflict do nothing;
insert into wallets(user_id) select id from profiles on conflict do nothing;
insert into heart_ledger(user_id,reference,free_chats,reason)
select user_id,'signup',5,'signup' from wallets on conflict(user_id,reference) do nothing;

create function public.claim_daily(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; n integer; total integer := 0;
begin
 perform 1 from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 n := case when extract(dow from d)=0 then 15 else 5 end;
 insert into daily_claims values(p_user,d,'attendance',n) on conflict do nothing;
 if found then
  update wallets set bonus=bonus+n where user_id=p_user;
  insert into heart_ledger(user_id,reference,bonus,reason) values(p_user,'attendance:'||d,n,'attendance'); total:=total+n;
 end if;
 if exists(select 1 from heart_passes where user_id=p_user and d>=starts_on and d<ends_on) then
  insert into daily_claims values(p_user,d,'pass',10) on conflict do nothing;
  if found then
   update wallets set transferable=transferable+10 where user_id=p_user;
   insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'pass:'||d,10,'pass'); total:=total+10;
  end if;
 end if;
 return jsonb_build_object('claimed',total,'day',d);
end $$;

create function public.reserve_generation(p_user uuid, p_id uuid, p_kind text, p_fingerprint text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets; j generation_jobs; cost integer; b integer; t integer; f integer := 0;
begin
 select * into w from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 select * into j from generation_jobs where id=p_id;
 if found then
  if j.user_id<>p_user or j.kind<>p_kind or j.fingerprint<>p_fingerprint then raise exception 'invalid_job'; end if;
  return to_jsonb(j);
 end if;
 cost := case p_kind when 'character' then 50 when 'chat' then 2 when 'story' then 15 when 'illustration' then 50 when 'outfit' then 30 else null end;
 if cost is null then raise exception 'invalid_kind'; end if;
 if p_kind='chat' and w.free_chats>0 then cost:=0; f:=1; end if;
 b:=least(cost,w.bonus); t:=cost-b;
 if w.transferable<t then raise exception 'insufficient_hearts'; end if;
 update wallets set bonus=bonus-b, transferable=transferable-t, free_chats=free_chats-f where user_id=p_user;
 insert into generation_jobs(id,user_id,kind,fingerprint,spent_bonus,spent_transferable,spent_free)
 values(p_id,p_user,p_kind,p_fingerprint,b,t,f) returning * into j;
 insert into heart_ledger(user_id,reference,transferable,bonus,free_chats,reason) values(p_user,'reserve:'||p_id,-t,-b,-f,p_kind);
 return to_jsonb(j);
end $$;

create function public.finish_generation(p_user uuid,p_id uuid,p_result jsonb,p_storage text default null,p_success boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare j generation_jobs;
begin
 perform 1 from wallets where user_id=p_user for update;
 select * into j from generation_jobs where id=p_id and user_id=p_user for update;
 if not found then raise exception 'invalid_job'; end if;
 if j.status<>'reserved' then return; end if;
 if p_success then
  if p_result is null or octet_length(p_result::text)>500000 then raise exception 'invalid_result'; end if;
  update generation_jobs set status='completed',result=p_result,storage_path=p_storage,completed_at=now() where id=p_id;
 else
  update wallets set bonus=bonus+j.spent_bonus,transferable=transferable+j.spent_transferable,free_chats=free_chats+j.spent_free where user_id=p_user;
  insert into heart_ledger(user_id,reference,transferable,bonus,free_chats,reason)
  values(p_user,'refund:'||p_id,j.spent_transferable,j.spent_bonus,j.spent_free,'generation_failed');
  update generation_jobs set status='failed',result=p_result,completed_at=now() where id=p_id;
 end if;
end $$;

create function public.grant_purchase(p_user uuid,p_hash text,p_product text,p_order text) returns boolean
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
 amount:=case p_product when 'hearts_100' then 100 when 'hearts_300' then 300 when 'hearts_700' then 700 when 'heart_pass_30' then 100 else null end;
 if amount is null then raise exception 'invalid_product'; end if;
 if p_product='heart_pass_30' then
  if exists(select 1 from heart_passes where user_id=p_user and ends_on>d) then raise exception 'pass_active'; end if;
  insert into heart_passes values(p_user,d,d+30) on conflict(user_id) do update set starts_on=d,ends_on=d+30;
 end if;
 insert into payment_purchases(token_hash,user_id,product_id,order_id) values(p_hash,p_user,p_product,p_order);
 update wallets set transferable=transferable+amount where user_id=p_user;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'purchase:'||p_hash,amount,p_product);
 return true;
end $$;

-- Generation handlers have a hard 5-minute maximum. Reclaim abandoned reservations after 15 minutes.
create function public.expire_generations(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare j generation_jobs;
begin
 perform 1 from wallets where user_id=p_user for update;
 for j in select * from generation_jobs where user_id=p_user and status='reserved' and created_at<now()-interval '15 minutes' order by created_at for update loop
  perform finish_generation(p_user,j.id,null,null,false);
 end loop;
end $$;

create function public.grant_ad_reward(p_user uuid,p_transaction text) returns boolean
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date;
begin
 perform 1 from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 if exists(select 1 from ad_reward_claims where transaction_id=p_transaction) then return false; end if;
 if (select count(*) from ad_reward_claims where user_id=p_user and day=d)>=5 then raise exception 'reward_limit'; end if;
 insert into ad_reward_claims(transaction_id,user_id,day) values(p_transaction,p_user,d);
 update wallets set bonus=bonus+5 where user_id=p_user;
 insert into heart_ledger(user_id,reference,bonus,reason) values(p_user,'ad:'||p_transaction,5,'ad_reward');
 return true;
end $$;

create function public.buy_listing(p_user uuid,p_id uuid,p_listing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l store_listings; price integer; fee integer; o store_orders;
begin
 select * into l from store_listings where id=p_listing and active;
 if not found or l.seller_id=p_user then raise exception 'invalid_listing'; end if;
 -- Consistent lock order across buyers/sellers prevents reciprocal-purchase deadlocks.
 perform 1 from wallets where user_id in (p_user,l.seller_id) order by user_id for update;
 select * into o from store_orders where listing_id=p_listing and buyer_id=p_user;
 if found then return to_jsonb(o); end if;
 price:=case l.kind when 'character' then 30 else 10 end;
 fee:=case l.kind when 'character' then 5 else 2 end;
 -- Ad/attendance bonus cannot be transferred to another account through the store.
 if (select transferable from wallets where user_id=p_user)<price+fee then raise exception 'insufficient_hearts'; end if;
 insert into store_orders(id,listing_id,buyer_id,seller_id,base_price,buyer_fee,seller_fee)
 values(p_id,p_listing,p_user,l.seller_id,price,fee,fee) returning * into o;
 update wallets set transferable=transferable-price-fee where user_id=p_user;
 update wallets set transferable=transferable+price-fee where user_id=l.seller_id;
 insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'buy:'||p_id,-price-fee,'store_purchase');
 insert into heart_ledger(user_id,reference,transferable,reason) values(l.seller_id,'sell:'||p_id,price-fee,'store_sale');
 return to_jsonb(o);
end $$;

-- All write RPCs are server-only, including functions taking a user UUID.
revoke execute on function public.initialize_account() from public, anon, authenticated;
revoke execute on function public.claim_daily(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_generation(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.finish_generation(uuid,uuid,jsonb,text,boolean) from public, anon, authenticated;
revoke execute on function public.grant_purchase(uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.grant_ad_reward(uuid,text) from public, anon, authenticated;
revoke execute on function public.buy_listing(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.expire_generations(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily(uuid), public.reserve_generation(uuid,uuid,text,text),
 public.finish_generation(uuid,uuid,jsonb,text,boolean), public.grant_purchase(uuid,text,text,text),
 public.grant_ad_reward(uuid,text), public.buy_listing(uuid,uuid,uuid), public.expire_generations(uuid) to service_role;

do $$ declare t text; begin
 foreach t in array array['profiles','wallets','heart_ledger','daily_claims','heart_passes','documents','generation_jobs','payment_purchases','ad_reward_claims','store_listings','store_orders','content_reports'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
grant select on profiles,wallets,heart_ledger,daily_claims,heart_passes,documents,generation_jobs,ad_reward_claims,store_orders to authenticated;
create policy own_profile on profiles for select to authenticated using(id=auth.uid());
create policy own_wallet on wallets for select to authenticated using(user_id=auth.uid());
create policy own_ledger on heart_ledger for select to authenticated using(user_id=auth.uid());
create policy own_daily on daily_claims for select to authenticated using(user_id=auth.uid());
create policy own_pass on heart_passes for select to authenticated using(user_id=auth.uid());
create policy own_docs on documents for select to authenticated using(user_id=auth.uid());
create policy own_jobs on generation_jobs for select to authenticated using(user_id=auth.uid());
create policy own_ads on ad_reward_claims for select to authenticated using(user_id=auth.uid());
create policy own_orders on store_orders for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid());
-- Listing content is served through entitlement-checked APIs, never public SQL reads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('maite-private','maite-private',false,2621440,array['image/jpeg']) on conflict(id) do nothing;
create index on generation_jobs(user_id,created_at desc);
create index on heart_ledger(user_id,created_at desc);
create index on documents(user_id,updated_at desc);
create index on ad_reward_claims(user_id,day);
grant all on profiles,wallets,heart_ledger,daily_claims,heart_passes,documents,generation_jobs,payment_purchases,ad_reward_claims,store_listings,store_orders,content_reports to service_role;
grant usage, select on sequence heart_ledger_id_seq to service_role;
