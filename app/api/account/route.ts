import { z } from "zod";
import { AccountError, requireAccount, rpc } from "@/lib/server/account";
import { allowedOrigin, corsHeaders, preflight } from "@/lib/server/http";
export const runtime = "nodejs";
export const OPTIONS = preflight;
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("daily") }).strict(),
  z.object({ action: z.literal("save"), id: z.uuid(), ownerId: z.uuid(), title: z.string().trim().min(1).max(120), kind: z.enum(["character", "chapter", "studio"]), payload: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("report"), reason: z.string().trim().min(1).max(2000), jobId: z.uuid().optional(), listingId: z.uuid().optional() }).strict(),
]);
export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    await rpc("expire_generations", { p_user: user.id });
    const url = new URL(request.url); const jobId = url.searchParams.get("job"); const docId = url.searchParams.get("document");
    if (jobId) {
      const { data, error } = await db.from("generation_jobs").select("id,kind,status,result,storage_path,created_at").eq("id", z.uuid().parse(jobId)).eq("user_id", user.id).single();
      if (error || !data) throw new AccountError("작업을 찾지 못했습니다.", 404);
      let imageUrl: string | undefined;
      if (data.storage_path) { const signed = await db.storage.from("maite-private").createSignedUrl(data.storage_path, 300); imageUrl = signed.data?.signedUrl; }
      return Response.json({ ...data, imageUrl }, { headers });
    }
    if (docId) {
      const { data, error } = await db.from("documents").select("*").eq("id", z.uuid().parse(docId)).eq("user_id", user.id).single();
      if (error || !data) throw new AccountError("저장 내용을 찾지 못했습니다.", 404);
      return Response.json(data, { headers });
    }
    const results = await Promise.all([
      db.from("wallets").select("transferable,bonus,free_chats").eq("user_id", user.id).single(),
      db.from("profiles").select("display_name").eq("id", user.id).single(),
      db.from("documents").select("id,title,kind,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
      db.from("generation_jobs").select("id,kind,status,created_at,spent_transferable,spent_bonus,spent_free").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
      db.from("heart_passes").select("starts_on,ends_on").eq("user_id", user.id).maybeSingle(),
      db.from("heart_ledger").select("reference,transferable,bonus,free_chats,reason,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    ]);
    if (results.some(result => result.error)) throw new AccountError("계정 정보를 불러오지 못했습니다. DB 마이그레이션을 확인해주세요.", 503);
    return Response.json({ userId: user.id, email: user.email, wallet: results[0].data, profile: results[1].data, documents: results[2].data, jobs: results[3].data, pass: results[4].data, ledger: results[5].data,
      billingEnabled: process.env.GOOGLE_PLAY_BILLING_ENABLED === "true", adsEnabled: process.env.ADMOB_REWARDS_ENABLED === "true" }, { headers });
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
    if (input.action === "daily") return Response.json(await rpc("claim_daily", { p_user: user.id }), { headers });
    if (input.action === "save") {
      if (input.ownerId !== user.id) throw new AccountError("계정이 변경되었습니다. 저장 내용을 다시 확인해주세요.", 409);
      const existing = await db.from("documents").select("user_id").eq("id", input.id).maybeSingle();
      if (existing.error || (existing.data && existing.data.user_id !== user.id)) throw new AccountError("저장할 수 없습니다.", 403);
      // On conflict never update ownership: use explicit owner-constrained UPDATE.
      const record = { title: input.title, kind: input.kind, payload: input.payload, updated_at: new Date().toISOString() };
      const result = existing.data ? await db.from("documents").update(record).eq("id", input.id).eq("user_id", user.id) : await db.from("documents").insert({ id: input.id, user_id: user.id, ...record });
      if (result.error) throw new AccountError("저장하지 못했습니다.", 503);
    } else if (input.action === "delete") {
      const { error } = await db.from("documents").delete().eq("id", input.id).eq("user_id", user.id);
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
