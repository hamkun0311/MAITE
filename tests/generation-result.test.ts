import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { withGeneration } from "../lib/server/generation.ts";
import {emptyStoryState} from "../lib/novel/state.ts";
import {manuscriptFingerprint} from "../lib/novel/review-log.ts";
const A="11111111-1111-4111-8111-111111111111";

test("novel persistence traces confirm storage only after settlement succeeds and share the request ID",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","NOVEL_REVIEW_LOG_LEVEL"],before=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key",NOVEL_REVIEW_LOG_LEVEL:"summary"});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 let failWrite=false;
 t.mock.method(globalThis,"fetch",async(input:unknown,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes("/auth/v1/user"))return Response.json({id:A,role:"authenticated",aud:"authenticated"});
  if(url.includes("/rpc/reserve_generation_v2"))return Response.json({id:randomUUID(),status:"reserved",result:null,storage_path:null});
  if(url.includes("/generation_jobs"))return Response.json([{id:randomUUID()}]);
  if(url.includes("/rpc/finish_generation"))return failWrite&&JSON.parse(String(init?.body)).p_success?Response.json({message:"fixture failure"},{status:503}):Response.json(null);
  throw new Error("Unexpected request");
 });
 const text="PRIVATE_FINAL_NOVEL",state={...emptyStoryState(),chapter:1,previousProse:text};
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
