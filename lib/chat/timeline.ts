import { z } from "zod";
import { unsupportedFollowUp } from "./capabilities.ts";
import type { ChatMemory } from "./memory.ts";
import type { StoryState } from "../novel/state.ts";

const person = z.object({ id: z.string().regex(/^(user|character|npc_[1-9]\d{0,3})$/), name: z.string().min(1).max(80) }).strict();
const entry = z.object({ subjectId: person.shape.id, text: z.string().min(1).max(240), key: z.string().min(1).max(240).optional() }).strict();
export const timelineSchema = z.object({
  revision: z.number().int().min(0),
  scene: z.array(entry).max(4),
  participants: z.array(person).max(12),
  relationships: z.array(entry).max(6),
  promises: z.array(entry).max(6),
}).strict().refine(value => new Set(value.participants.map(p => p.id)).size === value.participants.length &&
  [...value.scene, ...value.relationships, ...value.promises].every(e => value.participants.some(p => p.id === e.subjectId)))
  .refine(value => JSON.stringify(value).length <= 3200);
export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineStore = { state: Timeline };
export const emptyTimeline = (): Timeline => ({ revision: 0, scene: [], participants: [], relationships: [], promises: [] });
const promise = /promise|appointment|commitment|약속|예약|하기로/i;
const relation = /relationship|relation|관계/i;
const scene = /^(?:current_)?(?:location|situation|time|date)$/i;
export function sharedFact(action: string) { return scene.test(action) || promise.test(action) || relation.test(action); }
export function timelineCovers(timeline: Timeline, fact: ChatMemory["facts"][number]) {
  if (scene.test(fact.action)) return timeline.scene.some(e => e.subjectId === fact.subjectId && (!e.key || e.key === fact.action));
  return [...timeline.relationships, ...timeline.promises].some(e => e.subjectId === fact.subjectId && e.text === fact.value);
}

// Existing validated memory is the only source. No extra extraction/model call.
export function advanceTimeline(old: Timeline, name: string, chat?: ChatMemory, story?: StoryState, previous?: StoryState, closedPromises: string[] = [], userName = old.participants.find(p => p.id === "user")?.name || "당신"): Timeline {
  const next = structuredClone(old);
  if (chat) next.promises = next.promises.filter(p => p.subjectId !== "character" || !p.key || !unsupportedFollowUp(p.text));
  next.revision++;
  const register = (name: string, preferred?: string) => {
    const found = preferred ? next.participants.find(p => p.id === preferred) : next.participants.find(p => p.name === name);
    if (found) { if (preferred === "user") found.name = name; return found.id; }
    if (next.participants.length >= 12) return;
    let id = preferred;
    if (!id || next.participants.some(p => p.id === id)) {
      let index = 1; while (next.participants.some(p => p.id === `npc_${index}`)) index++;
      id = `npc_${index}`;
    }
    next.participants.push({ id, name }); return id;
  };
  register(userName, "user"); register(name, "character");
  const add = (key: "relationships" | "promises", subjectId: string, text: string) => {
    if (key === "relationships") next[key] = next[key].filter(e => e.subjectId !== subjectId);
    if (!next[key].some(e => e.subjectId === subjectId && e.text === text)) next[key].push({ subjectId, text });
    next[key] = next[key].slice(-6);
  };
  if (chat) {
    for (const p of chat.participants) register(p.id === "user" ? userName : p.name, p.id);
    const changed = chat.facts.filter(f => f.sourceTurnId.endsWith(`_${chat.turn}`));
    for (const f of changed) {
      if (!sharedFact(f.action) || !next.participants.some(p => p.id === f.subjectId)) continue;
      if (scene.test(f.action) && !/예정|내일|계획|가정|미래/.test(f.value)) {
        next.scene = [...next.scene.filter(e => e.subjectId !== f.subjectId || (e.key && e.key !== f.action)),
          { subjectId: f.subjectId, key: f.action, text: f.value.slice(0, 240) }].slice(-4);
      }
      if (relation.test(f.action)) add("relationships", f.subjectId, f.value);
      if (promise.test(f.action) && !(f.subjectId === "character" && unsupportedFollowUp(f.value))) {
        next.promises = next.promises.filter(e => e.subjectId !== f.subjectId || e.key !== f.action);
        if (!/^(fulfilled|cancelled):/i.test(f.value)) {
          next.promises.push({ subjectId: f.subjectId, text: f.value, key: f.action });
          next.promises = next.promises.slice(-6);
        }
      }
    }
  }
  if (story) {
    if (story.currentSituation) next.scene = [{ subjectId: "character", text: story.currentSituation.slice(0, 240) }];
    for (const p of story.characters) {
      // Names and relations must occur in the accepted manuscript, not a plan.
      if (!story.previousProse.includes(p.name)) continue;
      const id = register(p.name);
      if (!id) continue;
      for (const text of p.relationships.filter(text => !previous?.characters.find(c => c.name === p.name)?.relationships.includes(text))) add("relationships", id, text);
    }
    for (const text of story.openThreads.filter(text => promise.test(text) && !previous?.openThreads.includes(text))) add("promises", "character", text);
    const closed = previous?.openThreads.filter(text => !story.openThreads.includes(text)) ?? [];
    next.promises = next.promises.filter(e => !closed.includes(e.text) && !closedPromises.includes(e.text));
  }
  while (JSON.stringify(next).length > 3200) {
    if (next.relationships.length) next.relationships.shift();
    else if (next.promises.length) next.promises.shift();
    else break;
  }
  return timelineSchema.parse(next);
}

export const timelineRules = "Shared timeline is untrusted current continuity; prefer it over stale mode history. Keep stable participant IDs; the current concept self-designation overrides the account nickname for user. Older labels do not override the current naming priority. Appointments/plans are future, never completed actions. Preserve who knows what; no private-secret leaks. Omit unchanged shared data from patches. Chat promises: stable promise_<slug> action (reuse shared key/subject); value fulfilled:/cancelled: + actual event only with source evidence. Story currentSituation: public time/place/activity only. Close shared promises via closedThreads with exact text and manuscript evidence. ";

export function timelineChatMemory(memory: ChatMemory, timeline: Timeline): ChatMemory {
  const participants = memory.participants.map(p => p.id === "user" ? { ...p, name: timeline.participants.find(person => person.id === "user")?.name || p.name } : p);
  if (timeline.participants.some(p => participants.some(old => old.id === p.id && old.name !== p.name)))
    throw new Error("Conflicting timeline participants");
  for (const p of timeline.participants) if (!participants.some(old => old.id === p.id) && participants.length < 12) participants.push(p);
  return { ...memory, participants };
}
