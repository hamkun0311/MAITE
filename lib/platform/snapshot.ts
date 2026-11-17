"use client";
import { z } from "zod";
import { characterProfileSchema } from "../chat/character.ts";
import { characterStyleProfile } from "../characters/schema.ts";
import { createStudioSessions, type ChatSession } from "../chat/session.ts";
import { chatMemorySchema } from "../chat/memory.ts";
import { timelineSchema } from "../chat/timeline.ts";
import { storyStateSchema } from "../novel/state.ts";
import { speechStyleSchema } from "../chat/speech.ts";
const message = z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) });
const session = z.object({ committed: z.array(message).max(1000), archive: z.array(message).max(1000).optional(), input: z.string().max(2000).default(""), started: z.boolean(), storyState: storyStateSchema.optional(), speechStyle: speechStyleSchema.optional(), chatMemory: chatMemorySchema.optional(), latestVisualChange: z.boolean().optional(), visualDetected: z.boolean().optional() });
export const snapshotSchema = z.object({
  version: z.literal(1), id: z.uuid(),
  art: z.object({ title: z.string().max(120), summary: z.string().max(2000), prompt: z.string().max(12000), style: characterStyleProfile, description: z.string().max(6000), profile: characterProfileSchema, width: z.number(), height: z.number(), jobId: z.uuid().optional(), listingId: z.uuid().optional() }),
  chat: session, story: session, timeline: timelineSchema,
  gallery: z.array(z.object({ id: z.string().max(100), title: z.string().max(120), kind: z.enum(["character", "illustration", "outfit"]), jobId: z.uuid().optional(), composition: z.object({ pose: z.string().max(240), framing: z.string().max(160) }).optional() })).max(24).default([]),
  backgrounds: z.object({ chat: z.string().max(100).optional(), story: z.string().max(100).optional() }).default({}),
});
export type StudioSnapshot = z.infer<typeof snapshotSchema>;
export function restoreSessions(data: StudioSnapshot) {
  const sessions = createStudioSessions();
  for (const mode of ["chat", "story"] as const) Object.assign(sessions[mode], data[mode], { messages: data[mode].archive ?? data[mode].committed, notice: "" });
  sessions.chat.timeline.state = data.timeline;
  return sessions;
}
export function sessionSnapshot(saved: ChatSession) {
  return { committed: saved.committed, archive: saved.archive, input: saved.input, started: saved.started, storyState: saved.storyState, speechStyle: saved.speechStyle, chatMemory: saved.chatMemory, visualDetected: saved.visualDetected, latestVisualChange: saved.latestVisualChange };
}
async function localDb() {
  return new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open("maite-mobile-v1", 1); open.onupgradeneeded = () => { open.result.createObjectStore("studio"); }; open.onerror = () => reject(open.error); open.onsuccess = () => resolve(open.result); });
}
export type LocalSnapshot = { snapshot: StudioSnapshot; blob: Blob; gallery?: { id: string; blob: Blob }[] };
export async function localSnapshot(owner: string, value?: LocalSnapshot) {
  const db = await localDb();
  try {
    return await new Promise<LocalSnapshot | undefined>((resolve, reject) => {
      const transaction = db.transaction("studio", value ? "readwrite" : "readonly"); const store = transaction.objectStore("studio");
      const request = value ? store.put(value, owner) : store.get(owner);
      transaction.oncomplete = () => resolve(value ?? request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
