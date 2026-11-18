"use client";
import {isNative} from "./native";
import {apiFetch} from "./api";
import {invalidateApiReads} from "./commerce";
import {nextLocalPlans,pendingPlans,consumeLocalPlan,type LocalState,type LocalSettings} from "../notifications/local-checkins";
const NOTIFICATION_ID=197003;
type State=LocalState;
let owner:string|undefined,epoch=0,queue:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const next=queue.catch(()=>undefined).then(work);queue=next;return next;}
function read(userId:string):State{
 try{const data=JSON.parse(localStorage.getItem(`maite-local-checkins:${userId}`)||"null");return data&&Array.isArray(data.outbox)?data:{outbox:[]};}catch{return {outbox:[]};}
}
function write(userId:string,state:State){localStorage.setItem(`maite-local-checkins:${userId}`,JSON.stringify(state));}
export function localCheckinStatus(userId:string){try{return localStorage.getItem(`maite-checkin-status:${userId}`)||"안부 예약을 확인하고 있어요.";}catch{return "안부 예약을 확인하고 있어요.";}}
export function updateCheckinStatus(userId:string,message:string){
 try{localStorage.setItem(`maite-checkin-status:${userId}`,message);}catch{/* Storage can be unavailable. */}
 window.dispatchEvent(new Event("maite-checkin-status"));
}
async function notificationApi(path:string,body?:object){
 const response=await apiFetch(path,{...(body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||"알림 연결을 확인해주세요.");return data;
}
export function activateLocalCheckins(userId:string){if(owner!==userId){owner=userId;epoch++;}}
export async function registerPush(requestPermission:boolean){
 if(!isNative())return;
 const {LocalNotifications}=await import("@capacitor/local-notifications");
 let permission=await LocalNotifications.checkPermissions();
 if(permission.display!=="granted"&&requestPermission)permission=await LocalNotifications.requestPermissions();
 if(permission.display!=="granted"&&requestPermission)throw new Error("기기 설정에서 알림 권한을 허용해주세요.");
}
export function syncLocalCheckins(userId:string){
 const revision=epoch;
 return serial(async()=>{
  if(owner!==userId||revision!==epoch)return;
  const LocalNotifications=isNative()?(await import("@capacitor/local-notifications")).LocalNotifications:undefined;
  const now=Date.now(),state=consumeLocalPlan(read(userId),now);write(userId,state);
  const receipts=[...state.outbox];let recorded=false;
  await Promise.all(Array.from({length:Math.min(4,receipts.length)},async()=>{
   while(receipts.length&&owner===userId&&revision===epoch){
    const receipt=receipts.shift()!;
    try{await notificationApi("/api/notifications",{action:"delivered",...receipt});state.outbox=state.outbox.filter(item=>item.id!==receipt.id);write(userId,state);recorded=true;}
    catch { break; /* Retain failed receipts; another character can still be recorded. */ }
   }
  }));
  if(recorded){invalidateApiReads();if(owner===userId&&revision===epoch)window.dispatchEvent(new Event("maite-checkins-refresh"));}
  if(owner!==userId||revision!==epoch)return;
  const settings:LocalSettings=await notificationApi("/api/notifications?schedule=1");
  if(owner!==userId||revision!==epoch)return;
  const granted=!LocalNotifications||(await LocalNotifications.checkPermissions()).display==="granted";
  const plans=granted?nextLocalPlans(userId,settings,state,now):[];
  const next=plans[0];
  updateCheckinStatus(userId,!settings.pushEnabled?"앱 알림이 꺼져 있어요.":!granted?"기기 설정에서 알림 권한을 허용해주세요.":!settings.activities.length?"캐릭터와 대화를 마치면 안부를 예약해요.":next?`다음 안부: ${new Date(next.dueAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})} (한국시간) · ${plans.length}명 예약` :"지난 안부에 답장하면 다음 안부를 예약해요.");
  const previous=pendingPlans(state);
  if(JSON.stringify(plans)===JSON.stringify(previous)){
   if(!LocalNotifications)return next?.dueAt;
   const pending=await LocalNotifications.getPending();
   if(plans.every(plan=>pending.notifications.some(n=>n.id===state.notificationIds?.[plan.documentId])))return next?.dueAt;
  }
  await LocalNotifications?.cancel({notifications:[{id:NOTIFICATION_ID},...Object.values(state.notificationIds??{}).map(id=>({id}))]});
  state.pending=undefined;state.pendingOthers=[];write(userId,state);
  if(!plans.length||owner!==userId||revision!==epoch)return;
  state.notificationIds??={};
  let nextId=Math.max(NOTIFICATION_ID,...Object.values(state.notificationIds));
  for(const plan of plans)state.notificationIds[plan.documentId]??=++nextId;
  await LocalNotifications?.createChannel({id:"character-checkins",name:"캐릭터 안부",description:"캐릭터가 보내는 안부 메시지",importance:3,visibility:0});
  if(owner!==userId||revision!==epoch)return;
  state.pending=plans[0];state.pendingOthers=plans.slice(1);write(userId,state);
  try{
   await LocalNotifications?.schedule({notifications:plans.map(plan=>({id:state.notificationIds![plan.documentId],title:plan.characterName,body:plan.body,channelId:"character-checkins",smallIcon:"ic_stat_checkin",autoCancel:true,schedule:{at:new Date(plan.dueAt),allowWhileIdle:true},isExactNotification:false,extra:{userId,documentId:plan.documentId,checkinId:plan.id}}))});
  }catch(error){state.pending=undefined;state.pendingOthers=[];write(userId,state);throw error;}
  return next?.dueAt;
 });
}
export function unregisterPush(){
 const previous=owner;owner=undefined;epoch++;
 return serial(async()=>{
  if(isNative()){
   const {LocalNotifications}=await import("@capacitor/local-notifications");
   const ids=[NOTIFICATION_ID,...Object.values(previous?read(previous).notificationIds??{}:{})];
   await LocalNotifications.cancel({notifications:ids.map(id=>({id}))});
   const delivered=await LocalNotifications.getDeliveredNotifications();
   await LocalNotifications.removeDeliveredNotifications({notifications:delivered.notifications.filter(n=>ids.includes(n.id))});
  }
  if(previous){const state=consumeLocalPlan(read(previous),Date.now());state.pending=undefined;state.pendingOthers=[];write(previous,state);}
 });
}
export function cancelLocalReservation(){
 const previous=owner;epoch++;
 return serial(async()=>{
  if(isNative()){
   const {LocalNotifications}=await import("@capacitor/local-notifications");
   const ids=[NOTIFICATION_ID,...Object.values(previous?read(previous).notificationIds??{}:{})];
   await LocalNotifications.cancel({notifications:ids.map(id=>({id}))});
  }
  if(previous){const state=consumeLocalPlan(read(previous),Date.now());state.pending=undefined;state.pendingOthers=[];write(previous,state);}
 });
}
