import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountError } from "./account.ts";
export const thumbnailPath = (path: string) => path.replace(/\.jpg$/i, "") + ".thumb.webp";
export const thumbnailBytes = (bytes: Buffer) => sharp(bytes, { limitInputPixels: 16_777_216 }).resize({ width: 256, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();

export async function uploadThumbnail(db: SupabaseClient, path: string, original: Buffer) {
  const bytes = await thumbnailBytes(original);
  const result = await db.storage.from("maite-private").upload(thumbnailPath(path), bytes, { contentType: "image/webp", cacheControl: "3600", upsert: false });
  if (result.error && !["409", "Duplicate"].includes(String((result.error as {statusCode?: string}).statusCode))) throw result.error;
}

/** Authorize paths before calling this cache. Entries are private to the checked user. */
export class SignedImageCache {
  private entries = new Map<string, { url?: string; expires: number }>();
  private pending = new Map<string, Promise<void>>();
  async get(db: SupabaseClient, userId: string, paths: string[]) {
    const unique = [...new Set(paths)]; const prefix = `${userId}:`;
    const missing = unique.filter(path => (this.entries.get(prefix + path)?.expires || 0) <= Date.now());
    if (missing.length) {
      const key = prefix + [...missing].sort().join("\n");
      let work = this.pending.get(key);
      if (!work) {
        work = (async () => {
          const signed = await db.storage.from("maite-private").createSignedUrls(missing, 300);
          if (signed.error) throw new AccountError("이미지 주소를 불러오지 못했습니다.", 503);
          missing.forEach((path, index) => {
            const url = signed.data?.[index]?.signedUrl;
            this.entries.set(prefix + path, { url: url || undefined, expires: Date.now() + (url ? 240000 : 15000) });
          });
          while (this.entries.size > 2000) this.entries.delete(this.entries.keys().next().value!);
        })();
        this.pending.set(key, work);
      }
      try { await work; } finally { if (this.pending.get(key) === work) this.pending.delete(key); }
    }
    return new Map(unique.map(path => [path, this.entries.get(prefix + path)?.url]));
  }
}
export const signedImages = new SignedImageCache();
