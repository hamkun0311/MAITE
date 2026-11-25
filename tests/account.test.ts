import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { allowedOrigin, corsHeaders } from "../lib/server/http.ts";
import { withGeneration } from "../lib/server/generation.ts";
import { snapshotSchema, restoreSessions } from "../lib/platform/snapshot.ts";
import { createStudioSessions } from "../lib/chat/session.ts";
import { verifyAdmob } from "../lib/server/admob.ts";
import { verifyPurchase, playAccountId } from "../lib/server/play.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { novelListings, unpublishedNovelRows, isPublishedNovel, listingId } from "../lib/server/publishing.ts";
import { personalizeNovelText } from "../lib/novel/reader-name.ts";
import { novelComplete, libraryNovels } from "../lib/account/library.ts";
import { emptyStoryState } from "../lib/novel/state.ts";
import { userProfileSchema } from "../lib/account/profile.ts";
import { PRODUCTS } from "../lib/account/policy.ts";

test("rewinding a saved story restores both documents and rejects stale saves", async () => {
  const db = new PGlite();
  const studio = "33333333-3333-4333-8333-333333333333", novel = "44444444-4444-4444-8444-444444444444";
  const jobs = ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"];
  const savedImageJob = "77777777-7777-4777-8777-777777777777";
  const times = [1, 2].map(revision => ({ revision, scene: [], participants: [], relationships: [], promises: [] }));
  const pages = ["첫 번째 원고", "두 번째 원고"];
  const messages = pages.flatMap(content => [{ role: "user", content: "다음" }, { role: "assistant", content }]);
  const state = (index: number) => ({ chapter: index + 1, previousProse: pages[index] });
  const payload = {
    id: studio, story: { documentId: novel, storyState: state(1), lastJobId: jobs[1], archive: messages, committed: messages },
    timeline: times[1], chat: { committed: [] },
    gallery: [1, 2].map(chapter => ({ id: `illustration-${chapter}`, kind: "illustration", scene: { novelId: novel, chapter }, ...(chapter === 2 ? {jobId:savedImageJob} : {}) })),
    backgrounds: { story: "illustration-2" },
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql as $$ select '${A}'::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const migration of ["202611170001_accounts.sql", "202611180001_deferred_billing_and_character_delete.sql", "202611230001_story_rewind.sql"])
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await db.query("insert into auth.users(id) values($1),($2)", [A, B]);
    await db.query("insert into documents(id,user_id,kind,title,payload) values($1,$3,'studio','Character',$4),($2,$3,'chapter','Story',$4)", [studio, novel, A, payload]);
    for (const [index, id] of jobs.entries()) {
      const events = [{ type: "timeline", expectedRevision: index, state: times[index] }, { type: "chapter", text: pages[index], state: state(index) }];
      await db.query("insert into generation_jobs(id,user_id,kind,fingerprint,status,result) values($1,$2,'story','test','completed',$3)", [id, A, { events }]);
    }
    await db.query("insert into generation_jobs(id,user_id,kind,fingerprint,status,storage_path) values($1,$2,'illustration','test','completed',$3)", [savedImageJob,A,`${A}/${savedImageJob}.jpg`]);
    const rewind = (owner: string, from: number, job: string) =>
      db.query<{ result: typeof payload }>("select rewind_story($1,$2,$3,$4,$5) as result", [owner, studio, novel, from, job]);
    await assert.rejects(rewind(B, 2, jobs[1]), /stale_story_snapshot/);
    const { rows: [{ result }] } = await rewind(A, 2, jobs[1]);
    assert.deepEqual(result.story.archive, messages.slice(0, 2));
    assert.deepEqual(result.story.storyState, state(0));
    assert.equal(result.story.lastJobId, jobs[0]);
    assert.deepEqual(result.timeline, times[0]);
    assert.deepEqual(result.gallery, payload.gallery.slice(0, 1));
    assert.deepEqual(result.backgrounds, {});
    const saved = await db.query("select payload from documents order by id");
    assert.deepEqual(saved.rows, [{ payload: result }, { payload: result }]);
    assert.equal((await db.query("select id from story_rewind_backups")).rows.length, 1);
    await assert.rejects(db.query("update documents set payload=$1 where id=$2", [payload, studio]), /stale_story_snapshot/);
    await db.exec(await readFile(new URL("../supabase/migrations/202611250002_preserve_rewound_illustrations.sql", import.meta.url), "utf8"));
    const recovered = {id:`rewound-${savedImageJob}`,kind:"illustration",jobId:savedImageJob};
    const galleries = await db.query("select payload->'gallery' as gallery from documents order by id");
    assert.deepEqual(galleries.rows, Array.from({length:2},()=>({gallery:[payload.gallery[0],recovered]})));
    const first = (await rewind(A, 1, jobs[0])).rows[0].result;
    assert.deepEqual(first.story.archive, []);
    assert.equal(first.story.storyState, undefined);
    assert.equal(first.timeline.revision, 0);
    assert.deepEqual(first.gallery,[{id:"illustration-1",kind:"illustration"},recovered]);
  } finally { await db.close(); }
});

