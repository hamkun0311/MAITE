import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {requireNotificationAccount} from "../lib/server/notification-auth.ts";
import {NotificationSyncStore} from "../lib/notifications/sync-store.ts";
import {POST as cron} from "../app/api/cron/checkins/route.ts";
import {GET as notifications,POST as settings} from "../app/api/notifications/route.ts";
const A="11111111-1111-4111-8111-111111111111",D="22222222-2222-4222-8222-222222222222",I="33333333-3333-4333-8333-333333333333";

test("combined notification reads verify real JWT signatures, expiry and issuer and parallelize owned queries",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"],before=keys.map(key=>process.env[key]);
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://jwt-notifications.test",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
 const jwk={...publicKey.export({format:"jwk"}),kid:"notification-key",alg:"ES256",use:"sig"};
 const payload={sub:A,role:"authenticated",aud:"authenticated",iss:"https://jwt-notifications.test/auth/v1",exp:Math.floor(Date.now()/1000)+300,user_metadata:{}};
 const jwt=(claims:object)=>{const raw=[{alg:"ES256",kid:jwk.kid,typ:"JWT"},claims].map(value=>Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");return `${raw}.${sign("sha256",Buffer.from(raw),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;};
 let authReads=0,keyReads=0;const seen=new Set<string>();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith("jwks.json")){keyReads++;return Response.json({keys:[jwk]});}
  if(url.pathname.endsWith("/user")){authReads++;throw new Error("Asymmetric tokens must verify locally");}
  const table=url.pathname.split("/").at(-1)!;seen.add(table);if(seen.size===4)release();
  if(table==="character_checkin_latest")assert.deepEqual(JSON.parse(String(init?.body)),{p_user:A});
  else assert.equal(url.searchParams.get("user_id"),`eq.${A}`);
  await gate;
  if(table==="notification_preferences")return Response.json({push_enabled:true,quiet_hours:false});
  if(table==="character_checkins"){
   assert.equal(url.searchParams.get("document.user_id"),`eq.${A}`);assert.equal(url.searchParams.get("document.deleted_at"),"is.null");
   return Response.json([{document_id:D,document:{id:D}},{document_id:I,document:null}]);
  }
  return Response.json([]);
 });
 const request=(token?:string)=>new Request("https://app.test/api/notifications?sync=1",{headers:token?{Authorization:`Bearer ${token}`}:{}});
 const valid=jwt(payload),timeout=setTimeout(release,1500);t.after(()=>clearTimeout(timeout));
 const response=await notifications(request(valid));assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(body.unread,{[D]:1});assert.deepEqual(body.activities,[]);assert.equal(seen.size,4);
 assert.match(response.headers.get("Server-Timing")!,/inbox_db;dur=/);assert.equal(response.headers.get("Cache-Control"),"no-store");
 assert.equal((await notifications(request(valid))).status,200);assert.equal(authReads,0);assert.equal(keyReads,1);
 for(const token of [undefined,"malformed",jwt({...payload,exp:1}),jwt({...payload,iss:"https://wrong.test/auth/v1"}),jwt({...payload,role:"service_role"}),jwt({...payload,aud:"wrong"}),jwt({...payload,sub:"not-a-user"}),`${valid.slice(0,-10)}AAAAAAAAAA`])assert.equal((await notifications(request(token))).status,401);
});

test("legacy JWT verification shares successful short reads, never extends token expiry and does not cache failures",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"],before=keys.map(key=>process.env[key]);
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://legacy-notifications.test",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 let now=Date.now(),calls=0,fail=false;t.mock.method(Date,"now",()=>now);
 const payload={sub:A,role:"authenticated",aud:"authenticated",iss:"https://legacy-notifications.test/auth/v1",exp:Math.floor(now/1000)+2};
 const token=[{alg:"HS256",typ:"JWT"},payload].map(value=>Buffer.from(JSON.stringify(value)).toString("base64url")).concat(Buffer.from("mock-signature").toString("base64url")).join(".");
 t.mock.method(globalThis,"fetch",async()=>{calls++;return fail?Response.json({message:"invalid token"},{status:401}):Response.json({id:A,user_metadata:{}});});
 const request=()=>new Request("https://app.test/api/notifications?sync=1",{headers:{Authorization:`Bearer ${token}`}});
 await Promise.all([requireNotificationAccount(request()),requireNotificationAccount(request())]);assert.equal(calls,1);
 await requireNotificationAccount(request());assert.equal(calls,1);
 now+=3000;await assert.rejects(requireNotificationAccount(request()));assert.equal(calls,1);
 now-=3000;const other=request();other.headers.set("Authorization",`Bearer ${token.slice(0,-1)}X`);
 fail=true;await assert.rejects(requireNotificationAccount(other));fail=false;await requireNotificationAccount(other);assert.equal(calls,3);
});

