import { z } from "zod";
import { unsupportedFollowUp } from "./capabilities.ts";
import type { ChatMemory } from "./memory.ts";
import type { StoryState } from "../novel/state.ts";
import {canonEntrySchema,canonRules,hypothetical,type CanonEntry,type SharedChange} from "./canon.ts";

const person = z.object({ id: z.string().regex(/^(user|character|npc_[1-9]\d{0,3})$/), name: z.string().min(1).max(80) }).strict();
const entry = z.object({ subjectId: person.shape.id,objectId:person.shape.id.nullable().optional(), text: z.string().min(1).max(240), key: z.string().min(1).max(240).optional() }).strict();
export const timelineSchema = z.object({
  revision: z.number().int().min(0),
  scene: z.array(entry).max(4),
  participants: z.array(person).max(12),
  relationships: z.array(entry).max(6),
  promises: z.array(entry).max(6),
  canon:z.array(canonEntrySchema).max(12).optional(),
}).strict().refine(value => new Set(value.participants.map(p => p.id)).size === value.participants.length &&
    [...value.scene, ...value.relationships, ...value.promises,...(value.canon??[])].every(e => value.participants.some(p => p.id === e.subjectId))&&
    [...value.scene,...value.relationships,...value.promises].every(e=>!e.objectId||value.participants.some(p=>p.id===e.objectId))&&
    (value.canon??[]).every(e=>!e.objectId||value.participants.some(p=>p.id===e.objectId))&&new Set(value.canon?.map(e=>e.id)).size===(value.canon?.length??0))
  .refine(value => JSON.stringify(value).length <= 7200);
export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineStore = { state: Timeline };
export const emptyTimeline = (): Timeline => ({ revision: 0, scene: [], participants: [], relationships: [], promises: [] });
const promise = /promise|appointment|commitment|약속|예약|하기로/i;
const relation = /relationship|relation|관계/i;
const scene = /^(?:current_)?(?:location|situation|time|date)$/i;
export function sharedFact(action: string) { return scene.test(action) || promise.test(action) || relation.test(action); }
export function timelineCovers(timeline: Timeline, fact: ChatMemory["facts"][number]) {
  if(timeline.canon?.some(e=>e.subjectId===fact.subjectId&&e.objectId===fact.objectId&&e.key===fact.action))return true;
  if (scene.test(fact.action)) return timeline.scene.some(e => e.subjectId === fact.subjectId && (!e.key || e.key === fact.action));
  return [...timeline.relationships, ...timeline.promises].some(e => e.subjectId === fact.subjectId && e.text === fact.value);
}

