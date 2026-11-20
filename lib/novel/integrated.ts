import {z} from "zod";
import {createFinalReviewSchema,createReviewSchema,createMemoryPatchSchema,hasEvidence,memoryPatchSchema,repeatsPrevious} from "./state.ts";
import {plainDialogue} from "../chat/presentation.ts";
import {sceneAuditPassed} from "./dialogue.ts";

import {promiseAuditFields} from "./promises.ts";

export function integratedEpisodeSchema(finale:boolean,promiseCount=0){
 return z.object({chapter:z.number().int().positive(),arcChapter:z.number().int().min(1).max(5),prose:z.string().min(1).max(8000),
  review:(finale?createFinalReviewSchema():createReviewSchema()).required({sceneAudit:true}).extend({...promiseAuditFields(promiseCount),memoryPatch:createMemoryPatchSchema().required({sharedChanges:true,dialogueRegisters:true})}),
 }).strict();
}
export function validateIntegratedEpisode(value:unknown,chapter:number,arcChapter:number,previousProse:string,promiseCount=0){
 const result=integratedEpisodeSchema(arcChapter===5,promiseCount).parse(value);
 result.prose=plainDialogue(result.prose).trim();
 const count=Array.from(result.prose).length;
 if(result.chapter!==chapter||result.arcChapter!==arcChapter)throw new Error("Integrated episode numbering mismatch");
 if(!result.prose)throw new Error("Integrated episode empty prose");
 if(repeatsPrevious(result.prose,previousProse))throw new Error("Integrated episode repeats previous prose");
 const review=result.review;
 if(!sceneAuditPassed(review.sceneAudit))throw new Error("Integrated scene audit failed");
 if(!review.pass||!review.conceptAlignment.satisfied||review.blockingIssues.some(issue=>issue.type!=="missing_beat"))throw new Error("Integrated episode review failed");
 if(![...review.newEvents,review.endingChange,review.conceptAlignment].every(item=>hasEvidence(result.prose,item.evidence)))throw new Error("Unsupported integrated review");
 if(arcChapter===5){
  const {memoryPatch:_memoryPatch,promiseAudit:_promiseAudit,...verdict}=review;
  const final=createFinalReviewSchema().parse(verdict).resolution;
  if(!final.centralConflictResolved||!final.protagonistOutcomeShown||!final.relationshipOutcomeShown||final.hasSequelHook||!hasEvidence(result.prose,final.evidence))throw new Error("Integrated ending unresolved");
 }
 const patch=memoryPatchSchema.parse(review.memoryPatch);
 const changes=[patch.currentSituation,...patch.newEvents,...patch.resolvedEvents,...patch.openedThreads,...patch.closedThreads,...patch.worldFacts,...(patch.sharedChanges??[]),...(patch.dialogueRegisters??[]),...patch.characters.flatMap(person=>[...(person.goal?[person.goal]:[]),...person.knowledge,...person.relationships])];
 if(!changes.every(item=>hasEvidence(result.prose,item.evidence))||!(patch.dialogueRegisters??[]).every(change=>!change.changeEvidence||hasEvidence(result.prose,change.changeEvidence)))throw new Error("Unsupported integrated memory");
 return {text:result.prose,patch,charCount:count,promiseAudit:review.promiseAudit};
}
