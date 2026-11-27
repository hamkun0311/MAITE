import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { withGeneration } from "../lib/server/generation.ts";
import {emptyStoryState} from "../lib/novel/state.ts";
import {manuscriptFingerprint} from "../lib/novel/review-log.ts";
const A="11111111-1111-4111-8111-111111111111";

test("settled chapters replay only within the same story branch and short output remains uncharged", async t => {
 const keys = ["ACCOUNT_FEATURES_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
 const before = keys.map(key => process.env[key]);
 t.after(() => keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }));
 Object.assign(process.env, { ACCOUNT_FEATURES_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "test-key" });
 const stored = new Map<string, { id: string; result: unknown }>();
 const fingerprints = new Map<string, string>();
 let reservations = 0, handlerCalls = 0;
 const settlements: boolean[] = [];
 t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) return Response.json({ id: A, role: "authenticated", aud: "authenticated" });
  if (url.includes("/rpc/claim_story_draft")) return Response.json({});
  if (url.includes("/story_draft_checkpoints")) return new Response(null, { status: 204 });
  if (url.includes("/generation_jobs")) {
   if (init?.method === "PATCH") return Response.json([{ id: A }]);
   const fingerprint = new URL(url).searchParams.get("fingerprint")?.slice(3) ?? "";
   return Response.json(stored.has(fingerprint) ? [stored.get(fingerprint)] : []);
  }
  if (url.includes("/rpc/reserve_story_generation")) {
   reservations++;
   const payload = JSON.parse(String(init?.body));
   fingerprints.set(payload.p_id, payload.p_fingerprint);
   return Response.json({ id: payload.p_id, status: "reserved", result: null, storage_path: null });
  }
  if (url.includes("/rpc/finish_generation")) {
   const payload = JSON.parse(String(init?.body));
   settlements.push(payload.p_success);
   if (payload.p_success) stored.set(fingerprints.get(payload.p_id)!, { id: payload.p_id, result: payload.p_result });
   return Response.json(null);
  }
  throw new Error("Unexpected request");
 });
 let text = "가".repeat(1499);
 const handler = withGeneration(async (_request, store) => {
  assert.ok(store);
  handlerCalls++;
  const state = { ...emptyStoryState(), chapter: 1, previousProse: text };
  return new Response([{ type: "draft_live", text: "검수 전 초고" }, { type: "chapter", text, state }, { type: "done" }].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
   { headers: { "Content-Type": "text/event-stream" } });
 });
 const send = (rewindToken?: string) => handler(new Request("https://app.example/api/chat", {
  method: "POST", headers: { Authorization: "Bearer fixture", "X-Request-Id": randomUUID() },
  body: JSON.stringify({ character: { mode: "story" }, storyDocumentId: A, rewindToken }),
 }));
 assert.doesNotMatch(await (await send()).text(), /"type":"done"/);
 assert.deepEqual(settlements, [false]);
 text = "가".repeat(1500);
 const success = await send();
 const live = await success.text();
 assert.match(live, /"type":"done"/);
 assert.match(live, /"type":"draft_live"/);
 const recovered = await send();
 const replay = await recovered.text();
 assert.match(replay, /"type":"done"/);
 assert.doesNotMatch(replay, /"type":"draft_live"/);
 assert.equal(recovered.headers.get("X-Job-Id"), success.headers.get("X-Job-Id"));
 assert.equal(handlerCalls, 2);
 assert.equal(reservations, 2);
 assert.deepEqual(settlements, [false, true]);
 const rewindToken = randomUUID();
 text = "나".repeat(5000);
 const regenerated = await send(rewindToken);
 assert.match(await regenerated.text(), /나{10}/u);
 assert.notEqual(regenerated.headers.get("X-Job-Id"), success.headers.get("X-Job-Id"));
 assert.match(await (await send(rewindToken)).text(), /나{10}/u);
 assert.equal(handlerCalls, 3);
 assert.equal(reservations, 3);
 assert.deepEqual(settlements, [false, true, true]);
});

