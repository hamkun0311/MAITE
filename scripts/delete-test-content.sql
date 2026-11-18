-- Manual test-content cleanup. Run in Supabase Dashboard > SQL Editor.
-- Close the app first so an open editor cannot auto-save old content.
-- Applies to ALL accounts. Account, wallet, payment and reward data remain.
-- Storage files are separate: remove content images through Storage UI/API.
-- Keep profile photos (user-id/profile/...) when cleaning Storage.
-- This file is intentionally NOT a migration and is never applied automatically.
begin;

delete from public.content_reports
where listing_id is not null or job_id is not null;
delete from public.store_orders;
delete from public.store_listings;
delete from public.character_checkins;
delete from public.character_activity;
delete from public.documents;
delete from public.generation_jobs;

select 'documents' as table_name, count(*) as remaining from public.documents
union all select 'generation_jobs', count(*) from public.generation_jobs
union all select 'store_listings', count(*) from public.store_listings
union all select 'store_orders', count(*) from public.store_orders
union all select 'character_checkins', count(*) from public.character_checkins
union all select 'character_activity', count(*) from public.character_activity;

commit;
