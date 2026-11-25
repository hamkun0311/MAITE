import test from "node:test";
import assert from "node:assert/strict";
import {afterQuietHours,nextLocalPlan,nextLocalPlans,pendingPlans,greeting,koreaDay,consumeLocalPlan,type LocalSettings} from "../lib/notifications/local-checkins.ts";
import {CHECKIN_DELAY_MS,CHECKIN_DELAY_MINUTES} from "../lib/notifications/timing.ts";
const settings:LocalSettings={pushEnabled:true,quietHours:true,nickname:"햄군",activities:[{documentId:"a",userTurns:1,lastUserAt:"2026-11-17T09:30:00+09:00",characterName:"희진"}]};
test("check-ins wait 24 hours after the last conversation and respect quiet hours",()=>{
 assert.equal(CHECKIN_DELAY_MINUTES,1440);assert.equal(CHECKIN_DELAY_MS,86400000);
 const now=Date.parse("2026-11-18T10:00:00+09:00"),current={...settings,activities:[{...settings.activities[0],lastUserAt:new Date(now).toISOString()}]};
 assert.equal(Date.parse(nextLocalPlan("user",current,undefined,now,"id")!.dueAt),now+CHECKIN_DELAY_MS);
 const night=Date.parse("2026-11-18T22:00:00+09:00");
 const later=nextLocalPlan("user",{...current,activities:[{...current.activities[0],lastUserAt:new Date(night).toISOString()}]},undefined,night,"night")!;
 assert.equal(later.dueAt,new Date("2026-11-20T10:00:00+09:00").toISOString());
});

test("old three-minute reservations and unsent receipts are rescheduled under the 24-hour rule",()=>{
 const now=Date.parse("2026-11-18T10:00:00+09:00");
 const activity={...settings.activities[0],lastUserAt:new Date(now).toISOString()};
 const current={...settings,activities:[activity]};
 const old=nextLocalPlan("user",current,undefined,now,"old",180000)!;
 const earliest=now+CHECKIN_DELAY_MS;
 for(const state of [{pending:old,outbox:[]},{lastFired:old,fired:[old],outbox:[old]}]){
  const updated=consumeLocalPlan(state,now+180000);
  assert.equal(updated.outbox.length,0);
  assert.equal(pendingPlans(updated).length,0);
  assert.equal(Date.parse(nextLocalPlans("user",current,updated,now+180000)[0].dueAt),earliest);
 }
});
test("local quiet hours cover 22:00 through 09:59 and defer to 10:00 KST",()=>{
 for(const [input,output] of [
  ["2026-11-18T21:59:59+09:00","2026-11-18T21:59:59+09:00"],
  ["2026-11-18T22:00:00+09:00","2026-11-19T10:00:00+09:00"],
  ["2026-11-18T00:00:00+09:00","2026-11-18T10:00:00+09:00"],
  ["2026-11-18T09:59:59+09:00","2026-11-18T10:00:00+09:00"],
  ["2026-11-18T10:00:00+09:00","2026-11-18T10:00:00+09:00"],
 ])assert.equal(afterQuietHours(Date.parse(input),true),Date.parse(output));
 const night=Date.parse("2026-11-18T23:00:00+09:00");assert.equal(afterQuietHours(night,false),night);
});
test("one-shot planning follows the latest conversation and renews only after a reply",()=>{
 const now=Date.parse("2026-11-17T10:00:00+09:00");
 const plan=nextLocalPlan("user",settings,undefined,now,"id",86400000)!;
 assert.equal(plan.dueAt,new Date("2026-11-18T10:00:00+09:00").toISOString());
 assert.equal(nextLocalPlan("user",settings,plan,now+86400000*4,"id-2"),undefined);
 const other={...settings,activities:[...settings.activities,{documentId:"b",userTurns:3,lastUserAt:"2026-11-19T12:00:00+09:00",characterName:"수아"}]};
 assert.equal(nextLocalPlan("user",other,plan,now+86400000*4,"id-2")?.documentId,"b");
 const replied={...settings,activities:[{...settings.activities[0],userTurns:2,lastUserAt:"2026-11-19T12:00:00+09:00"}]};
 const next=nextLocalPlan("user",replied,plan,Date.parse("2026-11-19T12:00:00+09:00"),"id-2",86400000)!;
 assert.equal(next.dueAt,new Date("2026-11-20T12:00:00+09:00").toISOString());
 assert.equal(nextLocalPlan("user",{...settings,pushEnabled:false},undefined,now,"id"),undefined);
});
test("server receipts also suppress duplicates after device state is lost and Korea dates set the daily cap",()=>{
 const now=Date.parse("2026-11-18T10:00:00+09:00");
 const sent={documentId:"a",userTurns:1,dueAt:new Date(now).toISOString()};
 assert.equal(nextLocalPlan("user",{...settings,lastDelivered:sent},undefined,now+86400000*5,"id"),undefined);
 assert.equal(koreaDay(Date.parse("2026-11-18T15:00:00Z")),"2026-11-19");
 assert.equal(greeting("햄군",2),"보고 싶어, 햄군아.");assert.equal(greeting("수아",2),"보고 싶어, 수아야.");
});
test("elapsed one-shot plans survive restart without repeating or duplicating offline receipts",()=>{
 const now=Date.parse("2026-11-17T10:00:00+09:00"),plan=nextLocalPlan("user",settings,undefined,now,"id",86400000)!;
 const waiting={pending:plan,outbox:[]};assert.equal(consumeLocalPlan(waiting,now),waiting);
 const consumed=consumeLocalPlan(JSON.parse(JSON.stringify(waiting)),Date.parse(plan.dueAt)+1000);
 assert.equal(consumed.pending,undefined);assert.equal(consumed.lastFired?.id,"id");assert.equal(consumed.outbox.length,1);
 const restart=consumeLocalPlan(JSON.parse(JSON.stringify(consumed)),Date.parse(plan.dueAt)+86400000);
 assert.equal(restart.outbox.length,1);assert.equal(nextLocalPlan("user",settings,restart.lastFired,Date.parse(plan.dueAt)+86400000,"new"),undefined);
});


