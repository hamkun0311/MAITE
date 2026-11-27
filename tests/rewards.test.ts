import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
import {GET,POST} from "../app/api/rewards/route.ts";
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
test("reward endpoints use authenticated ownership and reject client-supplied amounts or owners",async t=>{
 const keys=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const old=keys.map(key=>process.env[key]);process.env.ACCOUNT_FEATURES_ENABLED="true";process.env.NEXT_PUBLIC_SUPABASE_URL="https://reward-db.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test-service";
 t.after(()=>keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index];}));
 let calls=0;
 t.mock.method(globalThis,"fetch",async(input:any,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes("/auth/v1/user"))return Response.json({id:A,email:"test@example.com"});
  if(url.includes("/rpc/")){calls++;const body=JSON.parse(String(init?.body));assert.equal(body.p_user,A);assert.equal(body.p_amount,undefined);return Response.json({claimed:20});}
  throw new Error("Unexpected endpoint");
 });
 assert.equal((await GET(new Request("https://app.test/api/rewards?month=2026-11-01"))).status,401);
 const req=(body:unknown,origin="https://app.test")=>new Request("https://app.test/api/rewards",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer test-access",origin},body:JSON.stringify(body)});
 assert.equal((await POST(req({kind:"pass",day:"2026-11-17",userId:B}))).status,400);
 assert.equal((await POST(req({kind:"pass",day:"2026-11-17",amount:10000}))).status,400);
 assert.equal((await POST(req({kind:"pass",day:"2026-11-17"},"https://evil.test"))).status,403);assert.equal(calls,0);
 assert.equal((await POST(req({kind:"pass",day:"2026-11-17"}))).status,200);
 assert.equal((await GET(new Request("https://app.test/api/rewards?month=2026-11-01",{headers:{authorization:"Bearer test-access"}}))).status,200);assert.equal(calls,2);
});
test("manual attendance, catch-up expired pass rewards and story cost are enforced atomically",async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select '${A}'::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for(const file of ["202611170001_accounts.sql","202611180001_deferred_billing_and_character_delete.sql","202611180004_heart_product_amounts.sql","202611180005_heart_pass_800.sql","202611180006_library_rewards_story_cost.sql"])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
  await db.query("insert into auth.users(id) values($1),($2)",[A,B]);
  const today=(await db.query<{value:string}>("select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') as value")).rows[0].value;
  const wallet=async()=> (await db.query<{bonus:number;transferable:number}>("select bonus,transferable from wallets where user_id=$1",[A])).rows[0];
  await db.query("select claim_daily($1)",[A]);assert.equal((await wallet()).bonus,0);
  await assert.rejects(db.query("select claim_reward($1,'attendance',$2::date-1)",[A,today]),/attendance_expired/);
  await assert.rejects(db.query("select claim_reward($1,'attendance',$2::date+1)",[A,today]),/invalid_reward_day/);
  await db.query("select claim_reward($1,'attendance',$2)",[A,today]);const attendance=(await wallet()).bonus;assert.ok([5,15].includes(attendance));
  await db.query("select claim_reward($1,'attendance',$2)",[A,today]);assert.equal((await wallet()).bonus,attendance);
  await db.query("insert into heart_passes(user_id,starts_on,ends_on,daily_hearts) values($1,$2::date-35,$2::date-5,15)",[A,today]);
  await db.query("select claim_reward($1,'pass',$2::date-6)",[A,today]);assert.equal((await wallet()).transferable,15);
  await db.query("select grant_purchase($1,'new-pass','heart_pass_30','new')",[A]);assert.equal((await wallet()).transferable,215);
  await db.query("select claim_reward($1,'pass',$2::date-7)",[A,today]);assert.equal((await wallet()).transferable,230);
  await db.query("select claim_reward($1,'pass',$2)",[A,today]);assert.equal((await wallet()).transferable,250);
  await db.query("select claim_reward($1,'pass',$2)",[A,today]);assert.equal((await wallet()).transferable,250);
  await assert.rejects(db.query("select claim_reward($1,'pass',$2)",[B,today]),/no_pass_reward/);
  await assert.rejects(db.query("select claim_reward($1,'pass',$2::date+1)",[A,today]),/invalid_reward_day/);
  await assert.rejects(db.query("select claim_reward($1,'pass',$2::date-5)",[A,today]),/no_pass_reward/);
  const calendar=(await db.query<{data:{claims:unknown[];passes:unknown[]}}>("select reward_calendar($1,$2) data",[A,today])).rows[0].data;
  assert.ok(calendar.claims.length>=2);assert.ok(calendar.passes.length>=1);
  assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.claim_reward(uuid,text,date)','execute') allowed")).rows[0].allowed,false);
  await db.exec(await readFile(new URL("../supabase/migrations/202611180006_library_rewards_story_cost.sql",import.meta.url),"utf8"));
  assert.equal((await wallet()).transferable,250);
  const job=randomUUID();await db.query("select reserve_generation_v2($1,$2,'story','story-cost')",[A,job]);
  const held=(await db.query<{amount:number}>("select held_bonus+held_transferable as amount from generation_jobs where id=$1",[job])).rows[0].amount;
  assert.equal(held,20);
  const before=await wallet();
  await db.query("select finish_generation($1,$2,$3::jsonb,null,true)",[A,job,JSON.stringify({events:[{type:"chapter",text:"완성된 소설",state:{chapter:1}},{type:"done"}]})]);
  const after=await wallet();assert.equal(before.bonus+before.transferable-after.bonus-after.transferable,20);
  await db.query("select finish_generation($1,$2,$3::jsonb,null,true)",[A,job,JSON.stringify({events:[{type:"chapter",text:"완성된 소설",state:{chapter:1}},{type:"done"}]})]);assert.deepEqual(await wallet(),after);
 }finally{await db.close();}
});
