import { createHash, randomUUID } from "node:crypto";
import { AccountError, requireAccount, rpc } from "./account.ts";
import { allowedOrigin, corsHeaders, preflight } from "./http.ts";
import type { GenerationKind } from "../account/policy.ts";
import type { UsageRecord } from "../usage.ts";
import sharp from "sharp";
import { uploadThumbnail } from "./image-assets.ts";
import { storyStateSchema } from "../novel/state.ts";
import {createNovelReviewLogger,manuscriptFingerprint} from "../novel/review-log.ts";

type Job = { id: string; status: "reserved" | "completed" | "failed"; result: { events?: object[]; headers?: Record<string, string> } | null; storage_path: string | null };
function completeOutput(kind: GenerationKind, events: object[]) {
  const data = events as { type?: string; text?: unknown; state?: unknown }[];
  if (!data.some(event => event.type === "done") || data.some(event => event.type === "error")) return false;
  if (kind !== "story") return data.some(event => event.type === "delta" && typeof event.text === "string" && event.text.trim());
  return data.some(event => { const parsed = storyStateSchema.safeParse(event.state); return event.type === "chapter" && typeof event.text === "string" && event.text.trim() && parsed.success && parsed.data.previousProse === event.text; });
}
export { preflight };
// A successful completion is persisted BEFORE its done event/JPEG reaches the client.
export function withGeneration(handler: (request: Request) => Promise<Response>, image = false) {
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
    try {
      const { db, user } = await requireAccount(request);
      const id = request.headers.get("X-Request-Id") ?? "";
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
      if (image) {
        const form = await forwarded.clone().formData();
        const scene = form.has("scene") ? JSON.parse(String(form.get("scene"))) : undefined;
        kind = scene?.kind === "illustration" ? "illustration" : scene?.kind === "outfit" ? "outfit" : "character";
        // Multipart boundaries change on retry; hash sorted values + actual file bytes.
        const hash = createHash("sha256");
        for (const [key, value] of [...form.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          hash.update(key).update("\0");
          hash.update(typeof value === "string" ? value : Buffer.from(await value.arrayBuffer())); hash.update("\0");
        }
        fingerprint = hash.digest("hex");
      } else {
        const data = JSON.parse(body.toString("utf8")); kind = data.character?.mode === "story" ? "story" : "chat";
        fingerprint = createHash("sha256").update(body).digest("hex");
      }
      const job = await rpc<Job>("reserve_generation_v2", { p_user: user.id, p_id: id, p_kind: kind, p_fingerprint: fingerprint });
      const headers = { ...cors, "X-Job-Id": id };
      if (job.status === "completed") {
        if (job.storage_path) {
          const { data, error } = await db.storage.from("maite-private").download(job.storage_path);
          if (error || !data) throw new AccountError("저장된 이미지를 불러오지 못했습니다.", 503);
          return new Response(data, { headers: { ...job.result?.headers, ...headers, "Content-Type": "image/jpeg" } });
        }
        return new Response(job.result?.events?.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") ?? "", { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8" } });
      }
      if (job.status === "failed") return jsonError("이 작업은 종료되었습니다. 새 작업으로 다시 시도해주세요.", 409);
      // Claim the reserved row atomically. reserve_generation returns the row,
      // without a 'fresh' flag; only one worker may move its null result to a claim.
      const claimId = randomUUID();
      const claim = await db.from("generation_jobs").update({ result: { processing: claimId } })
        .eq("id", id).eq("user_id", user.id).eq("status", "reserved").is("result", null).select("id").maybeSingle();
      if (claim.error) throw new AccountError("작업 시작 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.", 503);
      if (!claim.data) return jsonError("같은 작업을 처리 중입니다. 잠시 기다려주세요.", 409);
      owned = true;
      settle = (result, path, success = true) => rpc("finish_generation", { p_user: user.id, p_id: id, p_result: result, p_storage: path ?? null, p_success: success });
      const response = await handler(forwarded);
      let imageUsage: UsageRecord[] = [];
      try { imageUsage = JSON.parse(response.headers.get("X-Token-Usage") ?? "[]"); } catch { /* Optional provider metrics. */ }
      Object.entries(headers).forEach(([k, v]) => { if (k !== "Cache-Control" || !response.headers.has(k)) response.headers.set(k, v); });
      if (!response.ok) { await settle({ usage: imageUsage }, undefined, false); return response; }
      if (image) {
        const blob = await response.blob(); const path = `${user.id}/${id}.jpg`;
        if (request.signal.aborted) throw new AccountError("생성을 취소했습니다.", 499);
        if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || !blob.size || blob.size > 5_000_000) throw new AccountError("완성된 이미지를 받지 못했습니다.", 502);
        const bytes = Buffer.from(await blob.arrayBuffer()); const metadata = await sharp(bytes).metadata();
        if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000) throw new AccountError("이미지 형식을 확인하지 못했습니다.", 502);
        await sharp(bytes, { failOn: "error" }).stats();
        const [{ error }] = await Promise.all([
          db.storage.from("maite-private").upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: false }),
          uploadThumbnail(db, path, bytes).catch(() => console.warn("thumbnail-save-failed")),
        ]);
        if (error) throw new AccountError("이미지를 저장하지 못했습니다. 하트 예약은 취소됩니다.", 503);
        if (request.signal.aborted) throw new AccountError("생성을 취소했습니다.", 499);
        await settle({ headers: Object.fromEntries([...response.headers].filter(([key]) => key.startsWith("x-character-"))), usage: imageUsage }, path);
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
                if (event.type !== "usage" && event.type !== "phase") { bytes += data.length; if (bytes > 400000) throw new Error("Result too large"); events.push(event); }
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
          } finally { source.releaseLock(); if (!closed) { closed = true; controller.close(); } }
        },
        async cancel() { closed = true; await source.cancel().catch(() => undefined); if (!finished) await refund().catch(() => undefined); },
      });
      return new Response(stream, { headers: response.headers });
    } catch (error) {
      if (owned) await settle?.(null, undefined, false).catch(() => undefined);
      return jsonError(error instanceof AccountError ? error.message : "작업을 시작하지 못했습니다.", error instanceof AccountError ? error.status : 400);
    }
  };
}
