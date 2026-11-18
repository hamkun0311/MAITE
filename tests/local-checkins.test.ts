import test from "node:test";
import assert from "node:assert/strict";
import {afterQuietHours,nextLocalPlan,greeting,koreaDay,consumeLocalPlan,type LocalSettings} from "../lib/notifications/local-checkins.ts";
import {CHECKIN_DELAY_MS,CHECKIN_DELAY_MINUTES} from "../lib/notifications/timing.ts";
const settings:LocalSettings={pushEnabled:true,quietHours:true,nickname:"햄군",activities:[{documentId:"a",userTurns:1,lastUserAt:"2026-11-17T09:30:00+09:00",characterName:"희진"}]};
test("the active test configuration schedules after three minutes and keeps quiet hours",()=>{
 assert.equal(CHECKIN_DELAY_MINUTES,3);assert.equal(CHECKIN_DELAY_MS,180000);
 const now=Date.parse("2026-11-18T10:00:00+09:00"),current={...settings,activities:[{...settings.activities[0],lastUserAt:new Date(now).toISOString()}]};
 assert.equal(Date.parse(nextLocalPlan("user",current,undefined,now,"id")!.dueAt),now+180000);
 const night=Date.parse("2026-11-18T21:59:00+09:00");
 const later=nextLocalPlan("user",{...current,activities:[{...current.activities[0],lastUserAt:new Date(night).toISOString()}]},undefined,night,"night")!;
 assert.equal(later.dueAt,new Date("2026-11-19T10:00:00+09:00").toISOString());
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
 assert.equal(nextLocalPlan("user",other,plan,now+86400000*4,"id-2"),undefined);
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
