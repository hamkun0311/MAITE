create table public.story_rewind_backups (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id uuid not null,
  novel_id uuid not null,
  original_documents jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.story_rewind_backups enable row level security;

-- Reject an older browser tab trying to save the discarded branch.
create function public.guard_story_rewind() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.payload->>'rewindToken' is distinct from new.payload->>'rewindToken'
    and old.payload ? 'rewindToken'
    and current_setting('maite.story_rewind', true) is distinct from 'on' then
    raise exception 'stale_story_snapshot';
  end if;
  return new;
end $$;
create trigger guard_story_rewind before update of payload on public.documents
for each row execute function public.guard_story_rewind();

create function public.rewind_story(p_user uuid, p_studio uuid, p_novel uuid, p_from integer, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  studio documents;
  novel documents;
  original jsonb;
  messages jsonb;
  pages text[];
  chapters integer;
  kept jsonb;
  compact jsonb;
  checkpoint uuid;
  saved_state jsonb;
  saved_timeline jsonb;
  last_timeline jsonb;
  previous_revision integer;
  chapter_number integer;
  expected_revision integer;
  has_chat boolean;
  gallery jsonb;
  removed jsonb;
  backgrounds jsonb;
  restored jsonb;
  token uuid := gen_random_uuid();
begin
  if p_studio = p_novel or p_from < 1 then raise exception 'invalid_rewind'; end if;
  perform 1 from documents where id in (p_studio,p_novel) and user_id=p_user order by id for update;
  select * into studio from documents where id=p_studio and user_id=p_user and deleted_at is null and kind='studio';
  select * into novel from documents where id=p_novel and user_id=p_user and deleted_at is null and kind='chapter';
  original := studio.payload;
  if original is null or novel.payload is null or novel.payload->>'id' is distinct from p_studio::text
    or original#>>'{story,documentId}' is distinct from p_novel::text
    or original#>>'{story,lastJobId}' is distinct from p_job::text
    or novel.payload#>>'{story,lastJobId}' is distinct from p_job::text then
    raise exception 'stale_story_snapshot';
  end if;
  chapters := (original#>>'{story,storyState,chapter}')::integer;
  messages := coalesce(original#>'{story,archive}', original#>'{story,committed}');
  select array_agg(m->>'content' order by pos) into pages
  from jsonb_array_elements(messages) with ordinality as a(m,pos) where m->>'role'='assistant';
  if chapters is null or cardinality(pages) is distinct from chapters or p_from > chapters then raise exception 'invalid_rewind'; end if;
  if exists(select 1 from generation_jobs where user_id=p_user and kind in ('story','chat','illustration') and status='reserved'
    and created_at >= now()-interval '15 minutes')
    then raise exception 'rewind_in_progress'; end if;
  if exists(select 1 from store_listings where seller_id=p_user and content#>>'{novel,id}'=p_novel::text
    and (content->>'chapter')::integer >= p_from) then raise exception 'rewind_published'; end if;

  has_chat := jsonb_array_length(coalesce(original#>'{chat,archive}', original#>'{chat,committed}', '[]')) > 0;
  if p_from = 1 then
    saved_timeline := '{"revision":0,"scene":[],"participants":[],"relationships":[],"promises":[]}';
    previous_revision := 0;
  end if;
  -- Match every chapter to its accepted text. Each event must follow the prior
  -- event's revision when there is chat history, so chat continuity is preserved.
  for chapter_number in greatest(1,p_from-1)..chapters loop
    select j.id, c.e->'state', t.e->'state', (t.e->>'expectedRevision')::integer
      into checkpoint, saved_state, last_timeline, expected_revision
    from generation_jobs j
    cross join lateral jsonb_array_elements(j.result->'events') c(e)
    cross join lateral jsonb_array_elements(j.result->'events') t(e)
    where j.user_id=p_user and j.kind='story' and j.status='completed'
      and (chapter_number <> chapters or j.id=p_job)
      and c.e->>'type'='chapter' and (c.e#>>'{state,chapter}')::integer=chapter_number
      and c.e->>'text'=pages[chapter_number] and c.e#>>'{state,previousProse}'=pages[chapter_number]
      and t.e->>'type'='timeline' and t.e->'state' is not null
    order by j.created_at desc limit 1;
    if not found then raise exception 'rewind_checkpoint_missing'; end if;
    if chapter_number < p_from then
      saved_timeline := last_timeline;
      restored := jsonb_build_object('storyState',saved_state,'lastJobId',checkpoint);
    elsif has_chat and expected_revision is distinct from previous_revision then
      raise exception 'rewind_chat_changed';
    end if;
    previous_revision := (last_timeline->>'revision')::integer;
  end loop;
  if (last_timeline - 'revision') is distinct from ((original->'timeline') - 'revision')
    or (has_chat and last_timeline is distinct from original->'timeline')
    then raise exception 'rewind_chat_changed'; end if;
  if p_from > 1 then
    select jsonb_agg(m order by pos) into kept from (
      select m,pos,count(*) filter(where m->>'role'='assistant') over(order by pos rows between unbounded preceding and 1 preceding) as earlier
      from jsonb_array_elements(messages) with ordinality as a(m,pos)
    ) a where earlier < p_from-1;
  end if;
  kept := coalesce(kept,'[]');
  select coalesce(jsonb_agg(m order by pos),'[]') into compact
    from jsonb_array_elements(kept) with ordinality as a(m,pos) where pos > jsonb_array_length(kept)-4;
  select coalesce(jsonb_agg(img order by pos) filter(where not drop_image),'[]'),
    coalesce(jsonb_agg(img->>'id') filter(where drop_image),'[]') into gallery,removed
    from (
      select img,pos,coalesce(img->>'kind'='illustration' and img#>>'{scene,novelId}'=p_novel::text
        and (img#>>'{scene,chapter}')::integer>=p_from,false) as drop_image
      from jsonb_array_elements(coalesce(original->'gallery','[]')) with ordinality as a(img,pos)
    ) a;
  backgrounds := coalesce(original->'backgrounds','{}');
  if removed ? (backgrounds->>'story') then backgrounds := backgrounds - 'story'; end if;
  if removed ? (backgrounds->>'chat') then backgrounds := backgrounds - 'chat'; end if;
  restored := original || jsonb_build_object(
    'rewindToken',token, 'gallery',gallery, 'backgrounds',backgrounds, 'timeline',saved_timeline,
    'story',((original->'story') - array['lastJobId','storyState']) || coalesce(restored,'{}') ||
      jsonb_build_object('archive',kept,'committed',compact,'input','','storyPage',greatest(0,p_from-2))
  );
  insert into story_rewind_backups(id,user_id,studio_id,novel_id,original_documents)
    values(token,p_user,p_studio,p_novel,jsonb_build_array(to_jsonb(studio),to_jsonb(novel)));
  perform set_config('maite.story_rewind','on',true);
  update documents set payload=restored,updated_at=now() where user_id=p_user and id in(p_studio,p_novel);
  return restored;
end $$;

revoke execute on function public.rewind_story(uuid,uuid,uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.rewind_story(uuid,uuid,uuid,integer,uuid) to service_role;