test("all characters reserve independently, and an unanswered greeting blocks only its sender",()=>{
 const now=Date.parse("2026-11-19T12:00:00+09:00");
 const all={...settings,quietHours:false,activities:[{...settings.activities[0],lastUserAt:new Date(now).toISOString()},{documentId:"b",userTurns:4,lastUserAt:new Date(now).toISOString(),characterName:"수아"}]};
 const plans=nextLocalPlans("user",all,{outbox:[]},now);
 assert.equal(plans.length,2);assert.equal(new Set(plans.map(plan=>plan.id)).size,2);
 assert.ok(plans.every(plan=>Date.parse(plan.dueAt)===now+CHECKIN_DELAY_MS));
 const reserved={pending:plans[0],pendingOthers:plans.slice(1),outbox:[]};
 assert.deepEqual(nextLocalPlans("user",all,reserved,now+1000),plans);
 const fired=consumeLocalPlan(reserved,now+CHECKIN_DELAY_MS);
 assert.equal(pendingPlans(fired).length,0);assert.equal(fired.outbox.length,2);
 assert.equal(consumeLocalPlan(fired,now+CHECKIN_DELAY_MS+5000).outbox.length,2);
 assert.equal(nextLocalPlans("user",all,fired,now+86400000).length,0);
 const replyTime=now+CHECKIN_DELAY_MS+600000;
 const replied={...all,activities:all.activities.map(a=>a.documentId==="b"?{...a,userTurns:5,lastUserAt:new Date(replyTime).toISOString()}:a)};
 const resumed=nextLocalPlans("user",replied,fired,replyTime);
 assert.equal(resumed.length,1);assert.equal(resumed[0].documentId,"b");
 assert.equal(koreaDay(Date.parse(resumed[0].dueAt)),"2026-11-21");
 const remote={...all,lastDeliveredByCharacter:plans.map(({documentId,userTurns,dueAt})=>({documentId,userTurns,dueAt}))};
 assert.equal(nextLocalPlans("user",remote,{outbox:[]},now+86400000).length,0);
 assert.equal(nextLocalPlans("user",{...all,pushEnabled:false},reserved,now).length,0);
});
