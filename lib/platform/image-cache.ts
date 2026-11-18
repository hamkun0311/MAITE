type Entry = { pending: Promise<Blob>; expires: number; bytes: number };
export class ImageBlobCache {
  private entries = new Map<string, Entry>();
  private bytes = 0; private epoch = 0;
  private limit: number; private ttl: number;
  constructor(limit = 64 * 1024 * 1024, ttl = 24 * 60 * 60 * 1000) { this.limit = limit; this.ttl = ttl; }
  clear() { this.epoch++; this.entries.clear(); this.bytes = 0; }
  get sizeBytes() { return this.bytes; }
  put(scope: string, id: string, blob: Blob) {
    if (!blob.size || blob.size > 5_000_000 || !blob.type.startsWith("image/")) return;
    const key = `${scope}\n${id}`;
    this.remove(key);
    this.entries.set(key, { pending: Promise.resolve(blob), expires: Date.now() + this.ttl, bytes: blob.size });
    this.bytes += blob.size;
    while (this.bytes > this.limit || this.entries.size > 100) this.remove(this.entries.keys().next().value!);
  }
  private remove(key: string) { const entry = this.entries.get(key); if (entry) this.bytes -= entry.bytes; this.entries.delete(key); }
  async get(scope: string, id: string, url: string, fetcher: typeof fetch = fetch, renew?: () => Promise<string | undefined>): Promise<Blob> {
    const key = `${scope}\n${id}`; const old = this.entries.get(key);
    if (old && old.expires > Date.now()) { this.entries.delete(key); this.entries.set(key, old); return old.pending; }
    this.remove(key); const epoch = this.epoch;
    const entry: Entry = { bytes: 0, expires: Infinity, pending: Promise.resolve().then(async () => {
      let response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
      if (renew && [400,401,403].includes(response.status)) {
        const refreshed = await renew();
        if (refreshed && refreshed !== url) response = await fetcher(refreshed, { signal: AbortSignal.timeout(30000) });
      }
      if (!response.ok) throw new Error("이미지를 불러오지 못했습니다.");
      const blob = await response.blob();
      if (!blob.size || blob.size > 5_000_000 || !blob.type.startsWith("image/")) throw new Error("이미지 형식을 확인해주세요.");
      return blob;
    }) };
    this.entries.set(key, entry);
    try {
      const blob = await entry.pending;
      if (epoch === this.epoch && this.entries.get(key) === entry) {
        entry.bytes = blob.size; entry.expires = Date.now() + this.ttl; this.bytes += blob.size;
        while (this.bytes > this.limit || this.entries.size > 100) this.remove(this.entries.keys().next().value!);
      }
      return blob;
    } catch (error) { if (this.entries.get(key) === entry) this.remove(key); throw error; }
  }
}
export const imageBlobs = new ImageBlobCache();
export function imageAssetKey(image: { jobId?: string; listingId?: string; id?: string }, variant: "original" | "thumbnail" = "original") {
  return `${image.jobId ? `job:${image.jobId}` : image.listingId ? `listing:${image.listingId}` : `image:${image.id || "original"}`}:${variant}`;
}
