import {z} from "zod";
export const canonKind=z.enum(["event","relationship","promise","status"]);
export const canonStatus=z.enum(["planned","ongoing","completed","cancelled"]);
export const canonVisibility=z.enum(["public","character","reader"]);
export const canonEntrySchema=z.object({
 id:z.string().min(1).max(180),source:z.enum(["chat","novel"]),sourceId:z.string().min(1).max(60),
 subjectId:z.string().min(1).max(20),objectId:z.string().max(20).nullable(),key:z.string().min(1).max(60),
 kind:canonKind,status:canonStatus,visibility:canonVisibility,
 text:z.string().min(1).max(240),evidence:z.string().min(1).max(400),
}).strict();
export type CanonEntry=z.infer<typeof canonEntrySchema>;
export const sharedChangeSchema=(citation:z.ZodType<string>)=>z.object({
 subjectName:z.string().min(1).max(80),targetName:z.string().min(1).max(80).nullable(),
 key:z.string().min(1).max(60),kind:canonKind,status:canonStatus,visibility:canonVisibility,
 text:z.string().min(1).max(240),evidence:citation,
}).strict();
export type SharedChange=z.infer<ReturnType<typeof sharedChangeSchema>>;
export const canonRules=`SHARED CANON: Confirmed events and accepted manuscripts outrank an outline or stale mode history; explicit latest user settings apply forward without rewriting past chapters. Each entry has source/evidence, actor/target, event key, state and visibility. A chat user assertion remains a reported claim; character-sourced chat entries are fictional roleplay, not independently verified world truth. planned/ongoing are not completed actions. A cancelled or completed obligation must not be reopened without a new supported event. Reader-only secrets, private NPC thoughts and future outlines are not character knowledge. Never promote hypotheticals, jokes, quotations or guesses into events. Keep distinct relationships and distinct events separate; update a matching actor/target/key only. In chat use only public or character-known entries and never infer missing secret details. In a novel, reader-only facts remain unknown to the character until a later on-page revelation. Important shared events may change the next installment's scene and causal path; adapt future plot milestones instead of erasing intervening chat. Unresolved conflicting evidence should be omitted rather than fabricated.`;
export const hypothetical=(text:string)=>/만약|가정(?:하면|해서|이)|(?:라|이)면\s*(?:어떨|좋겠|상상)|농담|장난이야|상상해|what if|hypothetic/i.test(text);
