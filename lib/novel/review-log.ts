import {createHash,randomUUID} from "node:crypto";

export function novelReviewLogLevel(value=process.env.NOVEL_REVIEW_LOG_LEVEL){
  if(value===undefined)return "summary";
  const level=value.trim().toLowerCase();
  return level==="full"||level==="summary"?level:"off";
}
export const isNovelTraceId=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const manuscriptFingerprint=(text:string)=>({chars:Array.from(text).length,proseHash:createHash("sha256").update(text).digest("hex")});

// Project the verdict only: the memory patch can contain the whole story summary.
export function reviewLogVerdict(value:unknown){
  const r=value as Record<string,unknown>|null;
  if(!r||typeof r!=="object")return {};
  return Object.fromEntries(["pass","sceneAudit","conceptAlignment","blockingIssues","completedBeats","resolution"].filter(key=>key in r).map(key=>[key,r[key]]));
}
export function createNovelReviewLogger(context:{traceId?:string;chapter?:number;mode?:string;promptVersion?:string}={}){
  const level=novelReviewLogLevel(),traceId=isNovelTraceId(context.traceId)?context.traceId:randomUUID();
  const emit=(event:string,data:Record<string,unknown>)=>{
    if(level==="off")return;
    try{console.info("novel-review-trace",JSON.stringify({...context,traceId,event,at:new Date().toISOString(),...data}));}catch{/* Diagnostics never change generation or billing. */}
  };
  return {traceId,event(event:string,data:Record<string,unknown>={},contents:Record<string,unknown>={}){
    if(level==="off")return;
    emit(event,data);
    if(level!=="full")return;
    // Chunk full text so long manuscripts/verdicts remain reconstructable in log viewers.
    for(const [name,value] of Object.entries(contents)){
      try{
        const raw=typeof value==="string"?value:JSON.stringify(value);
        if(typeof raw!=="string")continue;
        const text=Array.from(raw).slice(0,100000).join(""),points=Array.from(text),parts=Math.max(1,Math.ceil(points.length/600)),contentId=randomUUID(),fingerprint=manuscriptFingerprint(raw);
        for(let part=0;part<parts;part++)emit("content",{sourceEvent:event,attempt:data.attempt,call:data.call,feature:data.feature,name,contentId,part:part+1,parts,truncated:text.length!==raw.length,...fingerprint,text:points.slice(part*600,(part+1)*600).join("")});
      }catch{/* Optional full diagnostics must not throw. */}
    }
  }};
}

export function logNovelDocumentSaved(payload:Record<string,unknown>,documentId:string,kind:string){
  if(kind!=="chapter")return;
  const story=payload.story as {lastJobId?:unknown;storyState?:{chapter?:unknown;previousProse?:unknown}}|undefined;
  const state=story?.storyState;
  if(!isNovelTraceId(story?.lastJobId)||!Number.isSafeInteger(state?.chapter)||typeof state?.previousProse!=="string")return;
  createNovelReviewLogger({traceId:story.lastJobId,chapter:state!.chapter as number}).event("document_saved",{documentId,storage:"documents",...manuscriptFingerprint(state.previousProse)});
}
