/** Browser-local reads only. Scope includes the current access token; mutations invalidate all reads. */
export class ReadCache {
  private epoch = 0;
  private entries = new Map<string, { expires: number; promise: Promise<unknown> }>();
  clear() { this.epoch++; this.entries.clear(); }
  async get<T>(scope: string, path: string, load: () => Promise<T>, ttl = 0): Promise<T> {
    const key = `${scope}\n${path}`;
    const current = this.entries.get(key);
    if (current && current.expires > Date.now()) return structuredClone(await current.promise) as T;
    const epoch = this.epoch;
    const entry = { expires: Infinity, promise: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    try {
      const value = await entry.promise;
      if (epoch === this.epoch && this.entries.get(key) === entry) {
        if (ttl) entry.expires = Date.now() + ttl;
        else this.entries.delete(key);
        while (this.entries.size > 80) this.entries.delete(this.entries.keys().next().value!);
      }
      return structuredClone(value);
    } catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; }
  }
}
