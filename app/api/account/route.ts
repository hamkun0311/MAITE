import { z } from "zod";
import { AccountError, requireAccount, rpc } from "@/lib/server/account";
import { allowedOrigin, corsHeaders, preflight } from "@/lib/server/http";
import { userProfileSchema } from "@/lib/account/profile";
import { responseTimings } from "@/lib/server/timing";
import { documentMedia } from "@/lib/server/document-media";
import { signedImages, thumbnailPath } from "@/lib/server/image-assets";
import {logNovelDocumentSaved} from "@/lib/novel/review-log";
export const runtime = "nodejs";
export const OPTIONS = preflight;
const action = z.discriminatedUnion("action", [
  userProfileSchema.extend({ action: z.literal("profile") }),
  z.object({ action: z.literal("daily") }).strict(),
  z.object({ action: z.literal("save"), id: z.uuid(), ownerId: z.uuid(), title: z.string().trim().min(1).max(120), kind: z.enum(["character", "chapter", "studio"]), payload: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("deleteCharacter"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("rewindStory"), studioId: z.uuid(), novelId: z.uuid(), from: z.number().int().min(1).max(1000), lastJobId: z.uuid() }).strict(),
  z.object({ action: z.literal("report"), reason: z.string().trim().min(1).max(2000), jobId: z.uuid().optional(), listingId: z.uuid().optional() }).strict(),
]);
export async function GET(request: Request) {
  const headers = corsHeaders(request);
  const measure = responseTimings(headers);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await measure("auth", () => requireAccount(request));
    const url = new URL(request.url); const jobId = url.searchParams.get("job"); const docId = url.searchParams.get("document");
    if (url.searchParams.get("previews") === "1") {
      const { data, error } = await measure("images_db", () => db.from("generation_jobs").select("id,storage_path").eq("user_id", user.id).eq("kind", "character").eq("status", "completed").not("storage_path", "is", null).order("created_at", { ascending: false }).limit(200));
      if (error) throw new AccountError("캐릭터 이미지를 불러오지 못했습니다.", 503);
      const paths = (data ?? []).map(row => row.storage_path as string);
      const urls = await measure("storage_sign", () => signedImages.get(db, user.id, paths.flatMap(path => [path, thumbnailPath(path)])));
      return Response.json({ images: Object.fromEntries((data ?? []).flatMap(row => {
        const url = urls.get(thumbnailPath(row.storage_path)) || urls.get(row.storage_path); return url ? [[row.id, url]] : [];
      })) }, { headers });
    }
    if (jobId) {
      const { data, error } = await measure("job_db", () => db.from("generation_jobs").select("id,kind,status,result,storage_path,created_at").eq("id", z.uuid().parse(jobId)).eq("user_id", user.id).single());
      if (error || !data) throw new AccountError("작업을 찾지 못했습니다.", 404);
      const urls = data.storage_path ? await measure("storage_sign", () => signedImages.get(db, user.id, [data.storage_path, thumbnailPath(data.storage_path)])) : new Map<string, string | undefined>();
      return Response.json({ ...data, imageUrl: urls.get(data.storage_path), thumbnailUrl: urls.get(thumbnailPath(data.storage_path || "")) }, { headers });
    }
    if (docId) {
      const { data, error } = await measure("document_db", () => db.from("documents").select("*").eq("id", z.uuid().parse(docId)).eq("user_id", user.id).is("deleted_at", null).single());
      if (error || !data) throw new AccountError("저장 내용을 찾지 못했습니다.", 404);
      if (url.searchParams.get("media") === "1") {
        const { purchasedGallery, excludedPurchasedIds, ...media } = await documentMedia(db, user.id, data.payload, measure);
        const excluded = new Set(excludedPurchasedIds);
        const saved = Array.isArray(data.payload.gallery) ? data.payload.gallery : [];
        const payload = purchasedGallery?.length || excluded.size
          ? { ...data.payload,
            gallery: [...saved.filter((image: { id?: string }) => !excluded.has(image?.id ?? "")), ...(purchasedGallery ?? [])],
            backgrounds: Object.fromEntries(Object.entries(data.payload.backgrounds ?? {}).filter(([, id]) => typeof id !== "string" || !excluded.has(id))),
          } : data.payload;
        return Response.json({ ...data, payload, media }, { headers });
      }
      return Response.json(data, { headers });
    }
    await measure("expiry", () => rpc("expire_generations", { p_user: user.id }));
    const results = await measure("account_db", () => Promise.all([
      db.from("wallets").select("transferable,bonus,free_chats").eq("user_id", user.id).single(),
      db.from("profiles").select("display_name").eq("id", user.id).single(),
      db.from("documents").select("id,title,kind,updated_at,character_name:payload->art->profile->>name,job_id:payload->art->>jobId,source_id:payload->>id,chapter:payload->story->storyState->>chapter,novel_id:payload->story->>documentId,next_goal:payload->story->storyState->>nextChapterGoal,series_start:payload->story->storyState->>seriesStartChapter,series_ending:payload->story->storyState->seriesArc->>endingMode").eq("user_id", user.id).is("deleted_at", null).order("updated_at", { ascending: false }).limit(200),
    ]));
    if (results.some(result => result.error)) throw new AccountError("계정 정보를 불러오지 못했습니다. DB 마이그레이션을 확인해주세요.", 503);
    const savedProfile = userProfileSchema.safeParse(user.user_metadata?.maite_profile);
    const avatarPath = user.user_metadata?.maite_avatar_path;
    const avatarUrl = typeof avatarPath === "string" && avatarPath.startsWith(`${user.id}/profile/`) && /^[-a-zA-Z0-9/_.]+$/.test(avatarPath)
      ? (await signedImages.get(db, user.id, [avatarPath])).get(avatarPath) : undefined;
    return Response.json({ userId: user.id, email: user.email, wallet: results[0].data, profile: { ...results[1].data, onboarded: savedProfile.success, ...(savedProfile.success ? { display_name: savedProfile.data.nickname, gender: savedProfile.data.gender, age: savedProfile.data.age } : {}) }, documents: results[2].data, jobs: [],
      avatarUrl, billingEnabled: process.env.GOOGLE_PLAY_BILLING_ENABLED === "true", adsEnabled: process.env.ADMOB_REWARDS_ENABLED === "true" }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "요청을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    // Bound streamed input too (Content-Length is optional/untrusted).
    const reader = request.body?.getReader(); if (!reader) throw new AccountError("요청이 없습니다.");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 500000) { await reader.cancel(); throw new AccountError("저장 내용이 너무 큽니다.", 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    const input = action.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (input.action === "profile") {
      const { action: _action, ...profile } = input;
      const { error } = await db.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, maite_profile: profile } });
      if (error) throw new AccountError("프로필을 저장하지 못했습니다.", 503);
      return Response.json({ ok: true }, { headers });
    }
    if (input.action === "daily") return Response.json(await rpc("claim_daily", { p_user: user.id }), { headers });
    if (input.action === "rewindStory") {
      const { data, error } = await db.rpc("rewind_story", {
        p_user: user.id, p_studio: input.studioId, p_novel: input.novelId, p_from: input.from, p_job: input.lastJobId,
      });
      if (error) {
        const messages: Record<string, string> = {
          stale_story_snapshot: "저장된 이야기가 바뀌었습니다. 화면을 다시 열어주세요.",
          rewind_checkpoint_missing: "이전 회차의 이어쓰기 기록을 찾지 못했습니다.",
          rewind_chat_changed: "이 회차 이후 대화가 공통 시간선에 반영되어 되돌릴 수 없습니다.",
          rewind_in_progress: "진행 중인 대화나 이야기 생성이 끝난 뒤 다시 시도해주세요.",
          rewind_published: "다시 쓰려는 회차에 서점에 등록한 작품이 포함되어 있습니다.",
        };
        console.warn("story-rewind-failed", { code: error.code, reason: Object.hasOwn(messages, error.message) ? error.message : "rewind_failed" });
        throw new AccountError(error.code === "PGRST202" ? "회차 다시 쓰기 DB 업데이트가 필요합니다." : messages[error.message] ?? "이 회차를 되돌리지 못했습니다.", error.code === "PGRST202" ? 503 : 409);
      }
      return Response.json(data, { headers });
    }
    if (input.action === "save") {
      if (input.ownerId !== user.id) throw new AccountError("계정이 변경되었습니다. 저장 내용을 다시 확인해주세요.", 409);
      const existing = await db.from("documents").select("user_id,title,deleted_at").eq("id", input.id).maybeSingle();
      if (existing.error || (existing.data && existing.data.user_id !== user.id)) throw new AccountError("저장할 수 없습니다.", 403);
      if (existing.data?.deleted_at) throw new AccountError("삭제한 캐릭터나 작품은 다시 저장할 수 없습니다.", 409);
      if (input.kind === "chapter" && z.uuid().safeParse(input.payload.id).success) {
        const parent = await db.from("documents").select("deleted_at").eq("id", input.payload.id as string).eq("user_id", user.id).maybeSingle();
        if (parent.error) throw new AccountError("캐릭터 상태를 확인하지 못했습니다.", 503);
        if (parent.data?.deleted_at) throw new AccountError("삭제한 캐릭터의 이야기는 저장할 수 없습니다.", 409);
      }
      // On conflict never update ownership: use explicit owner-constrained UPDATE.
      const record = { title: input.kind === "chapter" && existing.data ? existing.data.title : input.title, kind: input.kind, payload: input.payload, updated_at: new Date().toISOString() };
      const result = existing.data ? await db.from("documents").update(record).eq("id", input.id).eq("user_id", user.id) : await db.from("documents").insert({ id: input.id, user_id: user.id, ...record });
      if (result.error?.message === "stale_story_snapshot") throw new AccountError("다른 화면에서 회차를 되돌렸습니다. 화면을 다시 열어주세요.", 409);
      if (result.error) throw new AccountError("저장하지 못했습니다.", 503);
      logNovelDocumentSaved(input.payload,input.id,input.kind);
    } else if (input.action === "deleteCharacter") {
      return Response.json(await rpc("delete_character", { p_user: user.id, p_document: input.id }), { headers });
    } else if (input.action === "delete") {
      const { error } = await db.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", input.id).eq("user_id", user.id);
      if (error) throw new AccountError("삭제하지 못했습니다.", 503);
    } else {
      if (input.jobId) {
        const { data } = await db.from("generation_jobs").select("id").eq("id", input.jobId).eq("user_id", user.id).single();
        if (!data) throw new AccountError("신고할 작업을 찾지 못했습니다.", 404);
      }
      const { error } = await db.from("content_reports").insert({ user_id: user.id, job_id: input.jobId, listing_id: input.listingId, reason: input.reason });
      if (error) throw new AccountError("신고를 접수하지 못했습니다.", 503);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "요청을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
