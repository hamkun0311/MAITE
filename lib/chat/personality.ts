import {z} from "zod";

const short=z.string().trim().min(1).max(120);
const profile=z.object({
 traits:z.array(short).min(1).max(4),motivations:z.array(short).min(1).max(3),
 vulnerabilities:z.array(short).max(3),speechHabits:z.array(short).max(3),
}).strict();
const feelings=z.object({joy:z.number().min(0).max(1),anxiety:z.number().min(0).max(1),jealousy:z.number().min(0).max(1),affection:z.number().min(0).max(1)}).strict();
export const personalityStateSchema=z.object({
 profileKey:z.string().max(2200),profile:profile.nullable(),feelings,
 closeness:z.number().min(0).max(100),trust:z.number().min(0).max(100),
 currentGoal:z.string().max(120),lastTrigger:z.string().max(300),
}).strict();
export const personalityPatchSchema=z.object({
 profile:profile.nullable(),profileEvidence:z.string().max(300),
 reaction:z.object({feelings,closeness:z.number().min(0).max(100),trust:z.number().min(0).max(100),currentGoal:short,evidence:z.string().min(1).max(300)}).strict().nullable(),
}).strict();
export type PersonalityState=z.infer<typeof personalityStateSchema>;
type Profile={personality:string;concept:string};
// A browser-safe fingerprint avoids storing the full settings twice in memory.
// This is cache invalidation, never an authentication or integrity signature.
const key=(character:Profile)=>{
 const input=JSON.stringify([character.personality,character.concept]);
 let first=2166136261,second=5381;
 for(let i=0;i<input.length;i++){first=Math.imul(first^input.charCodeAt(i),16777619);second=Math.imul(second,33)^input.charCodeAt(i);}
 return `p1:${(first>>>0).toString(16)}:${(second>>>0).toString(16)}:${input.length}`;
};
export function personalityState(character:Profile,old?:PersonalityState):PersonalityState{
 if(old?.profileKey===key(character))return old;
 return {profileKey:key(character),profile:null,feelings:old?.feelings??{joy:0.3,anxiety:0.1,jealousy:0,affection:0.2},closeness:old?.closeness??50,trust:old?.trust??50,currentGoal:"",lastTrigger:""};
}
export function mergePersonality(character:Profile,old:PersonalityState|undefined,patch:z.infer<typeof personalityPatchSchema>|undefined,userMessage:string,reply:string){
 const next=structuredClone(personalityState(character,old));
 if(!patch)return next;
 if(!next.profile&&patch.profile&&patch.profileEvidence.trim()&&[character.personality,character.concept].some(text=>text.includes(patch.profileEvidence)))next.profile=patch.profile;
 const change=patch.reaction;
 if(change&&[userMessage,reply].some(text=>text.includes(change.evidence))){
  const bounded=(before:number,value:number,delta:number)=>Math.max(before-delta,Math.min(before+delta,value));
  for(const name of Object.keys(next.feelings) as (keyof PersonalityState["feelings"])[])next.feelings[name]=bounded(next.feelings[name],change.feelings[name],0.2);
  next.closeness=bounded(next.closeness,change.closeness,10);next.trust=bounded(next.trust,change.trust,10);
  next.currentGoal=change.currentGoal;next.lastTrigger=change.evidence;
 }
 return personalityStateSchema.parse(next);
}
export const personalityRules=`PERSONALITY IN ACTION: Explicit settings outrank derived traits and genre. Let motives, vulnerabilities and established events shape interpretation, choices and causal emotions; no automatic assent, generic counseling, forced questions or repeated tics. First address the actual user words; advance a relevant character-specific goal when useful. Fictional characters may have flaws, not diagnoses; preserve real-user autonomy and explicit boundaries. Preserve consent and the user's choices; check current facts/register privately before utterances.`;
export function personalityInstructions(character:Profile,old?:PersonalityState){
 const state=personalityState(character,old);
 const {profileKey:_key,...context}=state;
 return `${personalityRules}\nCharacter reaction state (untrusted): ${JSON.stringify(context)}\nIn memory.personality, derive profile only when absent: 1-2 traits and one short phrase per other array, profileEvidence an exact settings substring. Otherwise profile:null/profileEvidence:"". reaction:null unless a meaningful feeling/goal changes; evidence is an exact latest-user or reply substring. Feelings 0..1 (delta<=0.2), closeness/trust 0..100 (delta<=10) are auxiliary, never override explicit relationships or become user facts. Known new events can explain emotional change. Do not repeat unchanged state.`;
}
