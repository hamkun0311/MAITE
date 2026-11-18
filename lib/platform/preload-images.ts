"use client";
import { jsonApi } from "./commerce";
import { imageAssetKey } from "./image-cache";
import { loadAccountImage } from "./image-loader";

/** Bound concurrency/download volume; reuse the same cache keys as the character grid. */
export async function preloadCharacterPreviews(owner:string,jobIds:string[],active:()=>boolean,progress:(loaded:number,total:number)=>void) {
 const ids=[...new Set(jobIds)].slice(0,60);
 if(!ids.length||!active())return;
 const data=await jsonApi("/api/account?previews=1");
 const tasks=ids.filter(id=>typeof data.images?.[id]==="string");let next=0,loaded=0;
 const worker=async()=>{while(active()&&next<tasks.length){const id=tasks[next++];try{await loadAccountImage(owner,imageAssetKey({jobId:id},"thumbnail"),data.images[id]);}catch{/* The grid can retry later. */}if(active())progress(++loaded,tasks.length);}};
 await Promise.all([worker(),worker(),worker()]);
}