test("notification read store collapses bursts, refreshes a dirty in-flight read once and isolates accounts",async()=>{
 const store=new NotificationSyncStore<{unread:number}>();store.activate(A);
 let release!:(value:{unread:number})=>void,calls=0;
 const load=async()=>{calls++;if(calls===1)return new Promise<{unread:number}>(resolve=>{release=resolve;});return {unread:2};};
 const first=store.read(A,load),same=store.read(A,load);assert.equal(first,same);await Promise.resolve();
 store.invalidate(A);store.invalidate(A);release({unread:1});
 assert.deepEqual(await first,{unread:2});assert.equal(calls,2);
 await store.read(A,load);assert.equal(calls,2);store.activate(D);assert.equal(store.snapshot(A),undefined);
 assert.equal(await store.read(A,load),undefined);assert.equal(calls,2);
 let finish!:(value:{unread:number})=>void;const late=store.read(D,()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();store.activate(undefined);finish({unread:9});await late;assert.equal(store.snapshot(D),undefined);
});
test("schedule reads run in parallel with an owned active-document join and expose timing",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),seen=new Set<string>();
 const timeout=setTimeout(release,1500);t.after(()=>clearTimeout(timeout));let parallel=false,calls=0;
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  calls++;const url=new URL(String(input));
  if(url.pathname.includes("/auth/v1/user"))return Response.json({id:A,user_metadata:{}});
  const table=url.pathname.split("/").at(-1)!;
  assert.ok(["notification_preferences","character_activity","character_checkin_latest"].includes(table));
  if(table!=="character_checkin_latest")assert.equal(url.searchParams.get("user_id"),`eq.${A}`);
  else assert.deepEqual(JSON.parse(String(init?.body)),{p_user:A});

  seen.add(table);if(seen.size===3){parallel=true;release();}
  await gate;
  if(table==="notification_preferences")return Response.json({push_enabled:true,quiet_hours:false});
  if(table==="character_activity"){
   assert.match(url.searchParams.get("select")!,/documents!inner/);assert.equal(url.searchParams.get("document.user_id"),`eq.${A}`);assert.equal(url.searchParams.get("document.deleted_at"),"is.null");
   return Response.json([{document_id:D,user_turns:2,last_user_at:"2026-11-19T01:00:00Z",document:{character_name:"희진"}},{document_id:I,user_turns:3,last_user_at:"2026-11-19T02:00:00Z",document:null}]);
  }
  return Response.json([]);
 });
 const response=await notifications(new Request("https://app.test/api/notifications?schedule=1",{headers:{Authorization:"Bearer test"}}));
 assert.equal(response.status,200);assert.equal(parallel,true);assert.equal(calls,4);
 const data=await response.json();assert.deepEqual(data.activities.map((row:any)=>row.documentId),[D]);assert.equal(data.activities[0].characterName,"희진");
 assert.match(response.headers.get("Server-Timing")!,/auth;dur=/);assert.match(response.headers.get("Server-Timing")!,/schedule_db;dur=/);assert.match(response.headers.get("Server-Timing")!,/activity_db;dur=/);
 assert.equal(response.headers.get("Cache-Control"),"no-store");
});
test("local notification API needs no Firebase, enforces ownership and records owned receipts and idempotent retries",async()=>{
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
    const row={document_id:D,user_turns:1,last_user_at:"2026-11-15T00:00:00.000Z",document:{character_name:"희진"}};
    return Response.json(new Headers(init?.headers).get("Accept")?.includes("object")?row:[row]);
   }
   if(url.includes("/documents"))return Response.json(foreign?null:new URL(url).searchParams.get("select")?.includes("character_name")?[{id:D,character_name:"희진"}]:{id:D});
   if(url.includes("/character_checkin_latest"))return Response.json([]);
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


test("unread inbox is scoped to owned active characters and reading acknowledges only displayed IDs",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"],before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 let foreign=false,patches=0;
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname.includes("/auth/v1/user"))return Response.json({id:A,user_metadata:{}});
  if(url.pathname.endsWith("/documents"))return Response.json(foreign?null:{id:D});
  assert.ok(url.pathname.endsWith("/character_checkins"));assert.equal(url.searchParams.get("user_id"),`eq.${A}`);
  assert.equal(url.searchParams.get("read_at"),"is.null");
  if(init?.method==="PATCH"){
   patches++;assert.equal(url.searchParams.get("document_id"),`eq.${D}`);assert.equal(url.searchParams.get("id"),`in.(${I})`);
   assert.ok(Date.parse(JSON.parse(String(init.body)).read_at));return new Response(null,{status:204});
  }
  assert.equal(url.searchParams.get("document.user_id"),`eq.${A}`);assert.equal(url.searchParams.get("document.deleted_at"),"is.null");
  return Response.json([{document_id:D,document:{id:D}},{document_id:D,document:{id:D}},{document_id:I,document:{id:I}},{document_id:A,document:null}]);
 });
 const headers={Authorization:"Bearer test"};
 const response=await notifications(new Request("https://app.test/api/notifications?inbox=1",{headers}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).unread,{[D]:2,[I]:1});assert.equal(response.headers.get("Cache-Control"),"no-store");
 const read=()=>settings(new Request("https://app.test/api/notifications",{method:"POST",headers,body:JSON.stringify({action:"read",documentId:D,ids:[I]})}));
 assert.equal((await read()).status,200);assert.equal(patches,1);
 foreign=true;assert.equal((await read()).status,404);assert.equal(patches,1);
});
