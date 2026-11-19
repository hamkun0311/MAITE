"use client";
import { imageBlobs } from "./image-cache";
import { jsonApi } from "./commerce";
import { persistentImages } from "./persistent-images";

export function loadAccountImage(scope: string, key: string, url: string) {
  const revision = persistentImages.revision;
  const memory = imageBlobs.peek(scope, key);
  if (memory) return Promise.resolve(memory);
  // Cache-only misses must not join (and fail) a concurrent real download.
  if (!url) {
    return persistentImages.get(scope, key).then(blob => {
      if (!blob || persistentImages.revision !== revision) throw new Error("이미지 캐시가 없습니다.");
      imageBlobs.put(scope, key, blob); return blob;
    });
  }
  return imageBlobs.get(scope, key, url, async (input, init) => {
    const cached = await persistentImages.get(scope, key);
    return cached ? new Response(cached) : fetch(input, init);
  }, async () => {
    if (key.startsWith("profile:")) return (await jsonApi("/api/account")).avatarUrl;
    const preview = key.match(/^listing-preview:([a-f0-9-]{36}):thumbnail$/i);
    if (preview) return (await jsonApi("/api/store")).listings.find((row:{id:string})=>row.id===preview[1])?.thumbnailUrl;
    const asset = key.match(/^(job|listing):([a-f0-9-]{36}):(original|thumbnail)$/i);
    if (!asset) return;
    // Re-check entitlement instead of extending or bypassing a signed URL after expiry.
    const fresh = await jsonApi(asset[1] === "job" ? `/api/account?job=${asset[2]}` : `/api/store?id=${asset[2]}`);
    return asset[3] === "thumbnail" ? fresh.thumbnailUrl || fresh.imageUrl : fresh.imageUrl;
  }).then(blob => { if (persistentImages.revision === revision) void persistentImages.put(scope, key, blob); return blob; });
}
export function seedAccountImage(scope: string, key: string, blob: Blob) {
  imageBlobs.put(scope, key, blob); void persistentImages.put(scope, key, blob);
}
