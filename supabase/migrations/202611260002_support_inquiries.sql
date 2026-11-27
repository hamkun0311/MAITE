create table public.support_inquiries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null check (char_length(author_name) between 1 and 80),
 title text not null check (char_length(btrim(title)) between 1 and 100),
 body text not null check (char_length(btrim(body)) between 1 and 3000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.support_replies (
 id uuid primary key default gen_random_uuid(),
 inquiry_id uuid not null references public.support_inquiries(id) on delete cascade,
 body text not null check (char_length(btrim(body)) between 1 and 3000),
 created_at timestamptz not null default now()
);

create index support_inquiries_owner on public.support_inquiries (user_id, created_at desc, id desc);
create index support_inquiries_latest on public.support_inquiries (created_at desc, id desc);
create index support_replies_inquiry on public.support_replies (inquiry_id, created_at);
alter table public.support_inquiries enable row level security;
alter table public.support_replies enable row level security;
revoke all on public.support_inquiries, public.support_replies from public, anon, authenticated;
grant select, insert, update, delete on public.support_inquiries to service_role;
grant select, insert on public.support_replies to service_role;
