"use client";
// Only called after sign-in. Private images are scoped by account and removed on logout.
const CACHE_NAME = "maite-private-images-v1";
const TTL = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 64 * 1024 * 1024;
export class PersistentImages {
  private epoch = 0;
  get revision() { return this.epoch; }
  private queue: Promise<unknown> = Promise.resolve();
  private run<T>(work: () => Promise<T>): Promise<T | undefined> {
    const next = this.queue.then(work).catch(() => undefined);
    this.queue = next; return next;
  }
  private key(scope: string, id: string) { return new Request(`${location.origin}/__maite_images/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`); }
  get(scope: string, id: string) {
    const epoch = this.epoch;
    return this.run(async () => {
      if (typeof caches === "undefined" || epoch !== this.epoch) return;
      const cache = await caches.open(CACHE_NAME), key = this.key(scope, id);
      const response = await cache.match(key);
      if (!response) return;
      if (Number(response.headers.get("X-Maite-Expires")) <= Date.now()) { await cache.delete(key); return; }
      const blob = await response.blob();
      return epoch === this.epoch ? blob : undefined;
    });
  }
  put(scope: string, id: string, blob: Blob) {
    const epoch = this.epoch;
    if (!blob.size || blob.size > 5_000_000 || !blob.type.startsWith("image/")) return Promise.resolve();
    return this.run(async () => {
      if (typeof caches === "undefined" || epoch !== this.epoch) return;
      const cache = await caches.open(CACHE_NAME), key = this.key(scope, id);
      const existing = await cache.match(key);
      if (existing && Number(existing.headers.get("X-Maite-Expires")) > Date.now()) return;
      await cache.delete(key);
      await cache.put(key, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size), "X-Maite-Expires": String(Date.now() + TTL) } }));
      const keys = await cache.keys(); let bytes = 0, count = 0;
      // Keep the newest entries within a hard storage budget.
      for (const entry of [...keys].reverse()) {
        const response = await cache.match(entry); if (!response) continue;
        const size = Number(response.headers.get("Content-Length")) || 0;
        if (Number(response.headers.get("X-Maite-Expires")) <= Date.now() || bytes + size > LIMIT || count >= 100) await cache.delete(entry);
        else { bytes += size; count++; }
      }
    });
  }
  clear() {
    this.epoch++;
    return this.run(async () => { if (typeof caches !== "undefined") await caches.delete(CACHE_NAME); });
  }
}
export const persistentImages = new PersistentImages();
