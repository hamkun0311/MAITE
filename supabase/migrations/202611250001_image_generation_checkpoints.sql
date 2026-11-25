begin;

create table public.image_generation_checkpoints (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (length(scope) between 1 and 64),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  attempt uuid not null,
  lease uuid,
  lease_until timestamptz,
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 3600000),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.image_generation_checkpoints enable row level security;
revoke all on public.image_generation_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.image_generation_checkpoints to service_role;

create function public.claim_image_checkpoint(p_user uuid, p_scope text, p_fingerprint text, p_attempt uuid, p_lease uuid)
returns jsonb language plpgsql set search_path = public as $$
declare saved jsonb;
begin
  delete from image_generation_checkpoints where user_id = p_user
    and updated_at < now() - interval '1 day' and (lease_until is null or lease_until < now());
  insert into image_generation_checkpoints (user_id, scope, fingerprint, attempt, lease, lease_until)
  values (p_user, p_scope, p_fingerprint, p_attempt, p_lease, now() + interval '6 minutes')
  on conflict (user_id, scope) do update set
    payload = case when image_generation_checkpoints.fingerprint = excluded.fingerprint
                     and image_generation_checkpoints.attempt = excluded.attempt
                   then image_generation_checkpoints.payload else '{}'::jsonb end,
    fingerprint = excluded.fingerprint, attempt = excluded.attempt,
    lease = excluded.lease, lease_until = excluded.lease_until, updated_at = now()
  where image_generation_checkpoints.lease_until is null or image_generation_checkpoints.lease_until < now()
  returning payload into saved;
  return saved;
end $$;

revoke execute on function public.claim_image_checkpoint(uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_image_checkpoint(uuid,text,text,uuid,uuid) to service_role;
commit;
