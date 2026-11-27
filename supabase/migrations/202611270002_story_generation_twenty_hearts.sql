-- Apply the new price to new reservations. Existing job holds remain intact.
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
