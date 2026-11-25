create or replace function public.initialize_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, display_name)
    values(new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 80));
  insert into wallets(user_id, bonus) values(new.id, 100);
  insert into heart_ledger(user_id, reference, bonus, free_chats, reason)
    values(new.id, 'signup', 100, 5, 'signup');
  return new;
end $$;
