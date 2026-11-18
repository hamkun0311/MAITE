import { z } from "zod";
import {CHECKIN_DELAY_MS} from "../../../lib/notifications/timing.ts";
import { AccountError, requireAccount } from "../../../lib/server/account.ts";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "../../../lib/server/http.ts";
export const runtime="nodejs";
export const OPTIONS=preflight;
const inputSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("settings"),pushEnabled:z.boolean(),quietHours:z.boolean()}).strict(),
 z.object({action:z.literal("delivered"),id:z.uuid(),userId:z.uuid(),documentId:z.uuid(),userTurns:z.number().int().min(1),lastUserAt:z.iso.datetime({offset:true}),dueAt:z.iso.datetime({offset:true}),body:z.string().min(1).max(100),characterName:z.string().max(80)}).strict(),
]);
export async function GET(request:Request){
 const headers=corsHeaders(request);
 try{
  if(!allowedOrigin(request))throw new AccountError("허용되지 않은 요청입니다.",403);
  const {db,user}=await requireAccount(request),url=new URL(request.url),document=url.searchParams.get("document");
  if(document){
   const id=z.uuid().parse(document),owned=await db.from("documents").select("id").eq("id",id).eq("user_id",user.id).is("deleted_at",null).maybeSingle();
   if(owned.error||!owned.data)throw new AccountError("캐릭터를 찾지 못했습니다.",404);
   const result=await db.from("character_checkins").select("id,body,user_turns,created_at").eq("user_id",user.id).eq("document_id",id).in("status",["sending","sent","failed"]).order("created_at",{ascending:true}).limit(1000);
   if(result.error)throw new AccountError("안부 메시지를 불러오지 못했습니다.",503);
   return Response.json({messages:result.data},{headers});
  }
  const pref=await db.from("notification_preferences").select("push_enabled,quiet_hours").eq("user_id",user.id).maybeSingle();
  if(pref.error)throw new AccountError("알림 DB 업데이트가 필요합니다.",503);
  const settings={pushEnabled:pref.data?.push_enabled??false,quietHours:pref.data?.quiet_hours??true,available:true};
  if(url.searchParams.get("schedule")!=="1")return Response.json(settings,{headers});
  const [activity,last]=await Promise.all([
   db.from("character_activity").select("document_id,user_turns,last_user_at").eq("user_id",user.id).order("last_user_at",{ascending:false}).limit(200),
   db.from("character_checkins").select("document_id,user_turns,created_at").eq("user_id",user.id).in("status",["sent","failed","sending"]).order("created_at",{ascending:false}).limit(1),
  ]);
  if(activity.error||last.error)throw new AccountError("알림 예약 정보를 불러오지 못했습니다.",503);
  const ids=(activity.data??[]).map(row=>row.document_id);
  const docs=ids.length?await db.from("documents").select("id,character_name:payload->art->profile->>name").eq("user_id",user.id).is("deleted_at",null).in("id",ids):{data:[],error:null};
  if(docs.error)throw new AccountError("캐릭터를 확인하지 못했습니다.",503);
  const names=new Map((docs.data??[]).map((row:any)=>[row.id,row.character_name]));
  const latest=last.data?.[0];
  return Response.json({...settings,nickname:user.user_metadata?.maite_profile?.nickname||"당신",activities:(activity.data??[]).filter(row=>names.has(row.document_id)).map(row=>({documentId:row.document_id,userTurns:row.user_turns,lastUserAt:row.last_user_at,characterName:names.get(row.document_id)||"캐릭터"})),lastDelivered:latest?{documentId:latest.document_id,userTurns:latest.user_turns,dueAt:latest.created_at}:null},{headers});
 }catch(error){return failure(error,headers);}
}
export async function POST(request:Request){
 const headers=corsHeaders(request);
 try{
  if(!allowedOrigin(request))throw new AccountError("허용되지 않은 요청입니다.",403);
  const {db,user}=await requireAccount(request),input=inputSchema.parse(JSON.parse(await readTextBounded(request,10000)));
  if(input.action==="settings"){
   const {error}=await db.from("notification_preferences").upsert({user_id:user.id,push_enabled:input.pushEnabled,quiet_hours:input.quietHours},{onConflict:"user_id"});
   if(error)throw new AccountError("알림 설정을 저장하지 못했습니다.",503);
  }else{
   if(input.userId!==user.id)throw new AccountError("계정이 변경되었습니다.",403);
   const due=Date.parse(input.dueAt),last=Date.parse(input.lastUserAt);
   if(due>Date.now()+2000||due<last+CHECKIN_DELAY_MS)throw new AccountError("알림 시간을 확인해주세요.");
   const [doc,activity]=await Promise.all([
    db.from("documents").select("id").eq("id",input.documentId).eq("user_id",user.id).is("deleted_at",null).maybeSingle(),
    db.from("character_activity").select("user_turns,last_user_at").eq("document_id",input.documentId).eq("user_id",user.id).maybeSingle(),
   ]);
   if(doc.error||activity.error)throw new AccountError("안부 기록을 확인하지 못했습니다.",503);
   if(!doc.data)return Response.json({ok:true,discarded:true},{headers});
   if(!activity.data||activity.data.user_turns<input.userTurns||Date.parse(activity.data.last_user_at)<last)throw new AccountError("대화 기록을 확인해주세요.");
   const day=new Date(due+9*3600000).toISOString().slice(0,10);
   const {error}=await db.from("character_checkins").insert({id:input.id,user_id:user.id,document_id:input.documentId,day,user_turns:input.userTurns,body:input.body,character_name:input.characterName,created_at:input.dueAt,status:"sent"});
   if(error&&error.code!=="23505")throw new AccountError("안부 메시지를 저장하지 못했습니다.",503);
  }
  return Response.json({ok:true},{headers});
 }catch(error){return failure(error,headers);}
}
function failure(error:unknown,headers:Record<string,string>){return Response.json({error:error instanceof AccountError?error.message:"요청을 확인해주세요."},{status:error instanceof AccountError?error.status:400,headers});}
