import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { AccountError, requireAccount } from "../../../../lib/server/account.ts";
import { allowedOrigin, corsHeaders, preflight } from "../../../../lib/server/http.ts";
import { userProfileSchema } from "../../../../lib/account/profile.ts";
import { signedImages } from "../../../../lib/server/image-assets.ts";

export const runtime = "nodejs";
export const OPTIONS = preflight;
export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const reader = request.body?.getReader();
    if (!reader) throw new AccountError("사진을 선택해주세요.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 6_000_000) { await reader.cancel(); throw new AccountError("사진은 5MB 이하로 선택해주세요.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const profile = userProfileSchema.parse(JSON.parse(String(form.get("profile"))));
    const photo = form.get("photo"); const remove = form.get("removePhoto") === "true";
    const previous = user.user_metadata?.maite_avatar_path;
    const owned = (path: unknown): path is string => typeof path === "string" && path.startsWith(`${user.id}/profile/`) && /^[-a-zA-Z0-9/_.]+$/.test(path);
    let path: string | undefined = owned(previous) ? previous : undefined;
    let uploaded: string | undefined;
    if (photo instanceof File) {
      if (!photo.size || photo.size > 5_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) throw new AccountError("JPG, PNG, WebP 사진을 5MB 이하로 선택해주세요.");
      let bytes: Buffer;
      try { bytes = await sharp(Buffer.from(await photo.arrayBuffer()), { limitInputPixels: 25_000_000 }).rotate().resize(512, 512, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer(); }
      catch { throw new AccountError("읽을 수 없는 사진입니다. 다른 사진을 선택해주세요."); }
      uploaded = `${user.id}/profile/${randomUUID()}.jpg`;
      const { error } = await db.storage.from("maite-private").upload(uploaded, bytes, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
      if (error) throw new AccountError("프로필 사진을 저장하지 못했습니다.", 503);
      path = uploaded;
    } else if (remove) path = undefined;
    try {
      const urls = path ? await signedImages.get(db, user.id, [path]) : undefined;
      const { error } = await db.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, maite_profile: profile, maite_avatar_path: path ?? null } });
      if (error) throw new AccountError("프로필을 저장하지 못했습니다.", 503);
      if (owned(previous) && previous !== path) await db.storage.from("maite-private").remove([previous]).catch(() => undefined);
      return Response.json({ ok: true, avatarUrl: path ? urls?.get(path) : null }, { headers });
    } catch (error) {
      if (uploaded) await db.storage.from("maite-private").remove([uploaded]).catch(() => undefined);
      throw error;
    }
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "프로필 입력과 사진을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
