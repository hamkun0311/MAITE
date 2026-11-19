import { z } from "zod";
import {CHECKIN_DELAY_MS} from "../../../lib/notifications/timing.ts";
import { AccountError, requireAccount } from "../../../lib/server/account.ts";
import { requireNotificationAccount } from "../../../lib/server/notification-auth.ts";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "../../../lib/server/http.ts";
import { responseTimings } from "../../../lib/server/timing.ts";
export const runtime="nodejs";
export const OPTIONS=preflight;
const inputSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("settings"),pushEnabled:z.boolean(),quietHours:z.boolean()}).strict(),
 z.object({action:z.literal("read"),documentId:z.uuid(),ids:z.array(z.uuid()).min(1).max(200)}).strict(),
 z.object({action:z.literal("delivered"),id:z.uuid(),userId:z.uuid(),documentId:z.uuid(),userTurns:z.number().int().min(1),lastUserAt:z.iso.datetime({offset:true}),dueAt:z.iso.datetime({offset:true}),body:z.string().min(1).max(100),characterName:z.string().max(80)}).strict(),
]);
export async function GET(request:Request){
 const headers=corsHeaders(request);
 const measure=responseTimings(headers);
 try{
  if(!allowedOrigin(request))throw new AccountError("허용되지 않은 요청입니다.",403);
  const url=new URL(request.url),combined=url.searchParams.get("sync")==="1";
  const {db,user}=await measure("auth",()=>combined?requireNotificationAccount(request):requireAccount(request)),document=url.searchParams.get("document");
  const readInbox=async()=>{
   const result=await measure("inbox_db",()=>db.from("character_checkins").select("document_id,document:documents!inner(id)").eq("user_id",user.id).eq("document.user_id",user.id).is("document.deleted_at",null).is("read_at",null).in("status",["sent","sending","failed"]).limit(1000));
   if(result.error)throw new AccountError("안부 알림 DB 업데이트가 필요합니다.",503);
   const unread:Record<string,number>={};for(const row of result.data??[])if(row.document)unread[row.document_id]=(unread[row.document_id]??0)+1;
   return unread;
  };
  if(url.searchParams.get("inbox")==="1"){
   const unread=await readInbox();
   return Response.json({unread},{headers});
  }
  if(document){
   const id=z.uuid().parse(document),owned=await measure("ownership_db",()=>db.from("documents").select("id").eq("id",id).eq("user_id",user.id).is("deleted_at",null).maybeSingle());
   if(owned.error||!owned.data)throw new AccountError("캐릭터를 찾지 못했습니다.",404);
   const result=await measure("messages_db",()=>db.from("character_checkins").select("id,body,user_turns,created_at,read_at").eq("user_id",user.id).eq("document_id",id).in("status",["sending","sent","failed"]).order("created_at",{ascending:true}).limit(1000));
   if(result.error)throw new AccountError("안부 메시지를 불러오지 못했습니다.",503);
   return Response.json({messages:result.data},{headers});
  }
  const scheduling=combined||url.searchParams.get("schedule")==="1";
  const [pref,activity,last,unread]=await measure("schedule_db",()=>Promise.all([
   measure("preferences_db",()=>db.from("notification_preferences").select("push_enabled,quiet_hours").eq("user_id",user.id).maybeSingle()),
   scheduling?measure("activity_db",()=>db.from("character_activity").select("document_id,user_turns,last_user_at,document:documents!inner(character_name:payload->art->profile->>name)").eq("user_id",user.id).eq("document.user_id",user.id).is("document.deleted_at",null).order("last_user_at",{ascending:false}).limit(200)):Promise.resolve({data:[],error:null}),
   scheduling?measure("last_checkin_db",()=>db.rpc("character_checkin_latest",{p_user:user.id})):Promise.resolve({data:[],error:null}),
   combined?readInbox():Promise.resolve(undefined),
  ]));
  if(pref.error)throw new AccountError("알림 DB 업데이트가 필요합니다.",503);
  const settings={pushEnabled:pref.data?.push_enabled??false,quietHours:pref.data?.quiet_hours??true,available:true};
  if(!scheduling)return Response.json(settings,{headers});
  if(activity.error||last.error)throw new AccountError("알림 예약 정보를 불러오지 못했습니다.",503);
  return Response.json({...settings,...(combined?{unread}:{}),nickname:user.user_metadata?.maite_profile?.nickname||"당신",activities:(activity.data??[]).filter(row=>!!row.document).map(row=>{const doc=Array.isArray(row.document)?row.document[0]:row.document;return {documentId:row.document_id,userTurns:row.user_turns,lastUserAt:row.last_user_at,characterName:doc?.character_name||"캐릭터"};}),lastDeliveredByCharacter:(last.data??[]).map((row:{document_id:string;user_turns:number;created_at:string})=>({documentId:row.document_id,userTurns:row.user_turns,dueAt:row.created_at}))},{headers});
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
  }else if(input.action==="read"){
   const owned=await db.from("documents").select("id").eq("id",input.documentId).eq("user_id",user.id).is("deleted_at",null).maybeSingle();
   if(owned.error||!owned.data)throw new AccountError("캐릭터를 찾지 못했습니다.",404);
   const {error}=await db.from("character_checkins").update({read_at:new Date().toISOString()}).eq("user_id",user.id).eq("document_id",input.documentId).in("id",input.ids).is("read_at",null);
   if(error)throw new AccountError("안부 읽음 상태를 저장하지 못했습니다.",503);
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
