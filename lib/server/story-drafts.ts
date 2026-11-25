import { randomUUID } from "node:crypto";
import { AccountError, type serviceDb } from "./account.ts";
import type { StoryCheckpoint, StoryDraftStore } from "../novel/checkpoint.ts";

export async function claimStoryDraft(db: ReturnType<typeof serviceDb>, owner: string, fingerprint: string) {
  const lease = randomUUID();
  const { data, error } = await db.rpc("claim_story_draft", { p_user: owner, p_fingerprint: fingerprint, p_lease: lease });
  if (error) throw new AccountError("이야기 임시 저장을 시작하지 못했습니다. 서버 설정을 확인해주세요.", 503);
  if (!data) throw new AccountError("같은 회차를 작성 중입니다. 잠시 후 다시 시도해주세요.", 409);
  const store: StoryDraftStore = {
    load: data,
    async save(payload) {
      const { data, error } = await db.from("story_draft_checkpoints")
        .update({ payload, updated_at: new Date().toISOString() })
        .eq("user_id", owner).eq("fingerprint", fingerprint).eq("lease", lease)
        .select("fingerprint").maybeSingle();
      if (error || !data) throw new Error("Story draft checkpoint write failed");
    },
  };
  return {
    store,
    async release() {
      const { error } = await db.from("story_draft_checkpoints")
        .update({ lease: null, lease_until: null, updated_at: new Date().toISOString() })
        .eq("user_id", owner).eq("fingerprint", fingerprint).eq("lease", lease);
      if (error) console.warn("story-draft-release-failed");
    },
  };
}

const localDrafts = new Map<string, { active: boolean; updated: number; payload: StoryCheckpoint | object }>();
export function claimLocalStoryDraft(fingerprint: string) {
  const now = Date.now();
  for (const [key, value] of localDrafts) {
    if (!value.active && now - value.updated > 60 * 60 * 1000) localDrafts.delete(key);
  }
  const entry = localDrafts.get(fingerprint) ?? { active: false, updated: now, payload: {} };
  if (entry.active) throw new AccountError("같은 회차를 작성 중입니다. 잠시 후 다시 시도해주세요.", 409);
  if (!localDrafts.has(fingerprint) && localDrafts.size >= 100) throw new AccountError("임시 저장 공간이 사용 중입니다. 잠시 후 다시 시도해주세요.", 503);
  entry.active = true;
  localDrafts.set(fingerprint, entry);
  const store: StoryDraftStore = {
    load: entry.payload,
    async save(payload) { entry.payload = structuredClone(payload); entry.updated = Date.now(); },
  };
  return { store, release() { entry.active = false; entry.updated = Date.now(); } };
}
