import {CHECKIN_DELAY_MS} from "./timing.ts";
export type Activity = { documentId:string; userTurns:number; lastUserAt:string; characterName:string };
export type LocalPlan = Activity & { id:string; userId:string; dueAt:string; body:string };
// Keep the first reservation in `pending` so existing device storage remains readable.
export type LocalState = { pending?:LocalPlan;pendingOthers?:LocalPlan[];lastFired?:LocalPlan;fired?:LocalPlan[];outbox:LocalPlan[];notificationIds?:Record<string,number> };
export function pendingPlans(state:LocalState){return [...(state.pending?[state.pending]:[]),...(state.pendingOthers??[])];}
export function consumeLocalPlan(state:LocalState,now:number):LocalState{
 const pending=pendingPlans(state);
 const meetsDelay=(plan:LocalPlan)=>Date.parse(plan.dueAt)>=Date.parse(plan.lastUserAt)+CHECKIN_DELAY_MS;
 const plans=pending.filter(meetsDelay),outbox=state.outbox.filter(meetsDelay);
 const due=plans.filter(plan=>Date.parse(plan.dueAt)<=now);
 if(!due.length&&plans.length===pending.length&&outbox.length===state.outbox.length)return state;
 const discarded=new Set(state.outbox.filter(plan=>!meetsDelay(plan)).map(plan=>plan.id));
 const remaining=plans.filter(plan=>Date.parse(plan.dueAt)>now);
 const fired=new Map((state.fired??(state.lastFired?[state.lastFired]:[]))
  .filter(plan=>!discarded.has(plan.id)).map(plan=>[plan.documentId,plan]));
 for(const plan of due)fired.set(plan.documentId,plan);
 const lastFired=due.at(-1)??(state.lastFired&&!discarded.has(state.lastFired.id)?state.lastFired:undefined);
 return {...state,pending:remaining[0],pendingOthers:remaining.slice(1),lastFired,fired:[...fired.values()],
  outbox:[...outbox,...due.filter(plan=>!outbox.some(item=>item.id===plan.id))]};
}
type Delivered={documentId:string;userTurns:number;dueAt:string};
export type LocalSettings = { pushEnabled:boolean; quietHours:boolean; nickname:string; activities:Activity[]; lastDelivered?:Delivered|null;lastDeliveredByCharacter?:Delivered[] };
const DAY=86400000, KOREA=9*3600000;
export function koreaDay(time:number){return new Date(time+KOREA).toISOString().slice(0,10);}
export function afterQuietHours(time:number,quiet:boolean){
 if(!quiet)return time;
 const local=new Date(time+KOREA),hour=local.getUTCHours();
 if(hour>=22){local.setUTCDate(local.getUTCDate()+1);local.setUTCHours(10,0,0,0);}
 else if(hour<10)local.setUTCHours(10,0,0,0);
 return local.getTime()-KOREA;
}
export function greeting(nickname:string,variant:number){
 const name=nickname.trim().slice(0,32)||"당신";
 const last=name.charCodeAt(name.length-1),suffix=last>=0xac00&&last<=0xd7a3?((last-0xac00)%28?"아":"야"):"";
 return ["뭐해?","나 안 보고 싶어?",`보고 싶어, ${name}${suffix}.`][variant%3];
}
export function nextLocalPlan(userId:string,settings:LocalSettings,lastFired:LocalPlan|undefined,now:number,id:string,delayMs=CHECKIN_DELAY_MS):LocalPlan|undefined{
 if(!settings.pushEnabled)return;
 for(const activity of [...settings.activities].sort((a,b)=>Date.parse(b.lastUserAt)-Date.parse(a.lastUserAt))){
 if(!Number.isFinite(Date.parse(activity.lastUserAt)))continue;
 const latest=[lastFired,settings.lastDelivered,...(settings.lastDeliveredByCharacter??[])].filter((item):item is Delivered=>!!item&&item.documentId===activity.documentId).sort((a,b)=>Date.parse(b.dueAt)-Date.parse(a.dueAt))[0];
 if(latest&&activity.userTurns<=latest.userTurns)continue;
 let due=afterQuietHours(Math.max(Date.parse(activity.lastUserAt)+delayMs,now+1000),settings.quietHours);
 if(latest&&koreaDay(due)<=koreaDay(Date.parse(latest.dueAt))){const next=new Date(`${koreaDay(Date.parse(latest.dueAt))}T00:00:00+09:00`).getTime()+DAY;due=afterQuietHours(next,settings.quietHours);}
 return {...activity,id,userId,dueAt:new Date(due).toISOString(),body:greeting(settings.nickname,activity.userTurns%3)};
 }
}
export function nextLocalPlans(userId:string,settings:LocalSettings,state:LocalState,now:number){
 const pending=pendingPlans(state),fired=state.fired??(state.lastFired?[state.lastFired]:[]);
 return settings.activities.flatMap(activity=>{
  const old=pending.find(plan=>plan.documentId===activity.documentId);
  const plan=nextLocalPlan(userId,{...settings,activities:[activity]},fired.find(plan=>plan.documentId===activity.documentId),now,old?.id??crypto.randomUUID());
  return plan?[plan]:[];
 }).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)||a.documentId.localeCompare(b.documentId));
}
