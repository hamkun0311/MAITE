"use client";

type ImageAttempt = { id: string; fingerprint?: string; token?: string; updatedAt: number };
const active = new Map<string, ImageAttempt>();
const attemptKey = (owner: string, kind: string, scope: string) => `maite-image-attempt:${owner}:${kind}:${scope}`;
function storedAttempt(key: string) {
  let value = active.get(key);
  try { value = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? value; } catch { /* Keep the in-memory entry. */ }
  if (!value?.id) return;
  if (Date.now() - value.updatedAt < 3600000) return value;
  active.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}
function saveAttempt(key: string, value: ImageAttempt) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    active.delete(key);
  } catch { active.set(key, value); }
}
async function digestForm(form: FormData) {
  const parts: BlobPart[] = [];
  for (const [name, value] of [...form.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    parts.push(typeof value === "string" ? JSON.stringify([name, value]) : JSON.stringify([name, value.type, value.size]));
    if (typeof value !== "string") parts.push(value);
  }
  const digest = await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function hasImageAttempt(owner: string, kind: string, scope = "default") {
  return Boolean(storedAttempt(attemptKey(owner, kind, scope)));
}
export function forgetImageAttempt(owner: string, kind: string, scope = "default") {
  const key = attemptKey(owner, kind, scope);
  active.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}

export async function beginImageAttempt(owner: string, kind: string, form: FormData, scope = "default") {
  const key = attemptKey(owner, kind, scope);
  const fingerprint = await digestForm(form);
  const prior = storedAttempt(key);
  const entry = prior?.fingerprint === fingerprint ? prior : { id: crypto.randomUUID(), fingerprint, updatedAt: Date.now() };
  saveAttempt(key, entry);
  return {
    headers: { "X-Image-Attempt": entry.id, "X-Image-Scope": scope, ...(entry.token ? { "X-Image-Retry": entry.token } : {}) },
    remember(response: Response) {
      const token = response.headers.get("X-Image-Retry");
      const current = storedAttempt(key);
      if (token && current?.id === entry.id) saveAttempt(key, { ...current, token, updatedAt: Date.now() });
    },
    complete() {
      if (storedAttempt(key)?.id !== entry.id) return;
      forgetImageAttempt(owner, kind, scope);
    },
  };
}
