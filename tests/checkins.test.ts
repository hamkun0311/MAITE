import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {mergeCheckins} from "../lib/notifications/checkins.ts";
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const D="33333333-3333-4333-8333-333333333333", E="44444444-4444-4444-8444-444444444444";
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create table documents(id uuid primary key,user_id uuid references auth.users(id),kind text,payload jsonb,deleted_at timestamptz);`);
 await db.exec(await readFile(new URL("../supabase/migrations/202611180003_character_checkins.sql",import.meta.url),"utf8"));
 await db.query("insert into auth.users(id,raw_user_meta_data) values($1,'{\"maite_profile\":{\"nickname\":\"햄군\"}}'),($2,'{}')",[A,B]);
 return db;
}
const payload=(turns:number)=>({art:{profile:{name:"희진"}},chat:{archive:Array.from({length:turns},()=>[{role:"user",content:"안녕"},{role:"assistant",content:"반가워"}]).flat()}});
const add=async(db:PGlite,id=D,turns=1)=>db.query("insert into documents(id,user_id,kind,payload) values($1,$2,'studio',$3)",[id,A,JSON.stringify(payload(turns))]);
const prepare=async(db:PGlite,time="2026-11-20T00:00:00Z")=>(await db.query<{n:number}>("select prepare_character_checkins($1::timestamptz) as n",[time])).rows[0].n;
const devices=async(db:PGlite)=>{await db.query("update notification_preferences set push_enabled=true where user_id=$1",[A]);await db.query("insert into push_devices(token,user_id) values('test-device-token-123456',$1)",[A]);};

test("check-ins require consent, a device and 24 hours; select the latest character; suppress all further days until a reply",async()=>{
 const db=await setup();try{
  await add(db);await add(db,E);
  await db.query("update character_activity set last_user_at='2026-11-18T00:00:00Z' where document_id=$1",[D]);
  await db.query("update character_activity set last_user_at='2026-11-19T01:00:00Z' where document_id=$1",[E]);
  assert.equal(await prepare(db),0);await devices(db);
  assert.equal(await prepare(db),0); // newest conversation is only 23 hours old
  assert.equal(await prepare(db,"2026-11-20T01:00:00Z"),1);
  const rows=await db.query<any>("select * from character_checkins");assert.equal(rows.rows[0].document_id,E);
  assert.ok(["뭐해?","나 안 보고 싶어?","보고 싶어, 햄군아."].includes(rows.rows[0].body));
  await db.query("update notification_preferences set quiet_hours=false");
  assert.equal((await db.query("select * from claim_character_checkins()")).rows.length,1);
  assert.equal((await db.query("select * from claim_character_checkins()")).rows.length,0);
  assert.equal(await prepare(db,"2026-11-21T01:00:00Z"),0);
  // Reading, autosaving and replying to another character do not clear the pending reply.
  await db.query("update documents set payload=$1 where id=$2",[JSON.stringify(payload(1)),E]);
  await db.query("update documents set payload=$1 where id=$2",[JSON.stringify(payload(2)),D]);
  assert.equal((await db.query<any>("select awaiting_document from notification_preferences where user_id=$1",[A])).rows[0].awaiting_document,E);
  await db.query("update documents set payload=$1 where id=$2",[JSON.stringify(payload(2)),E]);
  assert.equal((await db.query<any>("select awaiting_document from notification_preferences where user_id=$1",[A])).rows[0].awaiting_document,null);
 }finally{await db.close();}
});

test("Korea quiet hours defer delivery; day cap, deletion and push disable prevent unwanted messages",async()=>{
 const db=await setup();try{
  await add(db);await devices(db);await db.query("update character_activity set last_user_at='2026-11-17T00:00:00Z'");
  assert.equal(await prepare(db,"2026-11-20T13:00:00Z"),0); // 22:00 KST
  assert.equal(await prepare(db,"2026-11-20T22:59:00Z"),0); // 07:59 KST
  assert.equal(await prepare(db,"2026-11-20T23:00:00Z"),1); // 08:00 KST
  await db.query("update notification_preferences set awaiting_document=null");
  assert.equal(await prepare(db,"2026-11-21T01:00:00Z"),0); // same Korea date
  await db.query("update notification_preferences set push_enabled=false");
  assert.equal((await db.query("select * from claim_character_checkins()")).rows.length,0);
  assert.equal((await db.query<any>("select status from character_checkins")).rows[0].status,"cancelled");
  await db.query("update notification_preferences set push_enabled=true,quiet_hours=false");
  await db.query("update documents set deleted_at=now()");
  assert.equal(await prepare(db,"2026-11-22T13:00:00Z"),0);
  const grants=await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','prepare_character_checkins(timestamptz)','execute') as allowed");assert.equal(grants.rows[0].allowed,false);
 }finally{await db.close();}
});

test("greetings merge at the correct completed exchange and do not duplicate after saving",()=>{
 const messages=[{role:"user" as const,content:"안녕"},{role:"assistant" as const,content:"반가워"},{role:"user" as const,content:"응"},{role:"assistant" as const,content:"좋아"}];
 const greetings=[{id:D,body:"뭐해?",user_turns:1,created_at:"2026-11-20"}];
 const merged=mergeCheckins(messages,greetings);assert.equal(merged[2].content,"뭐해?");assert.equal(merged[3].content,"응");assert.deepEqual(mergeCheckins(merged,greetings),merged);
});


test("multi-character inbox migration preserves rows, permits independent daily greetings and retains read receipts",async()=>{
 const db=await setup();try{
  await add(db);await add(db,E);
  await db.query("insert into character_checkins(user_id,document_id,day,user_turns,body,character_name,status) values($1,$2,'2026-11-20',1,'뭐해?','희진','sent')",[A,D]);
  const migration=await readFile(new URL("../supabase/migrations/202611190001_character_checkin_inbox.sql",import.meta.url),"utf8");
  await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query("select * from character_checkins where read_at is null")).rows.length,1);
  await db.query("insert into character_checkins(user_id,document_id,day,user_turns,body,character_name,status) values($1,$2,'2026-11-20',1,'보고 싶어','수아','sent')",[A,E]);
  await assert.rejects(db.query("insert into character_checkins(user_id,document_id,day,user_turns,body,character_name) values($1,$2,'2026-11-20',1,'중복','희진')",[A,D]),/unique/);
  const latest=await db.query<any>("select * from character_checkin_latest($1)",[A]);assert.equal(latest.rows.length,2);
  assert.equal((await db.query("select * from character_checkin_latest($1)",[B])).rows.length,0);
  await db.query("update character_checkins set read_at=now() where user_id=$1 and document_id=$2",[A,D]);
  const unread=await db.query<any>("select document_id from character_checkins where read_at is null");assert.deepEqual(unread.rows.map(row=>row.document_id),[E]);
  await db.exec(migration);assert.equal((await db.query("select * from character_checkins where read_at is not null")).rows.length,1);
 }finally{await db.close();}
});
