"use client";
import { characterPreviews } from "./character-previews";
import { imageAssetKey } from "./image-cache";
import { loadAccountImage } from "./image-loader";

/** Bound concurrency/download volume; reuse the same cache keys as the character grid. */
export async function preloadCharacterPreviews(owner:string,jobIds:string[],active:()=>boolean,progress:(loaded:number,total:number)=>void) {
 const ids=[...new Set(jobIds)].slice(0,60);
 if(!ids.length||!active())return;
 let next=0,loaded=0,remote:ReturnType<typeof characterPreviews>|undefined;
 const worker=async()=>{while(active()&&next<ids.length){const id=ids[next++],key=imageAssetKey({jobId:id},"thumbnail");try{
   try { await loadAccountImage(owner,key,""); }
   catch { const images=await(remote??=characterPreviews(owner));if(active()&&images[id])await loadAccountImage(owner,key,images[id]); }
 }catch{/* The grid can retry later. */}if(active())progress(++loaded,ids.length);}};
 await Promise.all([worker(),worker(),worker()]);
}
