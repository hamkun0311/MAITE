import {test} from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {createClient} from "@supabase/supabase-js";
import {ImageBlobCache} from "../lib/platform/image-cache.ts";
import {SignedImageCache,thumbnailBytes,thumbnailPath} from "../lib/server/image-assets.ts";

test("generated images are reused without a download and remain account scoped", async()=>{
 const cache=new ImageBlobCache();const blob=new Blob(["generated"],{type:"image/jpeg"});let calls=0;
 const fetcher=(async()=>{calls++;return new Response(blob);}) as typeof fetch;
 cache.put("a","job:1:original",blob);
 assert.equal(await cache.get("a","job:1:original","https://img/one",fetcher),blob);assert.equal(calls,0);
 await cache.get("b","job:1:original","https://img/one",fetcher);assert.equal(calls,1);
 cache.put("a","invalid",new Blob(["not an image"]));
 assert.equal(cache.sizeBytes,blob.size*2);
});

test("an image is fetched once across changing signed URLs but is isolated by account and variant", async()=>{
 const cache=new ImageBlobCache();let calls=0;
 const fetcher=(async()=>{calls++;return new Response(new Blob(["image"],{type:"image/jpeg"}));}) as typeof fetch;
 const [a,b]=await Promise.all([cache.get("a","job:1:original","https://img/one",fetcher),cache.get("a","job:1:original","https://img/two",fetcher)]);
 assert.equal(calls,1);assert.equal(a,b);
 await cache.get("a","job:1:original","https://img/three",fetcher);assert.equal(calls,1);
 await cache.get("b","job:1:original","https://img/one",fetcher);await cache.get("a","job:1:thumbnail","https://img/thumb",fetcher);assert.equal(calls,3);
 cache.clear();assert.equal(cache.sizeBytes,0);await cache.get("a","job:1:original","https://img/new",fetcher);assert.equal(calls,4);
});

test("image cache evicts to its byte limit and failed responses can be retried",async()=>{
 const cache=new ImageBlobCache(6);let calls=0;
 const fetcher=(async()=>{calls++;return new Response(new Blob(["12345"],{type:"image/webp"}));}) as typeof fetch;
 await cache.get("a","one","https://img/one",fetcher);await cache.get("a","two","https://img/two",fetcher);assert.equal(cache.sizeBytes,5);
 await cache.get("a","one","https://img/one",fetcher);assert.equal(calls,3);
 await assert.rejects(cache.get("a","bad","https://img/bad",(async()=>new Response("bad",{status:403})) as typeof fetch));
 await cache.get("a","bad","https://img/recovered",fetcher);assert.equal(calls,4);
});

test("an image download completing after logout cannot refill the cache",async()=>{
 const cache=new ImageBlobCache();let release!:(response:Response)=>void;
 const old=cache.get("a","image","https://img/old",(()=>new Promise<Response>(resolve=>{release=resolve;})) as typeof fetch);
 await Promise.resolve();cache.clear();release(new Response(new Blob(["old"],{type:"image/jpeg"})));await old;assert.equal(cache.sizeBytes,0);
});

test("an expired signed URL renews once before the original is cached",async()=>{
 const cache=new ImageBlobCache();let reads=0,renewals=0;
 const fetcher=(async(input)=>{reads++;return String(input).endsWith("old")?new Response("expired",{status:403}):new Response(new Blob(["original"],{type:"image/jpeg"}));}) as typeof fetch;
 const renew=async()=>{renewals++;return "https://img/new";};
 await cache.get("a","job:original","https://img/old",fetcher,renew);
 await cache.get("a","job:original","https://img/old",fetcher,renew);
 assert.equal(reads,2);assert.equal(renewals,1);
});

test("signed URLs are reused only within their checked user and renew before expiration",async t=>{
 let now=1000,calls=0;t.mock.method(Date,"now",()=>now);const cache=new SignedImageCache();
 const db=createClient("https://example.supabase.co","mock",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(_,init)=>{
  calls++;const {paths}=JSON.parse(String(init?.body));return Response.json(paths.map((path:string)=>({path,signedURL:`/object/sign/maite-private/${path}?token=${calls}`})));
 }}});
 const first=await cache.get(db,"a",["a/image.jpg"]);now+=60000;
 assert.equal((await cache.get(db,"a",["a/image.jpg"])).get("a/image.jpg"),first.get("a/image.jpg"));assert.equal(calls,1);
 await cache.get(db,"b",["a/image.jpg"]);assert.equal(calls,2);now+=240000;
 assert.notEqual((await cache.get(db,"a",["a/image.jpg"])).get("a/image.jpg"),first.get("a/image.jpg"));assert.equal(calls,3);
});

test("thumbnails keep aspect ratio and leave original image bytes unchanged",async()=>{
 const original=await sharp({create:{width:720,height:1280,channels:3,background:"#bba1cc"}}).jpeg().toBuffer();const copy=Buffer.from(original);
 const thumb=await thumbnailBytes(original);const metadata=await sharp(thumb).metadata();
 assert.equal(metadata.format,"webp");assert.equal(metadata.width,256);assert.equal(metadata.height,455);assert.ok(thumb.length<original.length);assert.deepEqual(original,copy);
 assert.equal(thumbnailPath("owner/job.jpg"),"owner/job.thumb.webp");
});
