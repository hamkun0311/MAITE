begin;

create or replace function public.rewind_story(p_user uuid, p_studio uuid, p_novel uuid, p_from integer, p_job uuid)
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
  -- Detach discarded chapter links while retaining the media in the gallery.
  select coalesce(jsonb_agg(case when detach then img - 'scene' else img end order by pos),'[]'),
    coalesce(jsonb_agg(img->>'id') filter(where detach),'[]') into gallery,removed
    from (
      select img,pos,coalesce(img->>'kind'='illustration' and img#>>'{scene,novelId}'=p_novel::text
        and (img#>>'{scene,chapter}')::integer>=p_from,false) as detach
      from jsonb_array_elements(coalesce(original->'gallery','[]')) with ordinality as a(img,pos)
    ) a;
  backgrounds := coalesce(original->'backgrounds','{}');
  if removed ? (backgrounds->>'story') then backgrounds := backgrounds - 'story'; end if;
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

-- Restore illustrations removed by earlier rewinds, where the completed image job
-- is still available. Keep current gallery entries and enforce the existing cap.
with backup_images as (
  select distinct on (b.user_id,b.studio_id,img->>'jobId')
    b.user_id,b.studio_id,b.novel_id,
    (img - 'scene') || jsonb_build_object('id','rewound-' || (img->>'jobId')) as image,b.created_at
  from story_rewind_backups b
  cross join lateral jsonb_array_elements(b.original_documents) doc
  cross join lateral jsonb_array_elements(coalesce(doc#>'{payload,gallery}','[]')) img
  join generation_jobs j on j.id::text=img->>'jobId' and j.user_id=b.user_id
    and j.kind='illustration' and j.status='completed' and j.storage_path is not null
  where doc->>'id'=b.studio_id::text
    and img->>'kind'='illustration' and img#>>'{scene,novelId}'=b.novel_id::text
    and length(img->>'id') between 1 and 100
  order by b.user_id,b.studio_id,img->>'jobId',b.created_at desc
), live_documents as (
  select d.id, d.payload, coalesce(d.payload->'gallery','[]') as gallery,
    coalesce(d.payload->>'id',d.id::text) as studio_id, d.user_id
  from documents d
  where d.deleted_at is null and d.kind in ('studio','chapter')
    and exists(select 1 from backup_images b where b.user_id=d.user_id and d.id in (b.studio_id,b.novel_id)
      and b.studio_id::text=coalesce(d.payload->>'id',d.id::text))
), recovered as (
  select d.id,d.payload,d.gallery, additions.images
  from live_documents d
  cross join lateral (
    select jsonb_agg(chosen.image order by chosen.created_at,chosen.image->>'jobId') as images
    from (
      select b.image,b.created_at from backup_images b
      where b.user_id=d.user_id and b.studio_id::text=d.studio_id and d.id in (b.studio_id,b.novel_id)
        and not exists(select 1 from jsonb_array_elements(d.gallery) current_image
          where current_image->>'jobId'=b.image->>'jobId')
      order by b.created_at desc,b.image->>'jobId'
      limit greatest(24-jsonb_array_length(d.gallery)-case when d.gallery @> '[{"id":"original"}]'::jsonb then 0 else 1 end,0)
    ) chosen
  ) additions
  where additions.images is not null
)
update documents d
set payload=jsonb_set(d.payload,'{gallery}',r.gallery || r.images),updated_at=now()
from recovered r
where d.id=r.id and d.deleted_at is null and d.payload=r.payload;

commit;
