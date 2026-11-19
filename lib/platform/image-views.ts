type ImageView = { url: string; blob: Blob; decoded: boolean; users: number; expires: number };

/** Keep recently displayed object URLs across navigation. Active consumers are never evicted. */
export class ImageViewCache {
  private entries = new Map<string, ImageView>();
  private epoch = 0;
  private limit: number; private count: number; private ttl: number;
  get revision() { return this.epoch; }
  constructor(limit = 16 * 1024 * 1024, count = 60, ttl = 24 * 60 * 60 * 1000) { this.limit = limit; this.count = count; this.ttl = ttl; }
  peek(scope: string, key: string) {
    const entry = this.entries.get(`${scope}\n${key}`);
    return entry && (entry.users > 0 || entry.expires > Date.now()) ? entry : undefined;
  }
  acquire(scope: string, key: string, blob: Blob) {
    const id = `${scope}\n${key}`;
    let entry = this.peek(scope, key);
    if (!entry) {
      const previous = this.entries.get(id);
      if (previous) URL.revokeObjectURL(previous.url);
      entry = { url: URL.createObjectURL(blob), blob, decoded: false, users: 0, expires: Date.now() + this.ttl };
    }
    this.entries.delete(id); this.entries.set(id, entry); entry.users++;
    this.prune();
    let released = false;
    return { entry, release: () => { if (released) return; released = true; entry.users--; this.prune(); } };
  }
  private prune() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.blob.size, 0);
    for (const [key, entry] of this.entries) {
      if (entry.users || (bytes <= this.limit && this.entries.size <= this.count && entry.expires > Date.now())) continue;
      URL.revokeObjectURL(entry.url); this.entries.delete(key); bytes -= entry.blob.size;
    }
  }
  clear() {
    this.epoch++;
    for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
    this.entries.clear();
  }
}
export const imageViews = new ImageViewCache();