test("novel persistence traces confirm storage only after settlement succeeds and share the request ID",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","NOVEL_REVIEW_LOG_LEVEL"],before=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key",NOVEL_REVIEW_LOG_LEVEL:"summary"});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 let failWrite=false;
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes("/auth/v1/user"))return Response.json({id:A,role:"authenticated",aud:"authenticated"});
  if(url.includes("/rpc/reserve_story_generation"))return Response.json({id:randomUUID(),status:"reserved",result:null,storage_path:null});
  if(url.includes("/generation_jobs"))return Response.json([{id:randomUUID()}]);
  if(url.includes("/rpc/finish_generation"))return failWrite&&JSON.parse(String(init?.body)).p_success?Response.json({message:"fixture failure"},{status:503}):Response.json(null);
  throw new Error("Unexpected request");
 });
 const text="PRIVATE_FINAL_NOVEL" + "가".repeat(1500),state={...emptyStoryState(),chapter:1,previousProse:text};
 const handler=async()=>new Response([{type:"chapter",text,state},{type:"done"}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""),{headers:{"Content-Type":"text/event-stream"}});
 const send=()=>withGeneration(handler)(new Request("https://app.example/api/chat",{method:"POST",headers:{Authorization:"Bearer test-token","X-Request-Id":A},body:JSON.stringify({character:{mode:"story"}})}));
 const success=await send();assert.match(await success.text(),/"type":"done"/);
 assert.equal(logs.at(-1).event,"generation_persisted");assert.equal(logs.at(-1).traceId,A);assert.equal(logs.at(-1).proseHash,manuscriptFingerprint(text).proseHash);
 assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_FINAL_NOVEL|test-token|test-key/);
 logs.length=0;failWrite=true;const failure=await send();assert.match(await failure.text(),/"type":"error"/);
 assert.ok(logs.some(row=>row.event==="generation_persistence_failed"));assert.ok(!logs.some(row=>row.event==="generation_persisted"));
});
test("empty/error streams, corrupt images, cancelled output and failed storage never settle a successful charge",async()=>{
 const original=globalThis.fetch;const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const env=Object.fromEntries(keys.map(key=>[key,process.env[key]]));const settlements:{p_success:boolean}[]=[];let storageFails=false,uploads=0;
 try {
  Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
  globalThis.fetch=async(input,init)=>{
   const url=String(input);
   if(url.includes("/auth/v1/user"))return Response.json({id:A,role:"authenticated",aud:"authenticated"});
   if(url.includes("/rpc/reserve_generation_v2"))return Response.json({id:randomUUID(),status:"reserved",result:null,storage_path:null});
   if(url.includes("/generation_jobs")&&init?.method==="PATCH")return Response.json([{id:randomUUID()}]);
   if(url.includes("/rpc/finish_generation")){settlements.push(JSON.parse(String(init?.body)));return Response.json(null);}
   if(url.includes("/storage/v1/object/")){uploads++;return storageFails?Response.json({message:"storage failed"},{status:503}):Response.json({Key:"saved"});}
   throw new Error("Unexpected request");
  };
  const request=(image=false,signal?:AbortSignal)=>new Request("https://app.example/api/"+(image?"characters":"chat"),{method:"POST",headers:{Authorization:"Bearer test-token","X-Request-Id":randomUUID()},body:image?new FormData():JSON.stringify({messages:[{role:"user",content:"hello"}]}),signal});
  for(const events of [[{type:"done"}],[{type:"delta",text:"partial"},{type:"error",message:"failed"},{type:"done"}]]){
   settlements.length=0;
   const response=await withGeneration(async()=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""),{headers:{"Content-Type":"text/event-stream"}}))(request());
   assert.doesNotMatch(await response.text(),/"type":"done"/);assert.ok(settlements.some(s=>!s.p_success));assert.ok(!settlements.some(s=>s.p_success));
  }
  settlements.length=0;
  const bad=await withGeneration(async()=>new Response("broken jpeg",{headers:{"Content-Type":"image/jpeg"}}),true)(request(true));
  assert.ok(bad.status>=400);assert.equal(uploads,0);assert.ok(!settlements.some(s=>s.p_success));
  const jpeg=await sharp({create:{width:8,height:8,channels:3,background:"#c5b0e1"}}).jpeg().toBuffer();
  settlements.length=0;storageFails=true;
  const failed=await withGeneration(async()=>new Response(jpeg,{headers:{"Content-Type":"image/jpeg"}}),true)(request(true));assert.equal(failed.status,503);assert.ok(!settlements.some(s=>s.p_success));
  settlements.length=0;storageFails=false;const abort=new AbortController();const before=uploads;
  await withGeneration(async()=>{abort.abort();return new Response(jpeg,{headers:{"Content-Type":"image/jpeg"}});},true)(request(true,abort.signal));assert.equal(uploads,before);assert.ok(!settlements.some(s=>s.p_success));
  settlements.length=0;
  const valid=await withGeneration(async()=>new Response(jpeg,{headers:{"Content-Type":"image/jpeg"}}),true)(request(true));assert.equal(valid.status,200);assert.equal(settlements.filter(s=>s.p_success).length,1);
 }finally{globalThis.fetch=original;for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test("rendered image resumes storage and a lost success response replays without charging again", async t => {
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const previous=keys.map(key=>process.env[key]);
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 const jpeg=await sharp({create:{width:8,height:8,channels:3,background:"white"}}).jpeg().toBuffer();
 const jobs=new Map<string,{id:string;status:string;storage_path:string|null}>();
 let payload={}, fingerprint="", renders=0, successfulSettlements=0, storageFails=true;
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=new URL(String(input));
  const body=()=>JSON.parse(String(init?.body));
  if(url.pathname.endsWith("/auth/v1/user"))return Response.json({id:A});
  if(url.pathname.endsWith("/claim_image_checkpoint")){
   const next=body().p_fingerprint;if(next!==fingerprint){payload={};fingerprint=next;}return Response.json(payload);
  }
  if(url.pathname.endsWith("/image_generation_checkpoints")){
   if(body().payload){payload=body().payload;return Response.json([{scope:"character:default"}]);}
   return new Response(null,{status:204});
  }
  if(url.pathname.endsWith("/reserve_generation_v2")){
   const job={id:body().p_id,status:"reserved",storage_path:null};jobs.set(job.id,job);return Response.json(job);
  }
  if(url.pathname.endsWith("/generation_jobs")){
   const job=jobs.get(url.searchParams.get("id")?.slice(3)??"");return Response.json(job?[job]:[]);
  }
  if(url.pathname.endsWith("/finish_generation")){
   const result=body(),job=jobs.get(result.p_id)!;
   job.status=result.p_success?"completed":"failed"; job.storage_path=result.p_storage;
   if(result.p_success)successfulSettlements++;
   return Response.json(null);
  }
  if(url.pathname.includes("/storage/v1/object")){
   if(init?.method==="DELETE")return Response.json([]);
   if(init?.method==="GET")return new Response(new Uint8Array(jpeg));
   return storageFails ? Response.json({message:"storage failed"},{status:503}) : Response.json({Key:"saved"});
  }
  throw new Error(url.pathname);
 });
 const post=withGeneration(async()=>{renders++;return new Response(new Uint8Array(jpeg),{headers:{"Content-Type":"image/jpeg","X-Character-Title":"rendered"}});},true);
 const attempt=randomUUID();
 const send=(concept:string)=>{
  const form=new FormData();form.set("messages",JSON.stringify([{role:"user",content:concept}]));
  return post(new Request("https://app.example/api/characters",{method:"POST",headers:{Authorization:"Bearer fixture","X-Request-Id":randomUUID(),"X-Image-Attempt":attempt},body:form}));
 };
 assert.equal((await send("첫 설정")).status,503);
 assert.equal(successfulSettlements,0);
 storageFails=false;
 const saved=await send("첫 설정");assert.equal(saved.status,200);assert.equal(renders,1);assert.equal(successfulSettlements,1);
 const replay=await send("첫 설정");assert.equal(replay.status,200);assert.equal(replay.headers.get("X-Job-Id"),saved.headers.get("X-Job-Id"));
 assert.equal(renders,1);assert.equal(successfulSettlements,1);
 assert.equal((await send("새 설정")).status,200);assert.equal(renders,2);assert.equal(successfulSettlements,2);
});

