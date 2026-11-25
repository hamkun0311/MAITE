import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountError } from "./account.ts";
import { signedImages, thumbnailPath } from "./image-assets.ts";
import { listingImagePaths } from "./listing-media.ts";
import { MAX_GALLERY_IMAGES } from "../characters/gallery.ts";
type Measure = <T>(name: string, run: () => PromiseLike<T>) => Promise<T>;
type PurchasedImage = Omit<Awaited<ReturnType<typeof listingImagePaths>>[number], "path">;

/** Resolve only this owner's completed jobs. A purchased original also requires entitlement. */
export async function documentMedia(db: SupabaseClient, userId: string, payload: Record<string, any>, measure: Measure): Promise<{original?: string; originalThumbnail?: string; gallery: Record<string, string>; thumbnails?: Record<string, string>; purchasedGallery?: PurchasedImage[]; excludedPurchasedIds?: string[]; expiresAt: number}> {
  const art = payload.art ?? {};
  const gallery = Array.isArray(payload.gallery) ? payload.gallery.slice(0, 24) : [];
  const jobIds = [...new Set([art.jobId, ...gallery.map(image => image?.jobId)].filter(id => z.uuid().safeParse(id).success))];
  const paths = new Map<string, string>();
  if (jobIds.length) {
    const result = await measure("images_db", () => db.from("generation_jobs").select("id,storage_path").eq("user_id", userId).eq("status", "completed").in("id", jobIds));
    if (result.error) throw new AccountError("이미지 정보를 불러오지 못했습니다.", 503);
    for (const row of result.data ?? []) if (row.storage_path) paths.set(row.id, row.storage_path);
  }
  let original = paths.get(art.jobId);
  const purchasedGallery: PurchasedImage[] = [];
  let excludedPurchasedIds: string[] | undefined;
  if (!original && z.uuid().safeParse(art.listingId).success) {
    const [listing, order] = await measure("entitlement_db", () => Promise.all([
      db.from("store_listings").select("id,kind,storage_path,seller_id,created_at,content").eq("id", art.listingId).eq("kind", "character").single(),
      db.from("store_orders").select("id").eq("listing_id", art.listingId).eq("buyer_id", userId).maybeSingle(),
    ]));
    if (!listing.error && listing.data && !order.error && (listing.data.seller_id === userId || order.data)) {
      original = listing.data.storage_path;
      const licensed = await measure("listing_media", () => listingImagePaths(db, listing.data));
      const licensedJobs = new Set(licensed.map(image => image.jobId));
      const keep = gallery.filter(image => {
        const id = image?.id;
        return typeof id !== "string" || !id.startsWith("purchased-") || paths.has(image.jobId) || licensedJobs.has(image.jobId);
      });
      const keptIds = new Set(keep.map(image => image?.id));
      excludedPurchasedIds = gallery.filter(image => !keptIds.has(image?.id)).map(image => image.id);
      const existing = new Set(keep.map(image => image?.jobId));
      const slots = Math.max(0, MAX_GALLERY_IMAGES - keep.length - (keep.some(image => image?.id === "original") ? 0 : 1));
      for (const { path, ...image } of licensed) {
        if (!existing.has(image.jobId)) {
          if (purchasedGallery.length >= slots) continue;
          purchasedGallery.push(image);
        }
        paths.set(image.jobId, path);
      }
    }
  }
  const allPaths = [...new Set([original, ...paths.values()].filter((path): path is string => !!path))];
  if (!allPaths.length) return { original: undefined, gallery: {}, excludedPurchasedIds, expiresAt: Date.now() + 240000 };
  const urls = await measure("storage_sign", () => signedImages.get(db, userId, allPaths.flatMap(path => [path, thumbnailPath(path)])));
  return {
    original: original ? urls.get(original) : undefined,
    originalThumbnail: original ? urls.get(thumbnailPath(original)) : undefined,
    gallery: Object.fromEntries([...paths].flatMap(([jobId, path]) => { const url = urls.get(path); return url ? [[jobId, url]] : []; })),
    thumbnails: Object.fromEntries([...paths].flatMap(([jobId, path]) => { const url = urls.get(thumbnailPath(path)); return url ? [[jobId, url]] : []; })),
    ...(purchasedGallery.length ? { purchasedGallery: purchasedGallery.filter(image => urls.get(paths.get(image.jobId)!)) } : {}),
    ...(excludedPurchasedIds?.length ? { excludedPurchasedIds } : {}),
    expiresAt: Date.now() + 240000,
  };
}
