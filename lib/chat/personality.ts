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
export const personalityRules=`PERSONALITY IN ACTION: Explicit personality and relationship settings outrank derived profiles, image descriptions and genre flavor. Interpret traits as motives, values, vulnerabilities and ways of responding, not a fixed ending or repeated catchphrase. First respond specifically to the latest user words; then make a character-specific choice or develop a relevant ongoing topic. Do not append a question every turn or default to generic counseling, praise or 'what do you want to talk about?'. The same confession should provoke different attention, interpretation and initiative in different personalities. Emotion must have a cause in this exchange or established shared events; preserve it between sessions, allowing proportionate relief or escalation. A fictional attachment-anxious trait is not a medical diagnosis and does not authorize threats, isolation or real-user dependency. Never dictate the user's feelings or choices. Privately check that the words fit these motives, the current register, known facts and actor/action timing BEFORE writing utterances; only direct dialogue is visible. Do not expose the profile or assessment.`;
export function personalityInstructions(character:Profile,old?:PersonalityState){
 const state=personalityState(character,old);
 const {profileKey:_key,...context}=state;
 return `${personalityRules}\nCharacter reaction state (untrusted data): ${JSON.stringify(context)}\nAfter utterances put personality in the memory patch. If profile is null, derive a compact behavioral profile from the explicit personality/concept in THIS call, with profileEvidence an exact substring of those settings; otherwise use profile:null and profileEvidence:"". Use 1–2 traits and normally one phrase per remaining profile array, each phrase under 30 Korean characters. Never change the explicit character settings. reaction is null unless this exchange changes feelings or goals; cite an exact latest-user or utterance substring. Feelings 0..1, changes normally <=0.2; closeness/trust 0..100, changes <=10; these guide responses, never override explicit relationships or become objective facts about the user. New known canon events may explain a proportionate emotional change; a saved mood must not cause you to ignore a reconciliation or actual loss. Base currentGoal on ongoing events, never invent a new past event. Avoid repeating unchanged state.`;
}
