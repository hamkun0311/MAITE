import {CHECKIN_DELAY_MS} from "./timing.ts";
export type Activity = { documentId:string; userTurns:number; lastUserAt:string; characterName:string };
export type LocalPlan = Activity & { id:string; userId:string; dueAt:string; body:string };
export type LocalState = { pending?:LocalPlan;lastFired?:LocalPlan;outbox:LocalPlan[] };
export function consumeLocalPlan(state:LocalState,now:number):LocalState{
 if(!state.pending||Date.parse(state.pending.dueAt)>now)return state;
 return {...state,lastFired:state.pending,pending:undefined,outbox:state.outbox.some(item=>item.id===state.pending!.id)?state.outbox:[...state.outbox,state.pending]};
}
export type LocalSettings = { pushEnabled:boolean; quietHours:boolean; nickname:string; activities:Activity[]; lastDelivered?:{documentId:string;userTurns:number;dueAt:string}|null };
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
 const latest=[lastFired,settings.lastDelivered].filter((item):item is NonNullable<typeof item>=>!!item).sort((a,b)=>Date.parse(b.dueAt)-Date.parse(a.dueAt))[0];
 if(latest){const activity=settings.activities.find(a=>a.documentId===latest.documentId);if(activity&&activity.userTurns<=latest.userTurns)return;}
 const activity=[...settings.activities].sort((a,b)=>Date.parse(b.lastUserAt)-Date.parse(a.lastUserAt))[0];
 if(!activity||!Number.isFinite(Date.parse(activity.lastUserAt)))return;
 let due=afterQuietHours(Math.max(Date.parse(activity.lastUserAt)+delayMs,now+1000),settings.quietHours);
 if(latest&&koreaDay(due)<=koreaDay(Date.parse(latest.dueAt))){const next=new Date(`${koreaDay(Date.parse(latest.dueAt))}T00:00:00+09:00`).getTime()+DAY;due=afterQuietHours(next,settings.quietHours);}
 return {...activity,id,userId,dueAt:new Date(due).toISOString(),body:greeting(settings.nickname,activity.userTurns%3)};
}