test("image response retry token reaches the client without storing it in the job record", async t => {
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const previous=keys.map(key=>process.env[key]);
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));

 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith("/auth/v1/user")) return Response.json({id:A});
  if(url.pathname.endsWith("/claim_image_checkpoint")) return Response.json({code:"PGRST202"},{status:404});
  if(url.pathname.endsWith("/reserve_generation_v2")) return Response.json({status:"reserved"});
  if(url.pathname.endsWith("/finish_generation")) {
   const result=JSON.parse(String(init?.body));
   assert.equal(result.p_success,false);
   assert.deepEqual(result.p_result,{usage:[]});
   return Response.json(null);
  }
  if(url.pathname.endsWith("/generation_jobs")) {
   if(init?.method==="PATCH") return Response.json([{id:randomUUID()}]);
   assert.equal(url.searchParams.get("user_id"),`eq.${A}`);
   assert.equal(url.searchParams.get("kind"),"eq.character");
   assert.equal(url.searchParams.get("status"),"eq.completed");
   return Response.json([]);
  }
  throw new Error(url.pathname);
 });
 const post=withGeneration(async (_request,_story,owner)=>{
  assert.equal(owner,A);
  return Response.json({error:"render error"},{status:502,headers:{"X-Image-Retry":"client-only-token"}});
 },true);
 const attempt=randomUUID();
 const send=(concept:string,retryHeader=true)=>{
  const form=new FormData();form.set("messages",JSON.stringify([{role:"user",content:concept}]));
  return post(new Request("https://app.example/api/characters",{method:"POST",headers:{Authorization:"Bearer fixture","X-Request-Id":randomUUID(),...(retryHeader?{"X-Image-Attempt":attempt}:{})},body:form}));
 };
 const response=await send("first design");
 assert.equal(response.status,502);
 assert.equal(response.headers.get("X-Image-Retry"),"client-only-token");
});
