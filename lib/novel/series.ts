import { z } from "zod";

export const STORY_CHAPTER_LIMIT = 10;
const goal = z.string().trim().min(1).max(160);
export const seriesArcSchema = z.object({
  endingPromise: goal,
  installments: z.array(z.object({
    chapter: z.number().int().min(1).max(STORY_CHAPTER_LIMIT),
    goal, payoff: goal,
  }).strict()).length(STORY_CHAPTER_LIMIT),
}).strict().refine(arc => arc.installments.every((part, index) => part.chapter === index + 1), "Outline chapters must be ordered 1–10");
export type SeriesArc = z.infer<typeof seriesArcSchema>;

export function storyProgress(state?: { chapter: number; seriesStartChapter?: number }) {
  return Math.max(0, (state?.chapter ?? 0) - (state?.seriesStartChapter ?? 0));
}

export function storyComplete(state?: { chapter: number; seriesStartChapter?: number }) {
  return storyProgress(state) >= STORY_CHAPTER_LIMIT;
}

export function seriesSchedule(chapter: number) {
  return {
    chapter, totalChapters: STORY_CHAPTER_LIMIT, remainingAfterThis: STORY_CHAPTER_LIMIT - chapter,
    phase: chapter <= 2 ? "setup" : chapter <= 5 ? "escalation" : chapter <= 7 ? "convergence" : chapter === 8 ? "climax" : chapter === 9 ? "resolution_setup" : "finale",
    direction: chapter <= 2
      ? "Establish the central conflict, stakes, character goals and clues to a concrete ending. Do not resolve the whole novel yet."
      : chapter <= 5
      ? "Escalate through consequential choices and earned revelations. Pay off earlier threads; every new subplot must be resolvable by chapter 10."
      : chapter <= 7
      ? "Converge existing threads toward the planned ending. Reveal decisive information, reduce unresolved conflicts, and stop adding independent subplots."
      : chapter === 8
      ? "Deliver the central confrontation or irreversible climactic choice. Pay off planted clues. No new villains or unrelated mysteries."
      : chapter === 9
      ? "Settle the decisive conflict and establish its consequences. Prepare the protagonist's final choice and the central relationship's outcome. Do not postpone the climax into a new arc."
      : "THIS IS THE FINAL CHAPTER. Resolve the central conflict and long-term goal on the page. Show the protagonist's lasting outcome, the central relationship's resolution and consequences. Pay off important open threads. End with a complete closing scene and emotional payoff. No cliffhanger, new mystery, sequel hook, 'to be continued', promise of a next chapter or newly introduced central threat.",
  };
}
