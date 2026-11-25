import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_GALLERY_IMAGES } from "../characters/gallery.ts";
import { AccountError } from "./account.ts";

type Listing = {
  id: string;
  kind: string;
  seller_id: string;
  created_at?: string;
  content?: Record<string, unknown> | null;
};
const sourceSchema = z.object({
  id: z.uuid().optional(),
  gallery: z.array(z.unknown()).max(MAX_GALLERY_IMAGES).default([]),
});
const imageSchema = z.object({
  jobId: z.uuid(), title: z.string().max(120), kind: z.enum(["outfit", "illustration"]),
  scene: z.object({ novelId: z.uuid(), chapter: z.number().int().positive() }).optional(),
});
const chapterSchema = z.object({ chapter: z.number().int().positive(), novel: z.object({ id: z.uuid() }) });

export async function studioListingGallery(db: SupabaseClient, sellerId: string, id: string) {
  const result = await db.from("documents").select("gallery:payload->gallery")
    .eq("id", id).eq("user_id", sellerId).eq("kind", "studio").maybeSingle();
  if (result.error) throw new AccountError("판매 이미지 정보를 확인하지 못했습니다.", 503);
  const parsed = sourceSchema.shape.gallery.safeParse(result.data?.gallery ?? []);
  return parsed.success ? parsed.data : [];
}

export function listingGallery(listing: Listing, gallery: unknown[], detached = new Set<string>()) {
  const chapter = chapterSchema.safeParse(listing.content);
  const images = new Map<string, z.infer<typeof imageSchema>>();
  for (const item of gallery) {
    const parsed = imageSchema.safeParse(item);
    if (!parsed.success) continue;
    const image = parsed.data;
    if (listing.kind === "character") {
      images.set(image.jobId, { jobId: image.jobId, kind: image.kind, title: image.kind === "outfit" ? "대화 장면" : "이야기 삽화" });
    } else if (listing.kind === "chapter" && chapter.success && image.kind === "illustration"
      && (image.scene?.novelId === chapter.data.novel.id || (!image.scene && detached.has(image.jobId)))) {
      images.set(image.jobId, image);
    }
  }
  return [...images.values()];
}

export async function novelListingGallery(db: SupabaseClient, listing: Listing, gallery: unknown[]) {
  const chapter = chapterSchema.safeParse(listing.content);
  if (!chapter.success || !gallery.some(item => {
    const parsed = imageSchema.safeParse(item);
    return parsed.success && parsed.data.kind === "illustration" && !parsed.data.scene;
  })) return listingGallery(listing, gallery);
  const novelId = chapter.data.novel.id;
  const result = await db.from("story_rewind_backups").select("gallery:original_documents->0->payload->gallery")
    .eq("user_id", listing.seller_id).eq("novel_id", novelId);
  if (result.error) {
    console.warn("listing-rewind-gallery-unavailable", { code: result.error.code });
    return listingGallery(listing, gallery);
  }
  const detached = new Set<string>();
  for (const row of result.data ?? []) {
    const saved = sourceSchema.shape.gallery.safeParse(row.gallery);
    for (const item of saved.success ? saved.data : []) {
      const parsed = imageSchema.safeParse(item);
      if (parsed.success && parsed.data.scene?.novelId === novelId) detached.add(parsed.data.jobId);
    }
  }
  return listingGallery(listing, gallery, detached);
}

export async function listingImagePaths(db: SupabaseClient, listing: Listing) {
  const captured = sourceSchema.shape.gallery.safeParse(listing.content?.gallery ?? []);
  const capturedImages = captured.success ? captured.data : [];
  const versioned = listing.content?.galleryVersion === 2 && captured.success;
  const publishedAt = !versioned && listing.created_at ? new Date(listing.created_at) : undefined;
  if (!versioned && (!publishedAt || !Number.isFinite(publishedAt.getTime()))) return [];
  let gallery = listingGallery(listing, capturedImages, new Set(capturedImages.flatMap(item => {
    const parsed = imageSchema.safeParse(item);
    return versioned && parsed.success ? [parsed.data.jobId] : [];
  })));
  // Resolve older listings from their original artwork, including soft-deleted sources.
  if (!versioned) {
    const chapter = chapterSchema.safeParse(listing.content);
    const sourceId = z.uuid().safeParse(chapter.success ? chapter.data.novel.id : listing.content?.sourceDocumentId);
    const originalJob = z.uuid().safeParse(listing.content?.imageJobId);
    if (sourceId.success || (listing.kind === "character" && originalJob.success)) {
      let query = db.from("documents").select("id,source:payload->>id,gallery:payload->gallery").eq("user_id", listing.seller_id);
      query = sourceId.success ? query.eq("id", sourceId.data).in("kind", chapter.success ? ["chapter", "studio"] : ["character", "studio"])
        : query.eq("payload->art->>jobId", originalJob.data!).in("kind", ["character", "studio"]).limit(1);
      const result = await query.maybeSingle();
      if (result.error) throw new AccountError("판매 이미지 정보를 확인하지 못했습니다.", 503);
      const saved = sourceSchema.safeParse({ id: result.data?.source ?? undefined, gallery: result.data?.gallery ?? [] });
      const assets = [...capturedImages, ...(saved.success ? saved.data.gallery : [])];
      if (chapter.success && saved.success && saved.data.id && saved.data.id !== result.data?.id) {
        assets.push(...await studioListingGallery(db, listing.seller_id, saved.data.id));
      }
      gallery = await novelListingGallery(db, listing, assets);
    }
  }
  if (!gallery.length) return [];
  let query = db.from("generation_jobs").select("id,kind,storage_path")
    .eq("user_id", listing.seller_id).eq("status", "completed").in("id", gallery.map(image => image.jobId));
  if (publishedAt) {
    // Retain PostgreSQL timestamp precision when a job finishes just after publication.
    const cutoff = listing.created_at!;
    query = query.or(`completed_at.lte.${cutoff},and(completed_at.is.null,created_at.lte.${cutoff})`);
  }
  const result = await query;
  if (result.error) throw new AccountError("판매 이미지 정보를 확인하지 못했습니다.", 503);
  const jobs = new Map((result.data ?? []).map(job => [job.id, job]));
  return gallery.flatMap(image => {
    const job = jobs.get(image.jobId);
    if (!job?.storage_path || job.kind !== image.kind) return [];
    return [{ ...image, id: `purchased-${image.jobId}`, path: job.storage_path as string }];
  }).slice(0, MAX_GALLERY_IMAGES - 1);
}
