import {test} from "node:test";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
import {ReadCache} from "../lib/platform/read-cache.ts";
import {documentMedia} from "../lib/server/document-media.ts";
import {responseTimings} from "../lib/server/timing.ts";
import {listingCoverPaths,listingPreviews,selectedListingCover} from "../lib/server/listing-covers.ts";
import {listingImagePaths} from "../lib/server/listing-media.ts";

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

test("a sale cover must be a completed gallery image owned by the seller and stays separate from the character original", async () => {
 const seller="11111111-1111-4111-8111-111111111111",job="44444444-4444-4444-8444-444444444444";
 let reads=0,available=true;
 const db=createClient("https://covers.test","mock-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input)=>{
  reads++;
  const params=new URL(String(input)).searchParams;
  assert.equal(params.get("id"),`eq.${job}`);
  assert.equal(params.get("user_id"),`eq.${seller}`);
  assert.equal(params.get("status"),"eq.completed");
  assert.equal(params.get("kind"),"eq.illustration");
  return Response.json(available ? [{storage_path:"seller/gallery.jpg"}] : []);
 }}});
 const gallery=[{jobId:job,kind:"illustration"}];
 await assert.rejects(selectedListingCover(db,seller,[],job),/갤러리/);
 assert.equal(reads,0);
 const cover=await selectedListingCover(db,seller,gallery,job);
 const listing={id:"character",seller_id:seller,kind:"character",storage_path:"seller/original.jpg",cover_path:cover};
 assert.equal((await listingCoverPaths(db,[listing])).get(listing.id),"seller/gallery.jpg");
 assert.equal(listing.storage_path,"seller/original.jpg");
 available=false;
 await assert.rejects(selectedListingCover(db,seller,gallery,job),/선택한 표지/);
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
  const seller="55555555-5555-4555-8555-555555555555", outfit="66666666-6666-4666-8666-666666666666";
  const newer="77777777-7777-4777-8777-777777777777", buyerJob="88888888-8888-4888-8888-888888888888";
  const publishedAt="2026-11-25T02:09:53.158437+00:00";
  const db=createClient("https://example.supabase.co","mock-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input)=>{
    const url=new URL(String(input));
    if(url.pathname.includes("store_listings"))return Response.json({id:listing,kind:"character",storage_path:"seller/private.jpg",seller_id:seller,created_at:publishedAt,content:{gallery:[outfit,newer].map(jobId=>({jobId,kind:"outfit",title:"대화 장면"}))}});
    if(url.pathname.includes("store_orders")) { assert.equal(url.searchParams.get("buyer_id"),`eq.${owner}`); return Response.json(purchased?[{id:listing}]:[]); }
    assert.equal(purchased,true);
    if(url.pathname.includes("generation_jobs")) {
      if (url.searchParams.get("user_id") === `eq.${owner}`) return Response.json([{id:buyerJob,storage_path:"buyer/own.jpg"}]);
      assert.equal(url.searchParams.get("user_id"), `eq.${seller}`);
      assert.equal(url.searchParams.get("id"), `in.(${outfit},${newer})`);
      assert.equal(url.searchParams.get("or"), `(completed_at.lte.${publishedAt},and(completed_at.is.null,created_at.lte.${publishedAt}))`);
      return Response.json([{id:outfit,kind:"outfit",storage_path:"seller/outfit.jpg"}]);
    }
    return Response.json(["seller/private.jpg","seller/private.thumb.webp","buyer/own.jpg","buyer/own.thumb.webp","seller/outfit.jpg","seller/outfit.thumb.webp"]
      .map(path => ({path,signedURL:`/object/sign/maite-private/${path}?token=mock`})));
  }}});
  assert.equal((await documentMedia(db,owner,{art:{listingId:listing}},responseTimings({}))).original,undefined);
  purchased=true;
  const media = await documentMedia(db,owner,{art:{listingId:listing},gallery:[
    {id:`purchased-${newer}`,jobId:newer},{id:`illustration-${buyerJob}`,jobId:buyerJob},
  ]},responseTimings({}));
  assert.ok(media.original?.includes("seller/private.jpg"));
  assert.equal(media.purchasedGallery?.[0]?.jobId, outfit);
  assert.ok(media.gallery[outfit]?.includes("seller/outfit.jpg"));
  assert.deepEqual(media.excludedPurchasedIds,[`purchased-${newer}`]);
  assert.ok(media.gallery[buyerJob]?.includes("buyer/own.jpg"));
});

test("legacy chapter listings include the novel's linked and detached illustrations", async () => {
  const seller = "11111111-1111-4111-8111-111111111111";
  const novel = "22222222-2222-4222-8222-222222222222";
  const studio = "33333333-3333-4333-8333-333333333333";
  const job = "44444444-4444-4444-8444-444444444444";
  const unrelated = "55555555-5555-4555-8555-555555555555";
  const detached = "66666666-6666-4666-8666-666666666666";
  const publishedAt = "2026-11-25T04:31:52.480366+00:00";
  const db = createClient("https://example.supabase.co", "mock-service-key", { auth: { persistSession: false }, global: { fetch: async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("user_id"), `eq.${seller}`);
    if (url.pathname.includes("documents") && url.searchParams.get("id") === `eq.${novel}`)
      return Response.json([{id: novel, source: studio, gallery: []}]);
    if (url.pathname.includes("documents")) return Response.json([{gallery:[
      {jobId:job,kind:"illustration",title:"구매한 회차",scene:{novelId:novel,chapter:2}},
      {jobId:unrelated,kind:"illustration",title:"다른 소설",scene:{novelId:seller,chapter:3}},
      {jobId:detached,kind:"illustration",title:"연결을 해제한 삽화"},
    ]}]);
    if (url.pathname.includes("story_rewind_backups")) {
      assert.equal(url.searchParams.get("novel_id"), `eq.${novel}`);
      return Response.json([{gallery:[{jobId:detached,kind:"illustration",title:"이전 회차",scene:{novelId:novel,chapter:6}}]}]);
    }
    assert.equal(url.searchParams.get("id"), `in.(${job},${detached})`);
    assert.equal(url.searchParams.get("or"), `(completed_at.lte.${publishedAt},and(completed_at.is.null,created_at.lte.${publishedAt}))`);
    return Response.json([{id:job,kind:"illustration",storage_path:"seller/chapter.jpg"},{id:detached,kind:"illustration",storage_path:"seller/detached.jpg"}]);
  } } });
  const result = await listingImagePaths(db, {id:novel,seller_id:seller,kind:"chapter",created_at:publishedAt,content:{novel:{id:novel},chapter:2}});
  assert.deepEqual(result.map(image => image.jobId), [job, detached]);
  assert.equal(result[1]?.scene, undefined);
});
