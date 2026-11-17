import { z } from "zod";

export const STORY_CHAPTER_LIMIT = 5;
const goal = z.string().trim().min(1).max(160);
const arcSchema = (limit: number) => z.object({
  endingPromise: goal,
  installments: z.array(z.object({
    chapter: z.number().int().min(1).max(limit),
    goal, payoff: goal,
  }).strict()).length(limit),
}).strict().refine(arc => arc.installments.every((part, index) => part.chapter === index + 1), "Outline chapters must be consecutive from 1");
export const seriesArcSchema = arcSchema(STORY_CHAPTER_LIMIT);
// Read existing saved stories; the generator replaces legacy future plans only.
export const storedSeriesArcSchema = z.union([seriesArcSchema, arcSchema(10)]);
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
    phase: chapter === 1 ? "setup" : chapter === 2 ? "escalation" : chapter === 3 ? "convergence" : chapter === 4 ? "climax" : "finale",
    direction: chapter === 1
      ? "Establish the central conflict, stakes, character goals and groundwork for the user-required ending. Do not resolve the whole novel yet."
      : chapter === 2
      ? "Escalate through consequential choices and emotional developments. Pay off earlier threads; every new subplot must be resolvable by chapter 5."
      : chapter === 3
      ? "Converge existing threads toward the planned ending. Reveal decisive information, reduce unresolved conflicts, and stop adding independent subplots."
      : chapter === 4
      ? "Deliver the central confrontation or irreversible climactic choice and establish its consequences. Pay off emotional and causal groundwork; clues only if the concept calls for investigation. Prepare the central relationship's final outcome. No new villains or unrelated mysteries."
      : "THIS IS THE FINAL CHAPTER. Resolve the central conflict and long-term goal on the page. Show the protagonist's lasting outcome, the central relationship's resolution and consequences. Pay off important open threads. End with a complete closing scene and emotional payoff. No cliffhanger, new mystery, sequel hook, 'to be continued', promise of a next chapter or newly introduced central threat.",
  };
}