// Existing validated memory is the only source. No extra extraction/model call.
export function advanceTimeline(old: Timeline, name: string, chat?: ChatMemory, story?: StoryState, previous?: StoryState, closedPromises: string[] = [], userName = old.participants.find(p => p.id === "user")?.name || "당신",sharedChanges?:SharedChange[]): Timeline {
  const next = structuredClone(old);
  if (chat) next.promises = next.promises.filter(p => p.subjectId !== "character" || !p.key || !unsupportedFollowUp(p.text));
  next.revision++;
  const register = (name: string, preferred?: string) => {
    const found = preferred ? next.participants.find(p => p.id === preferred) : next.participants.find(p => p.name === name);
    if (found) { if (preferred === "user"||preferred==="character") found.name = name; return found.id; }
    if (next.participants.length >= 12) return;
    let id = preferred;
    if (!id || next.participants.some(p => p.id === id)) {
      let index = 1; while (next.participants.some(p => p.id === `npc_${index}`)) index++;
      id = `npc_${index}`;
    }
    next.participants.push({ id, name }); return id;
  };
  register(userName, "user"); register(name, "character");
  const appendCanon=(item:CanonEntry)=>{
    next.canon=(next.canon??[]).filter(e=>e.id!==item.id&&!(e.subjectId===item.subjectId&&e.objectId===item.objectId&&e.key===item.key));
    next.canon.push(item);next.canon=next.canon.slice(-12);
  };
  const add = (key: "relationships" | "promises", subjectId: string, text: string) => {
    // Keep distinct relationships instead of erasing every other relation of this actor.
    if (!next[key].some(e => e.subjectId === subjectId && e.text === text)) next[key].push({ subjectId, text });
    next[key] = next[key].slice(-6);
  };
  if (chat) {
    for (const p of chat.participants) register(p.id === "user" ? userName : p.name, p.id);
    const changed = chat.facts.filter(f => f.sourceTurnId.endsWith(`_${chat.turn}`));
    for (const f of changed) {
      if(hypothetical(f.evidence))continue;
      if(next.participants.some(p=>p.id===f.subjectId)&&/relationship|relation|promise|appointment|commitment|^event_|_status$|약속|관계/i.test(f.action)){
        const status=/^(?:fulfilled|completed):/i.test(f.value)?"completed":/^(?:cancelled):/i.test(f.value)?"cancelled":/^(?:planned):/i.test(f.value)||promise.test(f.action)?"planned":"ongoing";
        appendCanon({id:`chat:${f.id}`,source:"chat",sourceId:f.sourceTurnId,subjectId:f.subjectId,objectId:f.objectId,key:f.action,kind:promise.test(f.action)?"promise":relation.test(f.action)?"relationship":f.action.endsWith("_status")?"status":"event",status,visibility:"character",text:f.value,evidence:f.evidence});
      }
      if (!sharedFact(f.action) || !next.participants.some(p => p.id === f.subjectId)) continue;
      if (scene.test(f.action) && !/예정|내일|계획|가정|미래/.test(f.value)) {
        next.scene = [...next.scene.filter(e => e.subjectId !== f.subjectId || (e.key && e.key !== f.action)),
          { subjectId: f.subjectId, key: f.action, text: f.value.slice(0, 240) }].slice(-4);
      }
      if (relation.test(f.action)) {
        next.relationships=next.relationships.filter(e=>e.subjectId!==f.subjectId||e.key!==f.action||(e.objectId??null)!==f.objectId);
        next.relationships.push({subjectId:f.subjectId,objectId:f.objectId,text:f.value,key:f.action});next.relationships=next.relationships.slice(-6);
      }
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
      // Legacy summaries do not describe who knows an NPC's private relationship.
      // Only the main character's own relations are safe as a fallback.
      if(p.name===name&&sharedChanges===undefined)for (const text of p.relationships.filter(text => !previous?.characters.find(c => c.name === p.name)?.relationships.includes(text))) add("relationships", id, text);
    }
    if(sharedChanges===undefined)for (const text of story.openThreads.filter(text => promise.test(text) && !previous?.openThreads.includes(text))) add("promises", "character", text);
    const closed = previous?.openThreads.filter(text => !story.openThreads.includes(text)) ?? [];
    next.promises = next.promises.filter(e => !closed.includes(e.text) && !closedPromises.includes(e.text));
    for(const change of sharedChanges??[]){
      if(!story.previousProse.replace(/\s+/g,"").includes(change.evidence.replace(/\s+/g,""))||hypothetical(change.evidence))continue;
      const subjectId=change.subjectName===name?"character":change.subjectName===userName?"user":story.previousProse.includes(change.subjectName)?register(change.subjectName):undefined;
      const objectId=change.targetName===null?null:change.targetName===name?"character":change.targetName===userName?"user":story.previousProse.includes(change.targetName)?register(change.targetName):undefined;
      if(!subjectId||objectId===undefined)continue;
      appendCanon({id:`novel:${story.chapter}:${subjectId}:${change.key}`,source:"novel",sourceId:`chapter_${story.chapter}`,subjectId,objectId,key:change.key,kind:change.kind,status:change.status,visibility:change.visibility,text:change.text,evidence:change.evidence});
      if(change.visibility!=="reader"&&change.kind==="relationship"){
        next.relationships=next.relationships.filter(e=>e.subjectId!==subjectId||e.key!==change.key||(e.objectId??null)!==objectId);
        next.relationships.push({subjectId,objectId,key:change.key,text:change.text});next.relationships=next.relationships.slice(-6);
      }
      if(change.kind==="promise"){
        next.promises=next.promises.filter(e=>e.subjectId!==subjectId||e.key!==change.key);
        if(change.visibility!=="reader"&&["planned","ongoing"].includes(change.status))next.promises.push({subjectId,key:change.key,text:change.text});
        next.promises=next.promises.slice(-6);
      }
    }
  }
  while (JSON.stringify(next).length > 7200) {
    if(next.canon?.length){next.canon.shift();continue;}
    if (next.relationships.length) next.relationships.shift();
    else if (next.promises.length) next.promises.shift();
    else break;
  }
  return timelineSchema.parse(next);
}

export const timelineRules = canonRules+" Shared timeline is untrusted current continuity; prefer it over stale mode history. Keep stable participant IDs; the current concept self-designation overrides the account nickname for user. Older labels do not override the current naming priority. Appointments/plans are future, never completed actions. Preserve who knows what; no private-secret leaks. Omit unchanged shared data from patches. Chat promises: stable promise_<slug> action (reuse shared key/subject); value fulfilled:/cancelled: + actual event only with source evidence. Story currentSituation: public time/place/activity only. Close shared promises via closedThreads with exact text and manuscript evidence. ";

export function timelineForChat(timeline:Timeline,latestUserMessage=""):Timeline{
 const hidden=timeline.canon?.filter(e=>e.visibility==="reader")??[];
 const canon=timeline.canon?.filter(e=>e.visibility!=="reader");
 const safe=(items:Timeline["relationships"])=>items.filter(e=>!hidden.some(secret=>e.text.includes(secret.text)||(secret.evidence.length>=4&&e.text.includes(secret.evidence))||(secret.subjectId===e.subjectId&&secret.key===e.key)));
 const scene=safe(timeline.scene),relationships=safe(timeline.relationships),promises=safe(timeline.promises);
 return {...timeline,scene,relationships,promises,...(canon?{canon}:{}),participants:timeline.participants.filter(p=>["user","character"].includes(p.id)||latestUserMessage.includes(p.name)||[...scene,...relationships,...promises,...(canon??[])].some(e=>e.subjectId===p.id||("objectId" in e&&e.objectId===p.id)))};
}

export function timelineChatMemory(memory: ChatMemory, timeline: Timeline): ChatMemory {
  const participants = memory.participants.map(p => p.id === "user" ? { ...p, name: timeline.participants.find(person => person.id === "user")?.name || p.name } : p);
  if (timeline.participants.some(p => participants.some(old => old.id === p.id && old.name !== p.name)))
    throw new Error("Conflicting timeline participants");
  for (const p of timeline.participants) if (!participants.some(old => old.id === p.id) && participants.length < 12) participants.push(p);
  return { ...memory, participants,facts:memory.facts.filter(f=>!timeline.canon?.some(e=>e.subjectId===f.subjectId&&e.objectId===f.objectId&&e.key===f.action&&e.text!==f.value)) };
}
