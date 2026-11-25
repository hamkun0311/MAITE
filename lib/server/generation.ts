import { createHash, randomUUID } from "node:crypto";
import { AccountError, requireAccount, rpc } from "./account.ts";
import { allowedOrigin, corsHeaders, preflight } from "./http.ts";
import type { GenerationKind } from "../account/policy.ts";
import type { UsageRecord } from "../usage.ts";
import sharp from "sharp";
import { thumbnailPath, uploadThumbnail } from "./image-assets.ts";
import { storyStateSchema } from "../novel/state.ts";
import {createNovelReviewLogger,manuscriptFingerprint} from "../novel/review-log.ts";
import {blocksImageGeneration, blocksTextGeneration, GENERATION_POLICY_MESSAGE} from "../generation-policy.ts";
import { MIN_STORY_CHARS, storyChars, type StoryDraftStore } from "../novel/checkpoint.ts";
import { claimStoryDraft } from "./story-drafts.ts";
import { claimImageCheckpoint, imageAttempt, imageFingerprint, loadCompletedImageJob } from "./image-checkpoints.ts";

type Job = { id: string; status: "reserved" | "completed" | "failed"; result: { events?: object[]; headers?: Record<string, string> } | null; storage_path: string | null };
function completeOutput(kind: GenerationKind, events: object[]) {
  const data = events as { type?: string; text?: unknown; state?: unknown }[];
  if (!data.some(event => event.type === "done") || data.some(event => event.type === "error")) return false;
  if (kind !== "story") return data.some(event => event.type === "delta" && typeof event.text === "string" && event.text.trim());
  return data.some(event => {
    if (event.type !== "chapter" || typeof event.text !== "string") return false;
    const length = storyChars(event.text);
    if (length < MIN_STORY_CHARS) return false;
    const parsed = storyStateSchema.safeParse(event.state);
    return parsed.success && parsed.data.previousProse === event.text;
  });
}
export { preflight };
// A successful completion is persisted BEFORE its done event/JPEG reaches the client.
export function withGeneration(handler: (request: Request, draftStore?: StoryDraftStore, owner?: string) => Promise<Response>, image = false) {
  return async (request: Request): Promise<Response> => {
    const cors = corsHeaders(request);
    const jsonError = (message: string, status: number) => Response.json({ error: message }, { status, headers: cors });
    if (!allowedOrigin(request)) return jsonError("허용되지 않은 요청입니다.", 403);
    if (process.env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED === "true" && process.env.ACCOUNT_FEATURES_ENABLED !== "true") return jsonError("서버와 앱의 계정 기능 설정을 확인해주세요.", 503);
    if (process.env.ACCOUNT_FEATURES_ENABLED !== "true") {
      const response = await handler(request);
      Object.entries(cors).forEach(([k, v]) => { if (k !== "Cache-Control" || !response.headers.has(k)) response.headers.set(k, v); });
      return response;
    }
    let settle: ((result: unknown, path?: string, success?: boolean) => Promise<unknown>) | undefined;
    let owned = false;
    let draft: Awaited<ReturnType<typeof claimStoryDraft>> | undefined;
    let imageDraft: Awaited<ReturnType<typeof claimImageCheckpoint>>;
    let imageJob: Awaited<ReturnType<typeof loadCompletedImageJob>> | undefined;
    let imageRetry: string | null = null;
    let imageUsage: UsageRecord[] = [];
    let discardUnsettledImage: (() => Promise<void>) | undefined;
    try {
      const { db, user } = await requireAccount(request);
      let id = request.headers.get("X-Request-Id") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return jsonError("작업 ID를 확인해주세요.", 400);
      const max = image ? 2_700_000 : 100000;
      const reader = request.body?.getReader();
      if (!reader) return jsonError("요청 내용이 없습니다.", 400);
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > max) { await reader.cancel(); return jsonError("요청이 너무 큽니다.", 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks);
      const forwarded = new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
      let kind: GenerationKind;
      let fingerprint: string;
      let resumableStory = false;
      if (image) {
        const form = await forwarded.clone().formData();
        const scene = form.has("scene") ? JSON.parse(String(form.get("scene"))) : undefined;
        const profile = form.has("profile") ? JSON.parse(String(form.get("profile"))) : undefined;
        const messages = JSON.parse(String(form.get("messages") ?? "null"));
        kind = scene?.kind === "illustration" ? "illustration" : scene?.kind === "outfit" ? "outfit" : "character";
        // Retain the existing billing hash for job compatibility, and version checkpoint hashes separately.
        const hash = createHash("sha256");
        for (const [key, value] of [...form.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          hash.update(key).update("\0");
          hash.update(typeof value === "string" ? value : Buffer.from(await value.arrayBuffer())); hash.update("\0");
        }
        fingerprint = hash.digest("hex");
        const attempt = imageAttempt(request);
        if (blocksImageGeneration({scene, profile, messages})) return jsonError(GENERATION_POLICY_MESSAGE, 422);
        if (attempt) {
          const inputHash = await imageFingerprint(form);
          imageDraft = await claimImageCheckpoint(db, user.id, `${kind}:${attempt.scope}`, inputHash, attempt.attempt);
          if (!imageDraft) imageJob = await loadCompletedImageJob(db, user.id, kind, attempt.scope, inputHash, attempt.attempt);
        }
      } else {
        const data = JSON.parse(body.toString("utf8")); kind = data.character?.mode === "story" ? "story" : "chat";
        resumableStory = kind === "story" && typeof data.storyDocumentId === "string";
        if (blocksTextGeneration(data)) return jsonError(GENERATION_POLICY_MESSAGE, 422);
        fingerprint = createHash("sha256").update(body).digest("hex");
      }
      const headers = { ...cors, "X-Job-Id": id };
      if (imageJob?.data?.storage_path) {
        const { data, error } = await db.storage.from("maite-private").download(imageJob.data.storage_path);
        if (error || !data) throw new AccountError("저장된 이미지를 불러오지 못했습니다.", 503);
        return new Response(data, { headers: { ...imageJob.data.headers, ...headers, "X-Job-Id": imageJob.data.id, "Content-Type": "image/jpeg" } });
      }
      const priorImage = imageDraft?.rendered;
      let resumeReservedImage = false;
      if (priorImage) {
        const previous = await db.from("generation_jobs").select("id,status,storage_path").eq("id", priorImage.jobId).eq("user_id", user.id).eq("kind", kind).maybeSingle();
        if (previous.error) throw new AccountError("이전 이미지 저장 상태를 확인하지 못했습니다.", 503);
        if (previous.data?.status === "completed" && previous.data.storage_path) {
          const { data, error } = await db.storage.from("maite-private").download(previous.data.storage_path);
          if (error || !data) throw new AccountError("저장된 이미지를 불러오지 못했습니다.", 503);
          return new Response(data, { headers: { ...priorImage.headers, ...headers, "X-Job-Id": previous.data.id, "Content-Type": "image/jpeg" } });
        }
        if (previous.data?.status === "reserved" && priorImage.bytes) {
          resumeReservedImage = true;
          id = previous.data.id;
          headers["X-Job-Id"] = id;
        }
      }
      if (resumableStory) {
        draft = await claimStoryDraft(db, user.id, fingerprint);
        const previous = await db.from("generation_jobs").select("id,result")
          .eq("user_id", user.id).eq("fingerprint", fingerprint).eq("kind", "story").eq("status", "completed")
          .order("completed_at", { ascending: false }).limit(1).maybeSingle();
        if (previous.error) throw new AccountError("이전 이야기 작업을 확인하지 못했습니다.", 503);
        if (previous.data) {
          await draft.release();
          return new Response(previous.data.result?.events?.map((event: object) => `data: ${JSON.stringify(event)}\n\n`).join("") ?? "", {
            headers: { ...headers, "X-Job-Id": previous.data.id, "Content-Type": "text/event-stream; charset=utf-8" },
          });
        }
      }
      const job = resumeReservedImage ? undefined : await rpc<Job>("reserve_generation_v2", { p_user: user.id, p_id: id, p_kind: kind, p_fingerprint: fingerprint });
      if (job?.status === "completed") {
        await draft?.release();
        if (job.storage_path) {
          const { data, error } = await db.storage.from("maite-private").download(job.storage_path);
          if (error || !data) throw new AccountError("저장된 이미지를 불러오지 못했습니다.", 503);
          return new Response(data, { headers: { ...job.result?.headers, ...headers, "Content-Type": "image/jpeg" } });
        }
        return new Response(job.result?.events?.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") ?? "", { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8" } });
      }
      if (job?.status === "failed") { await draft?.release(); return jsonError("이 작업은 종료되었습니다. 새 작업으로 다시 시도해주세요.", 409); }
      // Claim the reserved row atomically. reserve_generation returns the row,
      // without a 'fresh' flag; only one worker may move its null result to a claim.
      if (!resumeReservedImage) {
        const claim = await db.from("generation_jobs").update({ result: { processing: randomUUID() } })
          .eq("id", id).eq("user_id", user.id).eq("status", "reserved").is("result", null).select("id").maybeSingle();
        if (claim.error) throw new AccountError("작업 시작 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.", 503);
        if (!claim.data) { await draft?.release(); return jsonError("같은 작업을 처리 중입니다. 잠시 기다려주세요.", 409); }
      }
      owned = true;
      settle = (result, path, success = true) => rpc("finish_generation", { p_user: user.id, p_id: id,
        p_result: imageJob && success ? { ...(result as object), imageCheckpoint: imageJob.marker } : result, p_storage: path ?? null, p_success: success });
      const response = priorImage?.bytes
        ? new Response(new Uint8Array(Buffer.from(priorImage.bytes, "base64")), { headers: { ...priorImage.headers, "Content-Type": "image/jpeg" } })
        : await handler(forwarded, draft?.store, image ? user.id : undefined);
      imageRetry = response.headers.get("X-Image-Retry");
      try { imageUsage = JSON.parse(response.headers.get("X-Token-Usage") ?? "[]"); } catch { /* Optional provider metrics. */ }
      Object.entries(headers).forEach(([k, v]) => { if (k !== "Cache-Control" || !response.headers.has(k)) response.headers.set(k, v); });
      if (!response.ok) { await settle({ usage: imageUsage }, undefined, false); await draft?.release(); return response; }
      if (image) {
        const blob = await response.blob(); const path = `${user.id}/${id}.jpg`;
        if (request.signal.aborted && !imageDraft) throw new AccountError("생성을 취소했습니다.", 499);
        if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || !blob.size || blob.size > 5_000_000) throw new AccountError("완성된 이미지를 받지 못했습니다.", 502);
        const bytes = Buffer.from(await blob.arrayBuffer()); const metadata = await sharp(bytes).metadata();
        if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000) throw new AccountError("이미지 형식을 확인하지 못했습니다.", 502);
        await sharp(bytes, { failOn: "error" }).stats();
        const resultHeaders = Object.fromEntries([...response.headers].filter(([key]) => key.startsWith("x-character-")));
        await imageDraft?.save({ bytes: bytes.toString("base64"), headers: resultHeaders, jobId: id });
        if (request.signal.aborted) throw new AccountError("생성을 취소했습니다.", 499);
        if (imageDraft) discardUnsettledImage = async () => {
          const job = await db.from("generation_jobs").select("status").eq("id", id).eq("user_id", user.id).maybeSingle();
          if (job.data?.status === "failed") {
            const { error } = await db.storage.from("maite-private").remove([path, thumbnailPath(path)]);
            if (error) console.warn("image-checkpoint-cleanup-failed");
          }
        };
        const [{ error }] = await Promise.all([
          db.storage.from("maite-private").upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: resumeReservedImage }),
          uploadThumbnail(db, path, bytes).catch(() => console.warn("thumbnail-save-failed")),
        ]);
        if (error) throw new AccountError("이미지를 저장하지 못했습니다. 하트 예약은 취소됩니다.", 503);
        if (request.signal.aborted) throw new AccountError("생성을 취소했습니다.", 499);
        await settle({ headers: resultHeaders, usage: imageUsage }, path);
        if (resumeReservedImage) {
          const saved = await db.from("generation_jobs").select("status").eq("id", id).eq("user_id", user.id).maybeSingle();
          if (saved.error || saved.data?.status !== "completed") throw new AccountError("이미지 정산을 확인하지 못했습니다. 다시 시도해주세요.", 503);
        }
        await imageDraft?.save({ headers: resultHeaders, jobId: id });
        response.headers.delete("X-Image-Retry");
        return new Response(blob, { headers: response.headers });
      }
      if (!response.body) throw new AccountError("응답을 받지 못했습니다.", 502);
      const source = response.body.getReader();
      const decoder = new TextDecoder(); const encoder = new TextEncoder();
      let pending = ""; const events: object[] = []; let finished = false; let closed = false; let bytes = 0;
      const metrics = new Map<string, UsageRecord>();
      const refund = () => settle!({ usage: [...metrics.values()].map(record => record.status === "running" ? { ...record, status: "unknown" } : record) }, undefined, false);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (;;) {
              const { done, value } = await source.read(); if (done) break;
              pending += decoder.decode(value, { stream: true });
              let boundary: number;
              while ((boundary = pending.indexOf("\n\n")) >= 0) {
                const raw = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
                const data = raw.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
                if (!data) continue;
                const event = JSON.parse(data);
                if (event.type === "usage" && typeof event.record?.id === "string") metrics.set(event.record.id, event.record);
                if (!["usage", "phase", "draft_progress", "draft_live"].includes(event.type)) { bytes += data.length; if (bytes > 400000) throw new Error("Result too large"); events.push(event); }
                if (event.type === "done") {
                  if (request.signal.aborted || !completeOutput(kind, events)) throw new Error("Incomplete generation");
                  try{await settle!({ events, usage: [...metrics.values()] });}
                  catch(error){if(kind==="story")createNovelReviewLogger({traceId:id}).event("generation_persistence_failed",{storage:"generation_jobs"});throw error;}
                  finished = true;
                  if(kind==="story"){
                    const chapter=events.find(item=>{const event=item as {type?:string;text?:unknown;state?:{chapter?:unknown}};return event.type==="chapter"&&typeof event.text==="string"&&Number.isSafeInteger(event.state?.chapter);}) as {text:string;state:{chapter:number}}|undefined;
                    if(chapter)createNovelReviewLogger({traceId:id,chapter:chapter.state.chapter}).event("generation_persisted",{...manuscriptFingerprint(chapter.text),storage:"generation_jobs"});
                  }
                }
                if (!closed) controller.enqueue(encoder.encode(`${raw}\n\n`));
              }
            }
            if (!finished) await refund();
          } catch {
            await refund().catch(() => undefined);
            if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "응답 저장을 완료하지 못했습니다. 연결을 확인해주세요." })}\n\n`));
          } finally { await draft?.release(); source.releaseLock(); if (!closed) { closed = true; controller.close(); } }
        },
        async cancel() { closed = true; await source.cancel().catch(() => undefined); if (!finished) await refund().catch(() => undefined); },
      });
      return new Response(stream, { headers: response.headers });
    } catch (error) {
      if (owned) await settle?.(image ? { usage: imageUsage } : null, undefined, false).catch(() => undefined);
      await discardUnsettledImage?.().catch(() => console.warn("image-checkpoint-cleanup-failed"));
      await draft?.release();
      const failure = jsonError(error instanceof AccountError ? error.message : "작업을 시작하지 못했습니다.", error instanceof AccountError ? error.status : 400);
      if (imageRetry) failure.headers.set("X-Image-Retry", imageRetry);
      if (imageUsage.length) failure.headers.set("X-Token-Usage", JSON.stringify(imageUsage));
      return failure;
    } finally { await imageDraft?.release(); }
  };
}