test("800-heart pass applies to future purchases while preserving both previous pass benefits",async()=>{
 const db=new PGlite();const C="55555555-5555-4555-8555-555555555555";
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql as $$ select '${A}'::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec(await readFile(new URL("../supabase/migrations/202611170001_accounts.sql",import.meta.url),"utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)",[A,B,C]);
  await db.query("select grant_purchase($1,'pass-400','heart_pass_30','old')",[A]);
  await db.exec(await readFile(new URL("../supabase/migrations/202611180004_heart_product_amounts.sql",import.meta.url),"utf8"));
  await db.query("select grant_purchase($1,'pass-600','heart_pass_30','previous')",[B]);
  const sql=await readFile(new URL("../supabase/migrations/202611180005_heart_pass_800.sql",import.meta.url),"utf8");
  await db.exec(sql);
  const balance=async(id:string)=>Number((await db.query<{transferable:number}>("select transferable from wallets where user_id=$1",[id])).rows[0].transferable);
  assert.equal(await balance(A),100);assert.equal(await balance(B),150);
  await db.query("select grant_purchase($1,'pass-800','heart_pass_30','new')",[C]);
  const product=PRODUCTS.find(product=>product.id==="heart_pass_30")!;
  assert.equal(await balance(C),product.hearts);
  const pass=(await db.query<{daily_hearts:number;days:number}>("select daily_hearts,ends_on-starts_on as days from heart_passes where user_id=$1",[C])).rows[0];
  assert.deepEqual(pass,{daily_hearts:20,days:30});assert.equal(product.hearts+pass.daily_hearts*pass.days,800);
  for(const id of [A,B,C])await db.query("select claim_daily($1)",[id]);
  assert.equal(await balance(A),110);assert.equal(await balance(B),165);assert.equal(await balance(C),220);
  await db.exec(sql);await db.query("select grant_purchase($1,'pass-800','heart_pass_30','new')",[C]);await db.query("select claim_daily($1)",[C]);assert.equal(await balance(C),220);
  await assert.rejects(db.query("select grant_purchase($1,'duplicate-pass','heart_pass_30','duplicate')",[C]),/pass_active/);
  await assert.rejects(db.query("select grant_purchase($1,'pass-800','heart_pass_30','new')",[A]),/invalid_purchase/);
 }finally{await db.close();}
});

