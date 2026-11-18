import { test } from "node:test";
import assert from "node:assert/strict";
import { PersistentImages } from "../lib/platform/persistent-images.ts";

test("device image cache survives a new instance, isolates accounts, expires and clears pending writes", async () => {
 const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
 const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
 const originalNow = Date.now; let now = originalNow();
 const entries = new Map<string, Response>();
 const cache = {
   match: async (key: Request) => entries.get(key.url)?.clone(),
   put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()); },
   delete: async (key: Request) => entries.delete(key.url),
   keys: async () => [...entries.keys()].map(url => new Request(url)),
 };
 try {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://app.test" } });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { open: async () => cache, delete: async () => { entries.clear(); return true; } } });
  Date.now = () => now;
  const blob = new Blob(["private image"], { type: "image/webp" });
  const first = new PersistentImages(); await first.put("account-a", "asset", blob);
  const afterReload = new PersistentImages();
  assert.equal(await (await afterReload.get("account-a", "asset"))?.text(), "private image");
  assert.equal(await afterReload.get("account-b", "asset"), undefined);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(await afterReload.get("account-a", "asset"), undefined);
  const pending = afterReload.put("account-a", "asset", blob);
  await afterReload.clear(); await pending;
  assert.equal(entries.size, 0);
  assert.equal(await afterReload.get("account-a", "asset"), undefined);
 } finally {
  Date.now = originalNow;
  if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches); else Reflect.deleteProperty(globalThis, "caches");
  if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation); else Reflect.deleteProperty(globalThis, "location");
 }
});
