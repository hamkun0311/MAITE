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
export const novelDialogueRules=`KOREAN DIALOGUE QUALITY: Keep a stable register per speaker -> addressee from explicit settings, stored dialogueRegisters and accepted dialogue. Different speakers may legitimately use different registers. A lasting switch needs on-page motivation/agreement; teasing, anger or a new chapter alone is insufficient. Use natural Korean and connected question/answer meaning. A deliberate deflection, quoted imitation or local sarcasm is allowed and does not reset the relationship or register. These are contextual rules, never fixed word substitutions.`;
