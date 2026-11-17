import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const migration=()=>readFile(new URL("../supabase/migrations/202611180001_deferred_billing_and_character_delete.sql",import.meta.url),"utf8");
async function setup(upgrade=true) {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select '${A}'::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 await db.exec(await readFile(new URL("../supabase/migrations/202611170001_accounts.sql",import.meta.url),"utf8"));
 await db.query("insert into auth.users(id) values($1),($2)",[A,B]);
 await db.query("select grant_purchase($1,'a','hearts_100','a'),grant_purchase($2,'b','hearts_100','b')",[A,B]);
 if(upgrade)await db.exec(await migration());
 return db;
}
const wallet=async(db:PGlite,id=A)=>(await db.query<{transferable:number;bonus:number;free_chats:number}>("select transferable,bonus,free_chats from wallets where user_id=$1",[id])).rows[0];
const reserve=(db:PGlite,id:string,kind="character")=>db.query("select reserve_generation_v2($1,$2,$3,'same-input')",[A,id,kind]);
const success=(db:PGlite,id:string)=>db.query("select finish_generation($1,$2,'{\"headers\":{}}'::jsonb,$3,true)",[A,id,`${A}/${id}.jpg`]);

test("reservations leave balances unchanged; successful persisted output debits once and failures never debit",async()=>{
 const db=await setup();try{
  const first=randomUUID(),second=randomUUID();const before=await wallet(db);
  await reserve(db,first);await reserve(db,second);assert.deepEqual(await wallet(db),before);
  await assert.rejects(reserve(db,randomUUID()),/hearts_in_use/);
  await assert.rejects(db.query("select finish_generation($1,$2,'{\"processing\":true}'::jsonb,null,true)",[A,first]),/invalid_result/);
  assert.deepEqual(await wallet(db),before);
  assert.equal((await db.query("select * from heart_ledger where reference like 'generation:%'")).rows.length,0);
  await success(db,first);assert.equal((await wallet(db)).transferable,50);
  await success(db,first);assert.equal((await wallet(db)).transferable,50);
  await db.query("select finish_generation($1,$2,null,null,false)",[A,second]);
  await db.query("select finish_generation($1,$2,null,null,false)",[A,first]);assert.equal((await wallet(db)).transferable,50);
  assert.equal((await db.query("select * from heart_ledger where reference like 'generation:%'")).rows.length,1);
  assert.equal((await db.query("select * from heart_ledger where reference like 'refund:%'")).rows.length,0);
 }finally{await db.close();}
});
test("free conversation quota is held without decrement and expired jobs release capacity without credits",async()=>{
 const db=await setup();try{
  const ids=Array.from({length:6},()=>randomUUID());for(const id of ids)await reserve(db,id,"chat");
  assert.equal((await wallet(db)).free_chats,5);assert.equal((await wallet(db)).transferable,100);
  const holds=(await db.query<{f:number;t:number}>("select sum(held_free)::int f,sum(held_transferable)::int t from generation_jobs")).rows[0];assert.deepEqual(holds,{f:5,t:2});
  await assert.rejects(db.query("select finish_generation($1,$2,'{\"events\":[{\"type\":\"done\"}]}'::jsonb,null,true)",[A,ids[0]]),/invalid_result/);
  await db.query("select finish_generation($1,$2,$3::jsonb,null,true)",[A,ids[0],JSON.stringify({events:[{type:"delta",text:"반가워"},{type:"done"}]})]);
  assert.equal((await wallet(db)).free_chats,4);
  await db.query("update generation_jobs set created_at=now()-interval '16 minutes' where status='reserved'");await db.query("select expire_generations($1)",[A]);
  assert.deepEqual(await wallet(db),{transferable:100,bonus:0,free_chats:4});
  assert.equal((await db.query("select * from generation_jobs where status='reserved'")).rows.length,0);
 }finally{await db.close();}
});
test("store purchases cannot consume generation holds and commit the entitlement with the debit",async()=>{
 const db=await setup();try{
  const ids=[randomUUID(),randomUUID()];for(const id of ids)await reserve(db,id);
  const listing=(await db.query<{id:string}>("insert into store_listings(seller_id,kind,title,description,content) values($1,'character','책방 친구','','{}') returning id",[B])).rows[0].id;
  await assert.rejects(db.query("select buy_listing($1,$2,$3)",[A,randomUUID(),listing]),/hearts_in_use/);
  assert.equal((await db.query("select * from store_orders")).rows.length,0);
  await db.query("select finish_generation($1,$2,null,null,false)",[A,ids[0]]);
  await db.query("select buy_listing($1,$2,$3)",[A,randomUUID(),listing]);assert.equal((await wallet(db)).transferable,65);
  await success(db,ids[1]);assert.equal((await wallet(db)).transferable,15);
  assert.equal((await db.query("select * from store_orders")).rows.length,1);
 }finally{await db.close();}
});
test("in-flight legacy prepaid jobs refund exactly once after migration and old reserve calls adopt version two",async()=>{
 const db=await setup(false);try{
  const id=randomUUID();await db.query("select reserve_generation($1,$2,'character','old')",[A,id]);assert.equal((await wallet(db)).transferable,50);
  await db.exec(await migration());await db.query("select finish_generation($1,$2,null,null,false)",[A,id]);await db.query("select finish_generation($1,$2,null,null,false)",[A,id]);assert.equal((await wallet(db)).transferable,100);
  const next=randomUUID();await db.query("select reserve_generation($1,$2,'character','new')",[A,next]);assert.equal((await wallet(db)).transferable,100);
  await success(db,next);assert.equal((await wallet(db)).transferable,50);
  assert.equal((await db.query("select * from heart_ledger where reference like 'refund:%'")).rows.length,1);
 }finally{await db.close();}
});
test("deleting a character hides only its owner's graph, stops sales and preserves buyers and ledger",async()=>{
 const db=await setup();try{
  const char=randomUUID(),novel=randomUUID(),other=randomUUID(),job=randomUUID();
  const payload={id:char,art:{jobId:job},story:{documentId:novel}};
  for(const [id,owner,kind,data]of[[char,A,"studio",payload],[novel,A,"chapter",payload],[other,B,"studio",{id:other}]] as const)await db.query("insert into documents(id,user_id,title,kind,payload) values($1,$2,'work',$3,$4::jsonb)",[id,owner,kind,JSON.stringify(data)]);
  const listing=(await db.query<{id:string}>("insert into store_listings(seller_id,kind,title,description,content) values($1,'character','친구','',$2::jsonb) returning id",[A,JSON.stringify({imageJobId:job,profile:{name:"친구"}})])).rows[0].id;
  const book=(await db.query<{id:string}>("insert into store_listings(seller_id,kind,title,description,content) values($1,'chapter','완결 소설','',$2::jsonb) returning id",[A,JSON.stringify({novel:{id:novel,title:"완결 소설",chapters:5},text:"공개된 원고"})])).rows[0].id;
  await db.query("select buy_listing($1,$2,$3)",[B,randomUUID(),listing]);await db.query("select buy_listing($1,$2,$3)",[B,randomUUID(),book]);const paid=await wallet(db,B);
  await assert.rejects(db.query("select delete_character($1,$2)",[B,char]),/invalid_document/);
  await db.query("select delete_character($1,$2)",[A,char]);await db.query("select delete_character($1,$2)",[A,char]);
  assert.equal((await db.query("select * from documents where user_id=$1 and deleted_at is null",[A])).rows.length,0);
  assert.equal((await db.query("select * from documents where id=$1 and deleted_at is null",[other])).rows.length,1);
  assert.equal((await db.query<{active:boolean}>("select active from store_listings where id=$1",[listing])).rows[0].active,false);
  assert.equal((await db.query<{active:boolean;content:{text:string}}>("select active,content from store_listings where id=$1",[book])).rows[0].active,false);
  assert.equal((await db.query<{content:{text:string}}>("select content from store_listings where id=$1",[book])).rows[0].content.text,"공개된 원고");
  assert.equal((await db.query("select * from store_orders where buyer_id=$1",[B])).rows.length,2);assert.deepEqual(await wallet(db,B),paid);
  for(const fn of ['reserve_generation_v2(uuid,uuid,text,text)','delete_character(uuid,uuid)'])assert.equal((await db.query<{ok:boolean}>("select has_function_privilege('authenticated',$1,'execute') ok",['public.'+fn])).rows[0].ok,false);
 }finally{await db.close();}
});
