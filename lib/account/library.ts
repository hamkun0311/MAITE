import { storyComplete } from "../novel/series.ts";
import type { StudioSnapshot } from "../platform/snapshot.ts";

export type LibraryDocument = { id: string; title: string; kind: string; updated_at?: string; character_name?: string; job_id?: string; source_id?: string; chapter?: string; novel_id?: string; next_goal?: string; series_start?: string };
export type AccountData = {
  avatarUrl?: string | null;
  userId: string; email: string; profile?: { display_name: string; gender?: string; age?: number; onboarded?: boolean }; wallet: { transferable: number; bonus: number; free_chats: number };
  documents: LibraryDocument[]; jobs: { id: string; kind: string; status: string }[]; billingEnabled: boolean; adsEnabled: boolean;
};
export function novelChapters(snapshot: StudioSnapshot) {
  return (snapshot.story.archive ?? snapshot.story.committed).filter(message => message.role === "assistant" && message.content.trim())
    .map((message, index) => ({ chapter: index + 1, text: message.content, readerNickname: message.readerNickname }));
}
export function novelComplete(snapshot: StudioSnapshot) {
  const state = snapshot.story.storyState;
  const chapters = novelChapters(snapshot);
  return !!state && storyComplete(state) && state.nextChapterGoal === "" && chapters.length === state.chapter && chapters.at(-1)?.text === state.previousProse;
}
export function libraryNovels(documents: LibraryDocument[]) {
  const novels = documents.filter(doc => doc.kind === "chapter" && Number(doc.chapter) > 0);
  const savedIds = new Set(novels.map(doc => doc.id));
  return [...novels, ...documents.filter(doc => doc.kind === "studio" && Number(doc.chapter) > 0 && !savedIds.has(doc.novel_id ?? ""))];
}
