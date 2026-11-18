import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POST } from "../app/api/account/profile/route.ts";

test("profile photos require auth, reject corrupt images, normalize uploads and clean up failed saves", async () => {
 const originalFetch = globalThis.fetch;
 const keys = ["ACCOUNT_FEATURES_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
 const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
 const id = "11111111-1111-4111-8111-111111111111";
 let uploads = 0, deletions = 0, failSave = false; let metadata: any = { unrelated: "keep" }; let stored: Buffer | undefined;
 const request = (photo?: Buffer, authenticated = true, remove = false) => {
   const body = new FormData(); body.set("profile", JSON.stringify({ nickname: "별빛", gender: "여성", age: 27 }));
   if (photo) body.set("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "photo.png");
   if (remove) body.set("removePhoto", "true");
   return new Request("https://app.test/api/account/profile", { method: "POST", headers: authenticated ? { Authorization: "Bearer test" } : {}, body });
 };
 try {
  Object.assign(process.env, { ACCOUNT_FEATURES_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "test-key" });
  globalThis.fetch = async (input, init) => {
   const url = String(input);
   if (url.includes("/auth/v1/user")) return Response.json({ id, user_metadata: metadata });
   if (url.includes("/auth/v1/admin/users/")) {
    if (failSave) return Response.json({ message: "failed" }, { status: 503 });
    metadata = JSON.parse(String(init?.body)).user_metadata; return Response.json({ id, user_metadata: metadata });
   }
   if (url.includes("/object/sign/")) {
    const { paths } = JSON.parse(String(init?.body)); return Response.json(paths.map((path: string) => ({ path, signedURL: `/signed/${path}` })));
   }
   if (init?.method === "DELETE") { deletions++; return Response.json([]); }
   if (url.includes("/storage/v1/object/")) { uploads++; stored = Buffer.from(init?.body as Uint8Array); return Response.json({ Key: "ok" }); }
   throw new Error(`Unexpected request: ${url}`);
  };
  assert.equal((await POST(request(undefined, false))).status, 401); assert.equal(uploads, 0);
  assert.equal((await POST(request(Buffer.from("invalid")))).status, 400); assert.equal(uploads, 0);
  const photo = await sharp({ create: { width: 80, height: 120, channels: 3, background: "red" } }).png().toBuffer();
  assert.equal((await POST(request(photo))).status, 200); assert.equal(uploads, 1);
  const normalized = await sharp(stored!).metadata(); assert.equal(normalized.width, 512); assert.equal(normalized.height, 512); assert.equal(normalized.format, "jpeg");
  assert.equal(metadata.unrelated, "keep"); assert.ok(metadata.maite_avatar_path.startsWith(`${id}/profile/`));
  const savedPath = metadata.maite_avatar_path;
  failSave = true; assert.equal((await POST(request(photo))).status, 503); assert.equal(metadata.maite_avatar_path, savedPath); assert.equal(deletions, 1);
  failSave = false; assert.equal((await POST(request(undefined, true, true))).status, 200); assert.equal(metadata.maite_avatar_path, null); assert.equal(deletions, 2);
 } finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
 }
});
