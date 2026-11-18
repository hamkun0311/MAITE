import { createHash } from "node:crypto";
import { z } from "zod";
import { AccountError } from "./account.ts";
import { snapshotSchema, type StudioSnapshot } from "../platform/snapshot.ts";
import { novelChapters, novelComplete } from "../account/library.ts";
import { storyStateSchema } from "../novel/state.ts";

export function isPublishedNovel(value: unknown) {
  return z.object({ id: z.uuid(), title: z.string().trim().min(1).max(100), chapters: z.number().int().min(1).max(100000) }).safeParse(value).success;
}

export function listingId(owner: string, document: string, chapter: number) {
  const hex = createHash("sha256").update(`${owner}:${document}:${chapter}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = "8";
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
export function novelListings(options: { payload: unknown; result: unknown; owner: string; documentId: string; title: string; description: string }) {
  const snapshot = snapshotSchema.parse(options.payload);
  const stored = z.object({ events: z.array(z.unknown()) }).parse(options.result);
  const chapters = novelChapters(snapshot);
  const chapterEvent = stored.events.find(event => !!event && typeof event === "object" && "type" in event && event.type === "chapter");
  const event = z.object({ type: z.literal("chapter"), text: z.string(), state: storyStateSchema }).safeParse(chapterEvent);
  if (!event.success || !chapters.length || chapters.length !== snapshot.story.storyState?.chapter ||
      snapshot.story.storyState.previousProse !== chapters.at(-1)?.text ||
      event.data.state.nextChapterGoal !== snapshot.story.storyState.nextChapterGoal ||
      event.data.state.chapter !== snapshot.story.storyState?.chapter ||
      (event.data.state.seriesStartChapter ?? 0) !== (snapshot.story.storyState?.seriesStartChapter ?? 0) ||
      event.data.text !== chapters.at(-1)?.text || event.data.state.previousProse !== event.data.text) {
    throw new AccountError("서버에서 생성이 확인된 회차만 판매할 수 있습니다. 최신 회차를 저장한 뒤 다시 시도해주세요.", 409);
  }
  // Publish public prose only. Private conversations, plans and memory never leave the library.
  return chapters.map(chapter => ({ id: listingId(options.owner, options.documentId, chapter.chapter), seller_id: options.owner,
    kind: "chapter", title: `${options.title} #${chapter.chapter}`, description: options.description, storage_path: null,
    content: { kind: "chapter", text: chapter.text, chapter: chapter.chapter, novel: { id: options.documentId, title: options.title, chapters: chapters.length, complete: novelComplete(snapshot) } } }));
}
export function unpublishedNovelRows<T extends {id:string;content:Record<string,unknown>}>(rows:T[],existing:{id:string;content:Record<string,unknown>}[]) {
  const published=new Map(existing.map(row=>[row.id,row]));
  for(const row of rows){const prior=published.get(row.id);if(prior&&prior.content.text!==row.content.text)throw new AccountError("이미 판매 등록한 회차의 원고는 변경할 수 없습니다.",409);}
  return rows.filter(row=>!published.has(row.id));
}
export function parseLibrarySnapshot(payload: unknown): StudioSnapshot { return snapshotSchema.parse(payload); }
