/** One in-flight read per active account; invalidation during a read gets one fresh result. */
export class NotificationSyncStore<T> {
  private owner?: string;
  private revision = 0;
  private value?: T;
  private expires = 0;
  private pending?: Promise<T | undefined>;
  private listeners = new Set<() => void>();
  activate(owner?: string) {
    if (owner === this.owner) return;
    this.owner = owner; this.revision++; this.value = undefined; this.expires = 0; this.pending = undefined;
    this.listeners.forEach(listener => listener());
  }
  snapshot(owner: string) { return owner === this.owner ? this.value : undefined; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  invalidate(owner: string) { if (owner === this.owner) { this.revision++; this.expires = 0; } }
  read(owner: string, load: () => Promise<T>): Promise<T | undefined> {
    if (owner !== this.owner) return Promise.resolve(undefined);
    if (this.pending) return this.pending;
    if (this.value && this.expires > Date.now()) return Promise.resolve(this.value);
    const revision = this.revision;
    const work = Promise.resolve().then(load).then(value => {
      if (owner !== this.owner) return undefined;
      if (revision !== this.revision) {
        if (this.pending === work) this.pending = undefined;
        return this.read(owner, load);
      }
      this.value = value; this.expires = Date.now() + 10000;
      this.listeners.forEach(listener => listener());
      return value;
    }).finally(() => { if (this.pending === work) this.pending = undefined; });
    this.pending = work;
    return work;
  }
}
