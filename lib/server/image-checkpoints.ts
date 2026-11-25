import { createHash, randomUUID } from "node:crypto";
import { AccountError, type serviceDb } from "./account.ts";
import type { GenerationKind } from "../account/policy.ts";

type RenderedImage = { bytes?: string; headers: Record<string, string>; jobId: string };
const versionFingerprint = (fingerprint: string) => createHash("sha256").update(`image-checkpoint-v1:${fingerprint}`).digest("hex");

export async function imageFingerprint(form: FormData) {
  const hash = createHash("sha256");
  for (const [key, value] of [...form.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(await value.arrayBuffer());
    hash.update(JSON.stringify([key, typeof value === "string" ? "text" : value.type, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function imageAttempt(request: Request) {
  const attempt = request.headers.get("X-Image-Attempt");
  const scope = request.headers.get("X-Image-Scope") || "default";
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return attempt && uuid.test(attempt) && (scope === "default" || uuid.test(scope)) ? { attempt, scope } : undefined;
}

export async function claimImageCheckpoint(db: ReturnType<typeof serviceDb>, owner: string, scope: string, fingerprint: string, attempt: string) {
  const lease = randomUUID();
  const versioned = versionFingerprint(fingerprint);
  const { data, error } = await db.rpc("claim_image_checkpoint", { p_user: owner, p_scope: scope, p_fingerprint: versioned, p_attempt: attempt, p_lease: lease });
  if (error?.code === "PGRST202") return undefined;
  if (error) throw new AccountError("이미지 진행 기록을 불러오지 못했습니다. 다시 시도해주세요.", 503);
  if (!data) throw new AccountError("같은 이미지 작업을 처리 중입니다. 잠시 후 다시 시도해주세요.", 409);
  const scoped = (update: Record<string, unknown>) => db.from("image_generation_checkpoints").update(update).eq("user_id", owner).eq("scope", scope).eq("lease", lease);
  return {
    rendered: data.rendered as RenderedImage | undefined,
    async save(rendered: RenderedImage) {
      const { data, error } = await scoped({ payload: { rendered }, updated_at: new Date().toISOString() }).select("scope").maybeSingle();
      if (error || !data) console.warn("image-checkpoint-save-failed");
    },
    async release() {
      const { error } = await scoped({ lease: null, lease_until: null, updated_at: new Date().toISOString() });
      if (error) console.warn("image-checkpoint-release-failed");
    },
  };
}

/** Replay a successful job even when the optional rendered-image checkpoint is unavailable. */
export async function loadCompletedImageJob(db: ReturnType<typeof serviceDb>, owner: string, kind: GenerationKind, scope: string, fingerprint: string, attempt: string) {
  const marker = { scope, fingerprint: versionFingerprint(fingerprint), attempt };
  const { data, error } = await db.from("generation_jobs")
    .select("id,storage_path,headers:result->headers")
    .eq("user_id", owner).eq("kind", kind).eq("status", "completed").contains("result", { imageCheckpoint: marker })
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
    .overrideTypes<{id: string; storage_path: string | null; headers: Record<string, string> | null}, { merge: false }>();
  if (error) throw new AccountError("이전 이미지 작업을 확인하지 못했습니다. 다시 시도해주세요.", 503);
  return { data, marker };
}
