import {test} from "node:test";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
import {ReadCache} from "../lib/platform/read-cache.ts";
import {documentMedia} from "../lib/server/document-media.ts";
import {responseTimings} from "../lib/server/timing.ts";
import {listingCoverPaths,listingPreviews} from "../lib/server/listing-covers.ts";

test("store covers batch signing and verify the novel seller's image ownership before exposing a preview",async()=>{
 const seller="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",novel="33333333-3333-4333-8333-333333333333",job="44444444-4444-4444-8444-444444444444";
 let signs=0,foreign=false;
 const db=createClient("https://covers.test","mock-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname.includes("documents"))return Response.json([{id:novel,user_id:seller,art:{jobId:job}}]);
  if(url.pathname.includes("generation_jobs"))return Response.json([{id:job,user_id:foreign?other:seller,storage_path:"seller/cover.jpg"}]);
  if(url.pathname.includes("storage")){signs++;const paths=JSON.parse(String(init?.body)).paths;assert.deepEqual(paths,["seller/cover.jpg","seller/cover.thumb.webp"]);return Response.json(paths.map((path:string)=>({path,signedURL:`/object/sign/maite-private/${path}?token=preview` })));}
  throw new Error("Unexpected lookup");
 }}});
 const rows=[{id:"character",seller_id:seller,kind:"character",storage_path:"seller/cover.jpg"},{id:"chapter-one",seller_id:seller,kind:"chapter",novel:{id:novel}},{id:"chapter-two",seller_id:seller,kind:"chapter",novel:{id:novel}}];
 const previews=await listingPreviews(db,other,rows);assert.equal(signs,1);assert.match(previews.get("character")!,/cover.thumb.webp/);assert.equal(previews.get("chapter-one"),previews.get("chapter-two"));
 foreign=true;assert.equal((await listingCoverPaths(db,rows.slice(1))).size,0);
 assert.equal((await listingCoverPaths(db,[{...rows[1],seller_id:other}])).size,0);
});

test("concurrent scoped reads share one request and callers cannot mutate another caller's data", async () => {
  const cache = new ReadCache(); let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const load = async () => { calls++; await gate; return {title:"original"}; };
  const a = cache.get("account-a", "/document", load, 15000);
  const b = cache.get("account-a", "/document", load, 15000); release();
  const [first, second] = await Promise.all([a,b]); first.title = "changed";
  assert.equal(second.title, "original"); assert.equal(calls, 1);
  await cache.get("account-b", "/document", load, 15000); assert.equal(calls, 2);
});

test("invalidation prevents an older request from repopulating a cache after a write or logout", async () => {
  const cache = new ReadCache(); let release!: () => void;
  const old = cache.get("account", "/document", () => new Promise<string>(resolve => { release = () => resolve("old"); }), 15000);
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get("account", "/document", async () => "new", 15000), "new");
  release(); await old;
  assert.equal(await cache.get("account", "/document", async () => "wrong", 15000), "new");
});

test("expired, failed and uncached balance reads are fetched again", async t => {
  const cache = new ReadCache(); let now = 100; let calls = 0;
  t.mock.method(Date,"now",()=>now);
  const load = async () => ++calls;
  assert.equal(await cache.get("a","doc",load,10),1); now=111;
  assert.equal(await cache.get("a","doc",load,10),2);
  await cache.get("a","wallet",load); await cache.get("a","wallet",load); assert.equal(calls,4);
  await assert.rejects(cache.get("a","error",async()=>{throw new Error("network");},10));
  assert.equal(await cache.get("a","error",async()=>"recovered",10),"recovered");
});

test("document media batches signing once and never signs another user's job", async () => {
  const owner="11111111-1111-4111-8111-111111111111", job="22222222-2222-4222-8222-222222222222", foreign="33333333-3333-4333-8333-333333333333";
  let lookups=0,signs=0;
  const db=createClient("https://example.supabase.co","mock-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input,init)=>{
    const url=new URL(String(input));
    if(url.pathname.includes("generation_jobs")) {
      lookups++; assert.equal(url.searchParams.get("user_id"),`eq.${owner}`); assert.equal(url.searchParams.get("status"),"eq.completed");
      return Response.json([{id:job,storage_path:`${owner}/owned.jpg`}]);
    }
    signs++; const body=JSON.parse(String(init?.body)); assert.deepEqual(body.paths,[`${owner}/owned.jpg`,`${owner}/owned.thumb.webp`]);
    return Response.json(body.paths.map((path:string)=>({path,signedURL:`/object/sign/maite-private/${path}?token=mock`})));
  }}});
  const headers:Record<string,string>={};
  const result=await documentMedia(db,owner,{art:{jobId:job},gallery:[{id:"first",jobId:job},{id:"second",jobId:job},{id:"foreign",jobId:foreign}]},responseTimings(headers));
  assert.equal(lookups,1); assert.equal(signs,1);
  assert.ok(result.original?.includes("owned.jpg")); assert.equal(result.gallery[foreign],undefined);
  assert.equal(result.gallery[job],result.original); assert.match(headers["Server-Timing"],/storage_sign;dur=/);
});

test("a forged purchased-character reference does not produce a signed image without entitlement", async () => {
  const owner="11111111-1111-4111-8111-111111111111", listing="44444444-4444-4444-8444-444444444444"; let purchased=false;
  const db=createClient("https://example.supabase.co","mock-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input)=>{
    const url=new URL(String(input));
    if(url.pathname.includes("store_listings"))return Response.json({storage_path:"seller/private.jpg",seller_id:"someone-else"});
    if(url.pathname.includes("store_orders")) { assert.equal(url.searchParams.get("buyer_id"),`eq.${owner}`); return Response.json(purchased?[{id:listing}]:[]); }
    assert.equal(purchased,true); return Response.json([{path:"seller/private.jpg",signedURL:"/object/sign/maite-private/seller/private.jpg?token=mock"}]);
  }}});
  assert.equal((await documentMedia(db,owner,{art:{listingId:listing}},responseTimings({}))).original,undefined);
  purchased=true;
  assert.ok((await documentMedia(db,owner,{art:{listingId:listing}},responseTimings({}))).original?.includes("seller/private.jpg"));
});
