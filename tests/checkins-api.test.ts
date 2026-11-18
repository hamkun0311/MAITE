import test from "node:test";
import assert from "node:assert/strict";
import {POST as cron} from "../app/api/cron/checkins/route.ts";
import {GET as notifications,POST as settings} from "../app/api/notifications/route.ts";
const A="11111111-1111-4111-8111-111111111111",D="22222222-2222-4222-8222-222222222222",I="33333333-3333-4333-8333-333333333333";
test("local notification API needs no Firebase, enforces ownership and records one receipt per account date",async()=>{
 const original=globalThis.fetch,keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PUSH_NOTIFICATIONS_ENABLED"];
 const env=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let foreign=false,stored:any;let insertCount=0;
 try{
  Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test-key",PUSH_NOTIFICATIONS_ENABLED:"false"});
  globalThis.fetch=async(input,init)=>{
   const url=String(input);
   if(url.includes("/auth/v1/user"))return Response.json({id:A,user_metadata:{maite_profile:{nickname:"햄군"}}});
   if(url.includes("/notification_preferences")){
    if(init?.method==="POST"){stored=JSON.parse(String(init.body));return Response.json([]);}
    return Response.json({push_enabled:true,quiet_hours:true});
   }
   if(url.includes("/character_activity")){
    const row={document_id:D,user_turns:1,last_user_at:"2026-11-15T00:00:00.000Z"};
    return Response.json(new Headers(init?.headers).get("Accept")?.includes("object")?row:[row]);
   }
   if(url.includes("/documents"))return Response.json(foreign?null:new URL(url).searchParams.get("select")?.includes("character_name")?[{id:D,character_name:"희진"}]:{id:D});
   if(url.includes("/character_checkins")){
    if(init?.method==="POST"){insertCount++;return insertCount===1?Response.json([]):Response.json({code:"23505",message:"duplicate"},{status:409});}
    return Response.json([]);
   }
   throw new Error("Unexpected network: Firebase and server scheduling must not be called");
  };
  assert.equal((await cron()).status,410);
  assert.equal((await notifications(new Request("https://app.test/api/notifications"))).status,401);
  const headers={Authorization:"Bearer user-token"};
  const config=await notifications(new Request("https://app.test/api/notifications",{headers}));assert.equal((await config.json()).available,true);
  const schedule=await notifications(new Request("https://app.test/api/notifications?schedule=1",{headers}));
  const plan=await schedule.json();assert.equal(plan.nickname,"햄군");assert.equal(plan.activities[0].documentId,D);assert.equal(plan.activities[0].characterName,"희진");
  foreign=true;assert.equal((await notifications(new Request(`https://app.test/api/notifications?document=${D}`,{headers}))).status,404);foreign=false;
  const send=(body:object)=>settings(new Request("https://app.test/api/notifications",{method:"POST",headers,body:JSON.stringify(body)}));
  assert.equal((await send({action:"settings",pushEnabled:true,quietHours:true})).status,200);
  assert.deepEqual(stored,{user_id:A,push_enabled:true,quiet_hours:true});
  const receipt={action:"delivered",id:I,userId:A,documentId:D,userTurns:1,lastUserAt:"2026-11-15T00:00:00+00:00",dueAt:"2026-11-16T01:00:00.000Z",body:"뭐해?",characterName:"희진"};
  assert.equal((await send({...receipt,userId:D})).status,403);
  assert.equal((await send({...receipt,dueAt:"2026-11-15T00:02:00.000Z"})).status,400);
  assert.equal((await send({...receipt,dueAt:"2026-11-15T00:03:00.000Z"})).status,200);assert.equal((await send(receipt)).status,200);assert.equal(insertCount,2);
 }finally{globalThis.fetch=original;for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
