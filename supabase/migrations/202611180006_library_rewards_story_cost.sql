-- Explicit daily claims, catch-up pass rewards and 20-heart novel generation.
begin;

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
 cost:=case p_kind when 'character' then 50 when 'chat' then 2 when 'story' then 20 when 'illustration' then 50 when 'outfit' then 30 else null end;
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

create table if not exists public.pass_reward_periods (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles on delete cascade,
 starts_on date not null, ends_on date not null,
 daily_hearts integer not null check(daily_hearts between 1 and 100),
 unique(user_id,starts_on),check(ends_on=starts_on+30)
);
insert into public.pass_reward_periods(user_id,starts_on,ends_on,daily_hearts)
 select user_id,starts_on,ends_on,daily_hearts from public.heart_passes on conflict(user_id,starts_on) do nothing;
alter table public.pass_reward_periods enable row level security;
revoke all on public.pass_reward_periods from anon,authenticated;
grant all on public.pass_reward_periods to service_role;

create or replace function public.keep_pass_reward_period() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into pass_reward_periods(user_id,starts_on,ends_on,daily_hearts)
 values(new.user_id,new.starts_on,new.ends_on,new.daily_hearts) on conflict(user_id,starts_on) do nothing;
 return new;
end $$;
drop trigger if exists save_pass_reward_period on public.heart_passes;
create trigger save_pass_reward_period after insert or update on public.heart_passes for each row execute function public.keep_pass_reward_period();

create or replace function public.claim_reward(p_user uuid,p_kind text,p_day date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare today date:=(now() at time zone 'Asia/Seoul')::date; amount integer;
begin
 perform 1 from wallets where user_id=p_user for update;
 if not found then raise exception 'invalid_account'; end if;
 if p_day is null or p_day>today then raise exception 'invalid_reward_day'; end if;
 if p_kind='attendance' then
  if p_day<>today then raise exception 'attendance_expired'; end if;
  amount:=case when extract(dow from p_day)=0 then 15 else 5 end;
 elsif p_kind='pass' then
  select daily_hearts into amount from pass_reward_periods where user_id=p_user and p_day>=starts_on and p_day<ends_on order by starts_on desc limit 1;
  if amount is null then raise exception 'no_pass_reward'; end if;
 else raise exception 'invalid_reward_kind'; end if;
 insert into daily_claims(user_id,day,kind,amount) values(p_user,p_day,p_kind,amount) on conflict do nothing;
 if not found then return jsonb_build_object('claimed',0,'day',p_day,'kind',p_kind); end if;
 if p_kind='pass' then
  update wallets set transferable=transferable+amount where user_id=p_user;
  insert into heart_ledger(user_id,reference,transferable,reason) values(p_user,'pass:'||p_day,amount,'pass');
 else
  update wallets set bonus=bonus+amount where user_id=p_user;
  insert into heart_ledger(user_id,reference,bonus,reason) values(p_user,'attendance:'||p_day,amount,'attendance');
 end if;
 return jsonb_build_object('claimed',amount,'day',p_day,'kind',p_kind);
end $$;

-- Old clients may still call this on launch: never silently claim new rewards.
create or replace function public.claim_daily(p_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from wallets where user_id=p_user) then raise exception 'invalid_account'; end if;
 return jsonb_build_object('claimed',0,'day',(now() at time zone 'Asia/Seoul')::date,'manual',true);
end $$;

create or replace function public.reward_calendar(p_user uuid,p_month date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare first_day date:=date_trunc('month',p_month)::date; last_day date:=(date_trunc('month',p_month)+interval '1 month')::date;
begin
 if not exists(select 1 from wallets where user_id=p_user) then raise exception 'invalid_account'; end if;
 if p_month is null then raise exception 'invalid_reward_day'; end if;
 return jsonb_build_object('today',(now() at time zone 'Asia/Seoul')::date,'month',first_day,
  'claims',coalesce((select jsonb_agg(jsonb_build_object('day',day,'kind',kind,'amount',amount)) from daily_claims where user_id=p_user and day>=first_day and day<last_day),'[]'::jsonb),
  'passes',coalesce((select jsonb_agg(jsonb_build_object('starts_on',starts_on,'ends_on',ends_on,'daily_hearts',daily_hearts)) from pass_reward_periods where user_id=p_user and starts_on<last_day and ends_on>first_day),'[]'::jsonb));
end $$;

revoke execute on function public.keep_pass_reward_period(),public.claim_reward(uuid,text,date),public.reward_calendar(uuid,date) from public,anon,authenticated;
grant execute on function public.claim_reward(uuid,text,date),public.reward_calendar(uuid,date) to service_role;
revoke execute on function public.claim_daily(uuid),public.reserve_generation_v2(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_daily(uuid),public.reserve_generation_v2(uuid,uuid,text,text) to service_role;
commit;

