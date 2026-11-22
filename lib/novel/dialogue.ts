import {z} from "zod";
import type {SpeechStyle} from "../chat/speech.ts";

export const dialogueRegisterChange=(citation:z.ZodType<string>)=>z.object({speaker:z.string().min(1).max(80),addressee:z.string().min(1).max(80),style:z.enum(["polite","casual"]),evidence:citation,changeEvidence:citation.nullable()}).strict();
export const storedDialogueRegister=dialogueRegisterChange(z.string().min(1).max(400)).omit({changeEvidence:true});
export type DialogueRegister={speaker:string;addressee:string;style:SpeechStyle;evidence:string};
export const sceneAuditSchema=z.object({rolesStable:z.boolean(),speechIntentClear:z.boolean(),movementsConsistent:z.boolean(),actionsCoherent:z.boolean()}).strict();
export function sceneAuditPassed(audit:z.infer<typeof sceneAuditSchema>|undefined){
 return !!audit&&audit.rolesStable&&audit.speechIntentClear&&audit.movementsConsistent&&audit.actionsCoherent;
}
export const novelCharacterRules="NOVEL CHARACTERIZATION: Explicit traits, motives and relationships shape each person's interpretation, decisions and dialogue. Emotions change because of established events, not chapter boundaries. Show distinct character choices instead of generic counseling or repetitive tics. Preserve ordinary novel narration and character-specific dialogue; do not apply private-chat output restrictions to the manuscript.";
export function unjustifiedRegisterChanges(previous:DialogueRegister[],changes:z.infer<ReturnType<typeof dialogueRegisterChange>>[],prose:string){
 const clean=(s:string)=>s.replace(/\s+/g,"").normalize("NFC");
 return changes.filter(change=>{
  const old=previous.find(p=>p.speaker===change.speaker&&p.addressee===change.addressee);
  return old&&old.style!==change.style&&(!change.changeEvidence||!clean(prose).includes(clean(change.changeEvidence)));
 });
}
export const novelDialogueRules=`KOREAN DIALOGUE QUALITY: For each line identify its actual addressee, not bystanders. Use explicit settings, established relationship, stored register and prior speech. When public speech turns to a peer aside, use the peer pair's register even without a stored entry. Resume it after a quote or intentional sarcasm. Lasting changes need on-page motivation/agreement; anger or a new chapter alone is insufficient. Keep natural linked replies and avoid fixed substitutions.`;

// Only compare adjacent standalone turns with substantial shared wording.
export function removeAdjacentRepeatedDialogue(prose: string) {
 const parts = prose.split(/(\r?\n(?:[^\S\r\n]*\r?\n)+)/);
 const kept = [parts[0]];
 let previous = standaloneDialogue(parts[0]);
 for (let index = 2; index < parts.length; index += 2) {
  const current = standaloneDialogue(parts[index]);
  if (current && current === previous) continue;
  kept.push(parts[index - 1], parts[index]);
  previous = current;
 }
 return kept.join("");
}

function standaloneDialogue(paragraph: string) {
 const quote = paragraph.trim().match(/^(?:“([^“”\r\n]+)”|"([^"\r\n]+)")$/u);
 const text = (quote?.[1] ?? quote?.[2] ?? "").replace(/^(?:너는?|당신은?)\s+/u, "")
  .normalize("NFC").replace(/[\s\p{P}]/gu, "");
 return text.length >= 24 ? text : "";
}
