import type { SupabaseClient } from "@supabase/supabase-js";
import { signedImages, thumbnailPath } from "./image-assets.ts";
import { AccountError } from "./account.ts";
import { z } from "zod";

type CoverListing = { id:string; seller_id:string; kind:string; storage_path?:string|null; cover_path?:string|null; novel?:unknown; content?:{novel?:unknown} };
const novelId=(row:CoverListing)=>{const novel=row.novel??row.content?.novel;return novel&&typeof novel==="object"&&"id" in novel&&typeof novel.id==="string"&&z.uuid().safeParse(novel.id).success?novel.id:undefined;};

/** Covers come from server-owned documents/jobs, never a client-supplied storage path. */
export async function listingCoverPaths(db:SupabaseClient,rows:CoverListing[]) {
 const paths=new Map(rows.flatMap(row=>{const path=row.cover_path||row.storage_path;return path?[[row.id,path] as const]:[];}));
 const missing=rows.filter(row=>row.kind==="chapter"&&!paths.has(row.id)&&novelId(row));
 const ids=[...new Set(missing.map(row=>novelId(row)!))];
 if(!ids.length)return paths;
 const docs=await db.from("documents").select("id,user_id,art:payload->art").in("id",ids);
 if(docs.error)throw new AccountError("소설 표지를 불러오지 못했습니다.",503);
 const parsed=(docs.data??[]).map(doc=>({...doc,art:z.object({jobId:z.uuid().optional(),listingId:z.uuid().optional()}).safeParse(doc.art)})).map(doc=>({...doc,art:doc.art.success?doc.art.data:{}}));
 const documents=new Map(parsed.map(doc=>[doc.id,doc]));
 const jobIds=[...new Set(parsed.flatMap(doc=>doc.art.jobId?[doc.art.jobId]:[]))];
 const jobs=jobIds.length?await db.from("generation_jobs").select("id,user_id,storage_path").in("id",jobIds).eq("kind","character").eq("status","completed"):{data:[],error:null};
 if(jobs.error)throw new AccountError("소설 표지를 확인하지 못했습니다.",503);
 const images=new Map((jobs.data??[]).map(job=>[job.id,job]));
 const sourceIds=[...new Set(parsed.flatMap(doc=>doc.art.listingId?[doc.art.listingId]:[]))];
 const sources=sourceIds.length?await db.from("store_listings").select("id,seller_id,storage_path").in("id",sourceIds).eq("kind","character"):{data:[],error:null};
 const orders=sourceIds.length?await db.from("store_orders").select("listing_id,buyer_id").in("listing_id",sourceIds):{data:[],error:null};
 if(sources.error||orders.error)throw new AccountError("표지 이미지 권한을 확인하지 못했습니다.",503);
 for(const row of missing){
  const doc=documents.get(novelId(row)!);if(!doc||doc.user_id!==row.seller_id)continue;
  const job=images.get(doc.art?.jobId);
  if(job?.user_id===row.seller_id&&job.storage_path){paths.set(row.id,job.storage_path);continue;}
  const source=sources.data?.find(source=>source.id===doc.art?.listingId);
  if(source?.storage_path&&(source.seller_id===row.seller_id||orders.data?.some(order=>order.listing_id===source.id&&order.buyer_id===row.seller_id)))paths.set(row.id,source.storage_path);
 }
 return paths;
}

/** The gallery must contain the selection and its backing image must belong to the seller. */
export async function selectedListingCover(db: SupabaseClient, sellerId: string, gallery: {jobId?: string; kind: string}[], jobId: string) {
 const selected = gallery.find(image => image.jobId === jobId);
 if (!selected) throw new AccountError("이 작품의 갤러리에서 표지를 선택해주세요.", 409);
 const result = await db.from("generation_jobs").select("storage_path").eq("id", jobId).eq("user_id", sellerId).eq("kind", selected.kind).eq("status", "completed").maybeSingle();
 if (result.error) throw new AccountError("표지 이미지를 확인하지 못했습니다.", 503);
 if (!result.data?.storage_path) throw new AccountError("선택한 표지 이미지를 사용할 수 없습니다.", 409);
 return result.data.storage_path as string;
}

export async function listingPreviews(db:SupabaseClient,userId:string,rows:CoverListing[]) {
 const paths=await listingCoverPaths(db,rows);
 const unique=[...new Set(paths.values())];
 const urls=unique.length?await signedImages.get(db,userId,unique.flatMap(path=>[path,thumbnailPath(path)])):new Map<string,string|undefined>();
 return new Map(rows.map(row=>{const path=paths.get(row.id);return [row.id,path?urls.get(thumbnailPath(path))||urls.get(path):undefined];}));
}
