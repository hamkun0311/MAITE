import {characterDialogueSchema,chatMemorySchema,mergeChatMemory,type ChatMemory} from "./memory.ts";
import {advanceTimeline,type Timeline} from "./timeline.ts";
import type {CharacterContext} from "./character.ts";
import {z} from "zod";

const spoken=z.object({utterances:characterDialogueSchema.shape.utterances,speechStyle:z.unknown().optional(),clothingMentioned:z.unknown().optional(),locationChanged:z.unknown().optional(),continuity:z.unknown().optional(),memory:z.unknown().optional()}).strict();
const metadata=characterDialogueSchema.pick({continuity:true,memory:true});
/** Spoken output is mandatory. Auxiliary state is best-effort, never a reason to lose a valid reply. */
export function completeCharacterReply(raw:unknown,old:ChatMemory,character:CharacterContext,userMessage:string,timeline?:Timeline,userName?:string){
 const value=spoken.parse(raw);
 const words={utterances:value.utterances};
 const style=characterDialogueSchema.shape.speechStyle.safeParse(value?.speechStyle);
 const hintsValid=style.success&&typeof value?.clothingMentioned==="boolean"&&typeof value?.locationChanged==="boolean";
 const reply={...words,speechStyle:style.success?style.data:undefined,clothingMentioned:value?.clothingMentioned===true,locationChanged:value?.locationChanged===true};
 const text=reply.utterances.join("\n\n");
 const retained=chatMemorySchema.safeParse({...old,turn:old.turn+1});
 const fallback=(reason:string)=>({reply,text,memory:retained.success?retained.data:undefined,timeline:undefined as Timeline|undefined,degraded:reason});
 const parsed=metadata.safeParse({continuity:value?.continuity,memory:value?.memory});
 if(!parsed.success)return fallback("invalid_metadata");
 try{
  const next=mergeChatMemory(old,parsed.data.memory,userMessage,text,character,timeline);
  const ids=new Set(next.participants.map(person=>person.id));
  if([parsed.data.continuity.actorId,parsed.data.continuity.targetId].some(id=>id!==null&&!ids.has(id))||parsed.data.continuity.factIds.some(id=>!old.facts.some(fact=>fact.id===id)))return fallback("unsupported_continuity");
  // Build both updates before publishing either. If a merge fails, retain both old states.
  const shared=timeline?advanceTimeline(timeline,character.name,next,undefined,undefined,[],userName):undefined;
  return {reply,text,memory:next,timeline:shared,degraded:hintsValid?undefined:"invalid_reply_hints"};
 }catch{return fallback("invalid_memory_or_timeline");}
}

/** The completed provider response is authoritative when incremental deltas were missing. */
export function completedDialogueText(response:unknown,fallback:string){
 const data=response as {output?:{type?:string;content?:{type?:string;text?:string}[]}[]}|undefined;
 if(!Array.isArray(data?.output))return fallback;
 const text=data.output.filter(item=>item.type==="message").flatMap(item=>(item.content??[]).filter(part=>part.type==="output_text"&&typeof part.text==="string").map(part=>part.text!)).join("");
 return text||fallback;
}
