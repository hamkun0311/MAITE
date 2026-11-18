-- Allow derived WebP thumbnails in the existing private bucket; preserve privacy and size limits.
update storage.buckets
set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['image/webp']))
where id = 'maite-private' and allowed_mime_types is not null
  and not ('image/webp' = any(allowed_mime_types));
