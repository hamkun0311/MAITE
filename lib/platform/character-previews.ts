"use client";
import { jsonApi } from "./commerce";

const owners = new Map<string, { images: Record<string, string>; expires: number; pending?: Promise<Record<string, string>> }>();
let revision = 0;
export function cachedCharacterPreviews(owner: string) { return owners.get(owner)?.images ?? {}; }
export function clearCharacterPreviews() { revision++; owners.clear(); }
export function invalidateCharacterPreviews(owner: string, jobId?: string) {
  const entry = owners.get(owner);
  if (entry && (!jobId || !entry.images[jobId])) entry.expires = 0;
}
export async function characterPreviews(owner: string) {
  let entry = owners.get(owner);
  if (entry?.pending) return entry.pending;
  if (entry && entry.expires > Date.now()) return entry.images;
  if (!entry) { entry = { images: {}, expires: 0 }; owners.set(owner, entry); }
  const current = entry, epoch = revision;
  const work = jsonApi("/api/account?previews=1").then(data => {
    const images = data.images ?? {};
    if (epoch === revision) { current.images = images; current.expires = Date.now() + 240000; }
    return images as Record<string, string>;
  });
  current.pending = work;
  try { return await work; } finally { if (current.pending === work) current.pending = undefined; }
}
