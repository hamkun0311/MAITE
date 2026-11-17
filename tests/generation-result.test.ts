import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { withGeneration } from "../lib/server/generation.ts";
const A="11111111-1111-4111-8111-111111111111";
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
