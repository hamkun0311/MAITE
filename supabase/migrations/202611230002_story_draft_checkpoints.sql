create table public.story_draft_checkpoints (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  lease uuid,
  lease_until timestamptz,
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);

alter table public.story_draft_checkpoints enable row level security;
revoke all on public.story_draft_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.story_draft_checkpoints to service_role;
create index story_generation_fingerprint on public.generation_jobs (user_id, fingerprint)
  where kind = 'story' and status = 'completed';

create function public.claim_story_draft(p_user uuid, p_fingerprint text, p_lease uuid)
returns jsonb language plpgsql set search_path = public as $$
declare saved jsonb;
begin
  delete from story_draft_checkpoints where user_id = p_user
    and updated_at < now() - interval '30 days' and (lease_until is null or lease_until < now());
  insert into story_draft_checkpoints (user_id, fingerprint, lease, lease_until)
  values (p_user, p_fingerprint, p_lease, now() + interval '5 minutes')
  on conflict (user_id, fingerprint) do update set
    lease = excluded.lease, lease_until = excluded.lease_until, updated_at = now()
  where story_draft_checkpoints.lease_until is null or story_draft_checkpoints.lease_until < now()
  returning payload into saved;
  return saved;
end $$;

revoke execute on function public.claim_story_draft(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_story_draft(uuid, text, uuid) to service_role;
