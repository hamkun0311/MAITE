import { createHash } from "node:crypto";
import { z } from "zod";
import { AccountError } from "./account.ts";
import { snapshotSchema, type StudioSnapshot } from "../platform/snapshot.ts";
import { novelChapters, novelComplete } from "../account/library.ts";
import { storyStateSchema } from "../novel/state.ts";

export function isPublishedNovel(value: unknown) {
  return z.object({ id: z.uuid(), title: z.string().trim().min(1).max(100), chapters: z.number().int().min(5).max(100000) }).safeParse(value).success;
}

export function listingId(owner: string, document: string, chapter: number) {
  const hex = createHash("sha256").update(`${owner}:${document}:${chapter}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = "8";
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
export function completedNovelListings(options: { payload: unknown; result: unknown; owner: string; documentId: string; title: string; description: string }) {
  const snapshot = snapshotSchema.parse(options.payload);
  const stored = z.object({ events: z.array(z.unknown()) }).parse(options.result);
  const chapters = novelChapters(snapshot);
  const finalEvent = stored.events.find(event => !!event && typeof event === "object" && "type" in event && event.type === "chapter");
  const event = z.object({ type: z.literal("chapter"), text: z.string(), state: storyStateSchema }).safeParse(finalEvent);
  if (!event.success || !novelComplete(snapshot) || event.data.state.nextChapterGoal !== "" ||
      event.data.state.chapter !== snapshot.story.storyState?.chapter ||
      (event.data.state.seriesStartChapter ?? 0) !== (snapshot.story.storyState?.seriesStartChapter ?? 0) ||
      event.data.text !== chapters.at(-1)?.text || event.data.state.previousProse !== event.data.text) {
    throw new AccountError("서버에서 완결이 확인된 소설만 판매할 수 있습니다. 모든 회차가 저장되어 있는지 확인해주세요.", 409);
  }
  // Publish public prose only. Private conversations, plans and memory never leave the library.
  return chapters.map(chapter => ({ id: listingId(options.owner, options.documentId, chapter.chapter), seller_id: options.owner,
    kind: "chapter", title: `${options.title} #${chapter.chapter}`, description: options.description, storage_path: null,
    content: { kind: "chapter", text: chapter.text, chapter: chapter.chapter, novel: { id: options.documentId, title: options.title, chapters: chapters.length } } }));
}
export function parseLibrarySnapshot(payload: unknown): StudioSnapshot { return snapshotSchema.parse(payload); }