test("updated heart packs grant new quantities once without repricing old purchases",async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql as $$ select '${A}'::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec(await readFile(new URL("../supabase/migrations/202611170001_accounts.sql",import.meta.url),"utf8"));
  await db.query("insert into auth.users(id) values($1),($2)",[A,B]);
  await db.query("select grant_purchase($1,'old-token','hearts_100','old-order')",[A]);
  await db.query("select grant_purchase($1,'old-pass','heart_pass_30','old-pass-order')",[B]);
  await db.exec(await readFile(new URL("../supabase/migrations/202611180004_heart_product_amounts.sql",import.meta.url),"utf8"));
  const balance=async()=>Number((await db.query<{transferable:number}>("select transferable from wallets where user_id=$1",[A])).rows[0].transferable);
  assert.equal(await balance(),100);
  await db.query("select grant_purchase($1,'old-token','hearts_100','old-order')",[A]);assert.equal(await balance(),100);
  let expected=100;
  for(const product of PRODUCTS.filter(product=>product.id!=="heart_pass_30")){
   await db.query("select grant_purchase($1,$2,$3,'new-order')",[A,product.id,product.id]);expected+=product.hearts;
   assert.equal(await balance(),expected);
   await db.query("select grant_purchase($1,$2,$3,'new-order')",[A,product.id,product.id]);assert.equal(await balance(),expected);
  }
  assert.equal(await balance(),1650);
  await db.query("select grant_purchase($1,'new-pass','heart_pass_30','new-pass-order')",[A]);assert.equal(await balance(),1800);
  await db.query("select grant_purchase($1,'new-pass','heart_pass_30','new-pass-order')",[A]);assert.equal(await balance(),1800);
  await assert.rejects(db.query("select grant_purchase($1,'second-pass','heart_pass_30','second-pass-order')",[A]),/pass_active/);
  const pass=(await db.query<{daily_hearts:number;days:number}>("select daily_hearts,ends_on-starts_on as days from heart_passes where user_id=$1",[A])).rows[0];
  assert.deepEqual(pass,{daily_hearts:15,days:30});assert.equal(150+pass.daily_hearts*pass.days,600);
  await db.query("select claim_daily($1)",[A]);assert.equal(await balance(),1815);
  await db.query("select claim_daily($1)",[A]);assert.equal(await balance(),1815);
  assert.equal((await db.query<{daily_hearts:number}>("select daily_hearts from heart_passes where user_id=$1",[B])).rows[0].daily_hearts,10);
  await db.query("select claim_daily($1)",[B]);
  assert.equal(Number((await db.query<{transferable:number}>("select transferable from wallets where user_id=$1",[B])).rows[0].transferable),110);
  await db.query("update heart_passes set starts_on=(now() at time zone 'Asia/Seoul')::date-30,ends_on=(now() at time zone 'Asia/Seoul')::date where user_id=$1",[A]);
  await db.query("delete from daily_claims where user_id=$1 and kind='pass'",[A]);
  await db.query("select claim_daily($1)",[A]);assert.equal(await balance(),1815);
  await assert.rejects(db.query("select grant_purchase($1,'old-token','hearts_100','old-order')",[B]),/invalid_purchase/);
  assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.grant_purchase(uuid,text,text,text)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test("public profile needs only nickname and gender while accepting legacy saved ages", () => {
  const profile = { nickname: "별빛", gender: "여성", age: 27 };
  assert.equal(userProfileSchema.safeParse(profile).success, true);
  assert.equal(userProfileSchema.safeParse({nickname:"별빛",gender:"여성"}).success,true);
  for (const invalid of [{ ...profile, nickname: " " }, { ...profile, nickname: "x".repeat(33) }, { ...profile, age: 0 }, { ...profile, age: 121 }, { ...profile, age: 25.5 }, { ...profile, userId: "someone-else" }, { ...profile, admin: true }]) assert.equal(userProfileSchema.safeParse(invalid).success, false);
});
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333";

test("purchased prose uses the buyer nickname and adjusts Korean particles at name boundaries", () => {
  const original = "햄군은 현아와 걸었다. “햄군아, 햄군에게도 말했어?” 햄군상점 옆에 작은햄군이 있었다.";
  assert.equal(personalizeNovelText(original, "햄군", "하루"), "하루는 현아와 걸었다. “하루야, 하루에게도 말했어?” 햄군상점 옆에 작은햄군이 있었다.");
  assert.equal(personalizeNovelText("하루가 하루로 소개했다. 이름은 하루예요.", "하루", "별빛"), "별빛이 별빛으로 소개했다. 이름은 별빛이에요.");
  assert.equal(personalizeNovelText("하루로", "하루", "하늘"), "하늘로");
  assert.equal(personalizeNovelText("A.B와 AxB", "A.B", "별빛"), "별빛과 AxB");
  assert.equal(personalizeNovelText(original, "햄군", "햄군"), original);
});

test("novels publish every chapter atomically from a saved complete work and trusted final generation", () => {
  const sessions = createStudioSessions();
  const archive = Array.from({ length: 5 }, (_, index) => [{ role: "user", content: "비공개 지시" }, { role: "assistant", content: `회차 ${index + 1}의 원고`, readerNickname: index === 0 ? "햄군" : index === 1 ? null : undefined }]).flat();
  const state = { ...emptyStoryState(), chapter: 5, previousProse: archive.at(-1)!.content, nextChapterGoal: "" };
  const snapshot = snapshotSchema.parse({ version: 1, id: job, art: { title: "서하", summary: "", prompt: "비공개 프롬프트", style: "neutral", description: "서점", profile: { name: "서하", age: 25, personality: "다정함", concept: "서점" }, width: 72, height: 128, jobId: job },
    chat: { ...sessions.chat, committed: [{ role: "user", content: "비공개 대화" }] }, story: { ...sessions.story, documentId: B, lastJobId: job, archive, storyState: state }, timeline: sessions.chat.timeline.state });
  const finalEvent = { type: "chapter", text: state.previousProse, state };
  const options = { payload: snapshot, result: { events: [finalEvent, { type: "done" }] }, owner: A, documentId: B, title: "서점에서의 약속", description: "완결된 이야기" };
  const rows = novelListings(options);
  assert.equal(novelComplete(snapshot), true);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.content.chapter), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows.map(row => row.content.readerNickname), ["햄군", null, undefined, undefined, undefined]);
  assert.equal(rows[0].title, "서점에서의 약속 #1");
  assert.equal(rows[4].content.novel.chapters, 5);
  assert.equal(isPublishedNovel(rows[0].content.novel), true);
  assert.equal(isPublishedNovel(undefined), false);
  assert.equal(isPublishedNovel({ id: B, title: "미완결", chapters: 3 }), true);
  assert.equal(rows[0].id, listingId(A, B, 1));
  assert.notEqual(rows[0].id, listingId(B, B, 1));
  assert.ok(!JSON.stringify(rows).includes("비공개"));
  assert.deepEqual(novelListings(options), rows);
  for(const chapter of [1,3]){
    const partialArchive=archive.slice(0,chapter*2);
    const partialState={...state,chapter,previousProse:partialArchive.at(-1)!.content,nextChapterGoal:"다음 회차"};
    const partialSnapshot={...snapshot,story:{...snapshot.story,archive:partialArchive,storyState:partialState}};
    const partialRows=novelListings({...options,payload:partialSnapshot,result:{events:[{type:"chapter",text:partialState.previousProse,state:partialState}]}});
    assert.equal(partialRows.length,chapter);assert.equal(partialRows[0].content.novel.complete,false);
    assert.equal(isPublishedNovel(partialRows[0].content.novel),true);
    const added=unpublishedNovelRows(rows,partialRows);
    assert.deepEqual(added.map(row=>row.content.chapter),Array.from({length:5-chapter},(_,index)=>chapter+index+1));
    assert.equal(unpublishedNovelRows(partialRows,partialRows).length,0);
    assert.throws(()=>unpublishedNovelRows([{...partialRows[0],content:{...partialRows[0].content,text:"바꾼 원고"}}],partialRows),/원고는 변경/);
  }
  // An edited client completion flag cannot substitute for the server's result.
  assert.throws(() => novelListings({ ...options, result: { events: [{ ...finalEvent, state: { ...state, nextChapterGoal: "다음 사건" } }] } }), /생성이 확인된 회차/);
  assert.throws(() => novelListings({ ...options, result: { events: [] } }), /생성이 확인된 회차/);
  assert.throws(() => novelListings({ ...options, payload: { ...snapshot, story: { ...snapshot.story, archive: archive.slice(2) } } }), /생성이 확인된 회차/);
  assert.throws(() => novelListings({ ...options, result: { events: [{ ...finalEvent, text: "다른 원고" }] } }), /생성이 확인된 회차/);
  assert.equal(sessionSnapshotForTest(snapshot).lastJobId, job);
  const novels = libraryNovels([{ id: A, kind: "studio", title: "캐릭터", chapter: "5", novel_id: B }, { id: B, kind: "chapter", title: "소설", chapter: "5" }]);
  assert.deepEqual(novels.map(doc => doc.id), [B]);
});

function sessionSnapshotForTest(snapshot: ReturnType<typeof snapshotSchema.parse>) {
  return restoreSessions(snapshot).story;
}
test("cloud snapshot restores full completed history while keeping model context compact and timeline shared", () => {
  const sessions = createStudioSessions();
  const archive = ["one", "two", "three"].flatMap(content => [{role:"user",content},{role:"assistant",content:`reply-${content}`}]);
  const editedChapter = { role: "assistant", content: "편집한 원고", styleDraft: "집필한 초고" };
  const snapshot = snapshotSchema.parse({ version:1,id:job,
    art:{title:"서하",summary:"",prompt:"",style:"neutral",description:"서점",profile:{name:"서하",age:25,personality:"다정함",concept:"서점의 친구"},width:72,height:128,jobId:job},
    chat:{...sessions.chat,committed:archive.slice(-2),archive},story:{...sessions.story,storyPage:1,archive:[editedChapter]},timeline:sessions.chat.timeline.state });
  const restored=restoreSessions(snapshot);
  assert.equal(restored.story.storyPage,1);
  assert.deepEqual(restored.story.messages, [{ role: "assistant", content: editedChapter.content }]);
  assert.equal(restored.chat.messages.length,6); assert.equal(restored.chat.committed.length,2);
  assert.equal(restored.chat.timeline,restored.story.timeline);
  restored.chat.timeline.state.revision++; assert.equal(restored.story.timeline.state.revision,1);
});
test("SQL ledger atomically handles signup, daily grants, reservations, refunds, payments and store entitlements", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql as $$ select '${A}'::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await db.exec(await readFile(new URL("../supabase/migrations/202611170001_accounts.sql", import.meta.url), "utf8"));
    await db.query("insert into auth.users(id) values($1),($2)", [A,B]);
    const wallet = async (id = A) => (await db.query<{ transferable: number; bonus: number; free_chats: number }>("select transferable,bonus,free_chats from wallets where user_id=$1", [id])).rows[0];
    assert.equal((await wallet()).free_chats, 5);
    await db.query("select claim_daily($1)", [A]); const afterDaily = await wallet();
    await db.query("select claim_daily($1)", [A]); assert.deepEqual(await wallet(), afterDaily);
    await db.query("select reserve_generation($1,$2,'chat','fingerprint')", [A,job]);
    assert.equal((await wallet()).free_chats,4);
    const claim1=await db.query("update generation_jobs set result='{\"processing\":\"worker-1\"}'::jsonb where id=$1 and user_id=$2 and status='reserved' and result is null returning id",[job,A]);
    const claim2=await db.query("update generation_jobs set result='{\"processing\":\"worker-2\"}'::jsonb where id=$1 and user_id=$2 and status='reserved' and result is null returning id",[job,A]);
    assert.equal(claim1.rows.length,1);assert.equal(claim2.rows.length,0);
    const duplicate = await db.query<{ result: { fresh?: boolean } }>("select reserve_generation($1,$2,'chat','fingerprint') as result", [A,job]);
    assert.equal(duplicate.rows[0].result.fresh, undefined); assert.equal((await wallet()).free_chats,4);
    await db.query("select finish_generation($1,$2,null,null,false)",[A,job]);
    await db.query("select finish_generation($1,$2,null,null,false)",[A,job]); assert.equal((await wallet()).free_chats,5);
    await assert.rejects(db.query("select reserve_generation($1,gen_random_uuid(),'character','x')",[A]), /insufficient_hearts/);
    await db.query("select grant_purchase($1,'token-a','hearts_100','order-a')",[A]);
    await db.query("select grant_purchase($1,'token-a','hearts_100','order-a')",[A]); assert.equal((await wallet()).transferable,100);
    await assert.rejects(db.query("select grant_purchase($1,'token-a','hearts_100','order-a')",[B]),/invalid_purchase/);
    for(let i=0;i<5;i++) await db.query("select grant_ad_reward($1,$2)",[A,`ad-${i}`]);
    await assert.rejects(db.query("select grant_ad_reward($1,'ad-six')",[A]),/reward_limit/);
    await db.query("select grant_ad_reward($1,'ad-0')",[A]); assert.equal((await wallet()).bonus,afterDaily.bonus+25);
    const listing = (await db.query<{id:string}>("insert into store_listings(seller_id,kind,title,description,content) values($1,'character','character','','{}') returning id",[B])).rows[0].id;
    await db.query("select buy_listing($1,gen_random_uuid(),$2)",[A,listing]);
    assert.equal((await wallet()).transferable,65); assert.equal((await wallet(B)).transferable,25);
    await db.query("select buy_listing($1,gen_random_uuid(),$2)",[A,listing]); assert.equal((await wallet()).transferable,65);
    await db.query("select grant_purchase($1,'pass-token','heart_pass_30','pass-order')",[A]);
    await assert.rejects(db.query("select grant_purchase($1,'pass-again','heart_pass_30','pass-order2')",[A]),/pass_active/);
    await db.query("select claim_daily($1)",[A]); assert.equal((await wallet()).transferable,175);
    await db.query("select claim_daily($1)",[A]); assert.equal((await wallet()).transferable,175);
    const functions = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.grant_purchase(uuid,text,text,text)','execute') allowed");
    assert.equal(functions.rows[0].allowed,false);
    const reserved = "44444444-4444-4444-8444-444444444444";
    await db.query("select reserve_generation($1,$2,'character','y')",[A,reserved]); const charged = await wallet();
    await db.query("select finish_generation($1,$2,'{\"headers\":{}}'::jsonb,'image.jpg',true)",[A,reserved]);
    await db.query("select finish_generation($1,$2,null,null,false)",[A,reserved]); assert.deepEqual(await wallet(),charged);
  } finally { await db.close(); }
});
test("mobile origins are explicitly allowed and preserve streaming headers; enabled accounts fail closed", async () => {
  const old = process.env.MOBILE_ALLOWED_ORIGINS; const enabled = process.env.ACCOUNT_FEATURES_ENABLED;
  try {
    process.env.MOBILE_ALLOWED_ORIGINS = "https://localhost";
    const request = new Request("https://example.com/api/chat", { method:"POST", headers:{origin:"https://localhost"} });
    assert.equal(allowedOrigin(request),true);
    assert.equal(allowedOrigin(new Request(request.url,{headers:{origin:"https://attacker.test"}})),false);
    assert.equal(corsHeaders(request)["Access-Control-Allow-Origin"],"https://localhost");
    process.env.ACCOUNT_FEATURES_ENABLED = "false";
    const response = await withGeneration(async () => new Response("data: {}\n\n", {headers:{"Cache-Control":"no-store, no-transform"}}))(request);
    assert.match(response.headers.get("Cache-Control")!, /no-transform/);
    process.env.ACCOUNT_FEATURES_ENABLED = "true";
    const blocked = await withGeneration(async () => { throw new Error("must not run"); })(request);
    assert.equal(blocked.status,401);
  } finally { if(old===undefined) delete process.env.MOBILE_ALLOWED_ORIGINS; else process.env.MOBILE_ALLOWED_ORIGINS=old; if(enabled===undefined) delete process.env.ACCOUNT_FEATURES_ENABLED; else process.env.ACCOUNT_FEATURES_ENABLED=enabled; }
});
test("generation wrapper persists before completion, replays without another model call and refunds failures", async () => {
  const originalFetch = globalThis.fetch;
  const env = { ACCOUNT_FEATURES_ENABLED: process.env.ACCOUNT_FEATURES_ENABLED, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  let modelCalls = 0; let persisted: { events: { type: string }[] } | undefined; let refunded = false;
  const claimed = new Set<string>();
  try {
    Object.assign(process.env, { ACCOUNT_FEATURES_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "unit-test-service-key" });
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return Response.json({ id: A, aud: "authenticated", role: "authenticated", email: "test@example.test" });
      if (url.includes("/rpc/reserve_generation")) {
        const body = JSON.parse(String(init?.body));
        return Response.json({ id: body.p_id, status: persisted && body.p_id===job ? "completed" : "reserved", result: persisted, storage_path: null });
      }
      if (url.includes("/rest/v1/generation_jobs") && init?.method === "PATCH") {
        assert.equal(new URL(url).searchParams.get("result"),"is.null");
        assert.equal(new URL(url).searchParams.get("user_id"),`eq.${A}`);
        assert.equal(new URL(url).searchParams.get("status"),"eq.reserved");
        const id = new URL(url).searchParams.get("id")!;
        if (claimed.has(id)) return Response.json([]);
        claimed.add(id); return Response.json([{id:id.slice(3)}]);
      }
      if (url.includes("/rpc/finish_generation")) {
        const body = JSON.parse(String(init?.body));
        if (body.p_success) persisted = body.p_result; else refunded = true;
        return Response.json(null);
      }
      throw new Error("Unexpected external request");
    };
    const request = (id=job) => new Request("https://app.example/api/chat",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer test-token","X-Request-Id":id},body:'{"messages":[{"role":"user","content":"hello"}]}' });
    const generate = withGeneration(async () => {
      modelCalls++; return new Response('data: {"type":"delta","text":"hello"}\n\ndata: {"type":"done"}\n\n',{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-store, no-transform"}});
    });
    const first = await generate(request());
    assert.equal(first.status,200); const received = await first.text();
    assert.match(received,/"type":"done"/); assert.equal(persisted?.events.at(-1)?.type,"done");
    const replay = await generate(request()); assert.equal(await replay.text(),received); assert.equal(modelCalls,1);
    const fail = await withGeneration(async () => Response.json({error:"upstream"},{status:502}))(request("55555555-5555-4555-8555-555555555555"));
    assert.equal(fail.status,502); assert.equal(refunded,true);
  } finally {
    globalThis.fetch = originalFetch;
    for(const [key,value] of Object.entries(env)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
  }
});
test("concurrent retries claim one worker without refunding its active reservation",async()=>{
  const originalFetch=globalThis.fetch;
  const names=["ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
  const env=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  let claimed=false, calls=0, settlements=0;
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
  try{
    Object.assign(process.env,{ACCOUNT_FEATURES_ENABLED:"true",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
    globalThis.fetch=async(input,init)=>{
      const url=String(input);
      if(url.includes("/auth/v1/user"))return Response.json({id:A,aud:"authenticated",role:"authenticated"});
      if(url.includes("/rpc/reserve_generation"))return Response.json({id:job,status:"reserved",result:claimed?{processing:"another-worker"}:null,storage_path:null});
      if(url.includes("/rest/v1/generation_jobs")&&init?.method==="PATCH"){
        if(claimed)return Response.json([]);claimed=true;return Response.json([{id:job}]);
      }
      if(url.includes("/rpc/finish_generation")){settlements++;assert.equal(JSON.parse(String(init?.body)).p_success,true);return Response.json(null);}
      throw new Error("Unexpected request");
    };
    const request=()=>new Request("https://app.example/api/chat",{method:"POST",headers:{Authorization:"Bearer test-token","X-Request-Id":job},body:'{"messages":[{"role":"user","content":"hello"}]}' });
    const generate=withGeneration(async()=>{calls++;started();await pending;return new Response('data: {"type":"delta","text":"hello"}\n\ndata: {"type":"done"}\n\n');});
    const first=generate(request());await running;
    const second=await generate(request());assert.equal(second.status,409);assert.equal(calls,1);assert.equal(settlements,0);
    release();const response=await first;assert.match(await response.text(),/"done"/);assert.equal(settlements,1);
  }finally{release();globalThis.fetch=originalFetch;for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test("AdMob grants only a correctly signed allowed reward, never a tampered callback", async () => {
  const originalFetch = globalThis.fetch; const names=["ADMOB_REWARDS_ENABLED","ADMOB_REWARDED_UNIT_ID","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
  const env=Object.fromEntries(names.map(name=>[name,process.env[name]])); let grants=0;
  try {
    Object.assign(process.env,{ADMOB_REWARDS_ENABLED:"true",ADMOB_REWARDED_UNIT_ID:"unit-123",NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
    const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    globalThis.fetch=async(input)=>{
      if(String(input).includes("verifier-keys.json")) return Response.json({keys:[{keyId:123,pem:pair.publicKey.export({type:"spki",format:"pem"})}]});
      if(String(input).includes("/rpc/grant_ad_reward")){grants++;return Response.json(true);}
      throw new Error("Unexpected external request");
    };
    const raw=`ad_unit=unit-123&reward_amount=5&timestamp=${Date.now()}&transaction_id=transaction-a&user_id=${A}`;
    const signature=sign("SHA256",Buffer.from(raw),pair.privateKey).toString("base64url");
    const url=`https://app.example/api/ads/ssv?${raw}&signature=${signature}&key_id=123`;
    assert.equal(await verifyAdmob(new URL(url)),true);assert.equal(grants,1);
    await assert.rejects(verifyAdmob(new URL(url.replace("reward_amount=5","reward_amount=50"))),/서명/);
    await assert.rejects(verifyAdmob(new URL(url+"&reward_amount=5")),/잘못된/);assert.equal(grants,1);
  }finally{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test("Play validation rejects pending/foreign-account purchases and grants before consuming",async()=>{
  const originalFetch=globalThis.fetch;
  const names=["GOOGLE_PLAY_BILLING_ENABLED","GOOGLE_PLAY_PACKAGE_NAME","GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL","GOOGLE_PLAY_PRIVATE_KEY","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
  const env=Object.fromEntries(names.map(name=>[name,process.env[name]]));const calls:string[]=[];let state=0;let account=playAccountId(A);let productId="hearts_100";let grantedProduct="";
  try{
    const pair=generateKeyPairSync("rsa",{modulusLength:2048});
    Object.assign(process.env,{GOOGLE_PLAY_BILLING_ENABLED:"true",GOOGLE_PLAY_PACKAGE_NAME:"com.oestewdio.maite",GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL:"unit@example.test",GOOGLE_PLAY_PRIVATE_KEY:pair.privateKey.export({type:"pkcs8",format:"pem"}),NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-key"});
    globalThis.fetch=async(input,init)=>{
      const url=String(input);
      if(url.includes("oauth2.googleapis.com"))return Response.json({access_token:"test-google-token"});
      if(url.endsWith(":consume")){calls.push("consume");return new Response(null,{status:204});}
      if(url.includes("androidpublisher.googleapis.com")){
        assert.ok(url.includes(`/products/${productId}/`));
        return Response.json({purchaseState:state,quantity:1,obfuscatedExternalAccountId:account,productId,consumptionState:0,orderId:"order-a"});
      }
      if(url.includes("/rpc/grant_purchase")){calls.push("grant");grantedProduct=JSON.parse(String(init?.body)).p_product;return Response.json(true);}
      if(url.includes("/rpc/claim_daily")){calls.push("daily");assert.equal(JSON.parse(String(init?.body)).p_user,A);return Response.json({claimed:15});}
      if(url.includes("/payment_purchases"))return Response.json([]);
      throw new Error(`Unexpected request method ${init?.method}`);
    };
    assert.deepEqual(await verifyPurchase(A,"hearts_100","purchase-token"),{granted:true,settled:true});
    assert.deepEqual(calls,["grant","consume"]);
    assert.equal(grantedProduct,"hearts_100");
    productId="hearts_700";
    assert.deepEqual(await verifyPurchase(A,"hearts_700","purchase-original-700"),{granted:true,settled:true});
    assert.equal(grantedProduct,"hearts_700");
    productId="heart_700";
    assert.deepEqual(await verifyPurchase(A,"heart_700","purchase-700"),{granted:true,settled:true});
    assert.equal(grantedProduct,"hearts_700");
    productId="hearts_100";
    productId="heart_pass_30";
    assert.deepEqual(await verifyPurchase(A,"heart_pass_30","purchase-pass"),{granted:true,settled:true});
    assert.deepEqual(calls.slice(-2),["grant","consume"]);
    productId="hearts_100";
    state=2;await assert.rejects(verifyPurchase(A,"hearts_100","pending"),/완료된 본인/);
    state=0;account=playAccountId(B);await assert.rejects(verifyPurchase(A,"hearts_100","foreign"),/완료된 본인/);
    assert.equal(calls.length,8);
  }finally{globalThis.fetch=originalFetch;for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
