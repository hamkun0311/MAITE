import { z } from "zod";

export const STORY_CHAPTER_LIMIT = 5;
const goal = z.string().trim().min(1).max(160);
const endingModeSchema = z.enum(["continue", "final"]);
const arcFields = (limit: number) => ({
  endingPromise: goal,
  installments: z.array(z.object({
    chapter: z.number().int().min(1).max(limit),
    goal, payoff: goal,
  }).strict()).length(limit),
});
const consecutive = (arc: { installments: { chapter: number }[] }) =>
  arc.installments.every((part, index) => part.chapter === index + 1);
const arcSchema = (limit: number) => z.object({ ...arcFields(limit), endingMode: endingModeSchema.optional() })
  .strict().refine(consecutive, "Outline chapters must be consecutive from 1");
export const seriesArcSchema = arcSchema(STORY_CHAPTER_LIMIT);
export const plannedSeriesArcSchema = z.object({ ...arcFields(STORY_CHAPTER_LIMIT), endingMode: endingModeSchema })
  .strict().refine(consecutive, "Outline chapters must be consecutive from 1");
// Read existing saved stories; the generator replaces legacy future plans only.
export const storedSeriesArcSchema = z.union([seriesArcSchema, arcSchema(10)]);
export type SeriesArc = z.infer<typeof seriesArcSchema>;

export const storyConceptHistorySchema = z.array(z.object({
  fromChapter: z.number().int().min(1).max(100000),
  text: z.string().trim().min(1).max(1000),
}).strict()).max(4);

type ConceptHistory = z.infer<typeof storyConceptHistorySchema>;
export function storyConceptEntries(state?: {
  seriesConcept?: string;
  seriesStartChapter?: number;
  conceptHistory?: ConceptHistory;
}): ConceptHistory {
  if (!state) return [];
  const fromChapter = (state.seriesStartChapter ?? 0) + 1;
  const entries = state.conceptHistory ?? [];
  if (!state.seriesConcept || entries.some(entry => entry.fromChapter === fromChapter) ||
      entries.at(-1)?.text === state.seriesConcept) return entries;
  return [...entries, {fromChapter, text:state.seriesConcept}].sort((a,b)=>a.fromChapter-b.fromChapter).slice(-4);
}

export function storyConceptsForChapter(state: Parameters<typeof storyConceptEntries>[0], chapter: number) {
  return storyConceptEntries(state).filter(entry => entry.fromChapter <= chapter).map(entry => entry.text);
}

type SeriesProgress = { chapter: number; seriesStartChapter?: number; seriesArc?: Pick<SeriesArc, "endingMode"> };

export function storyProgress(state?: SeriesProgress) {
  return Math.max(0, (state?.chapter ?? 0) - (state?.seriesStartChapter ?? 0));
}

export function storyComplete(state?: SeriesProgress) {
  return state?.seriesArc?.endingMode === "final" && storyProgress(state) >= STORY_CHAPTER_LIMIT;
}

export function nextSeriesStart(state?: SeriesProgress, additionalConcept?: string) {
  return additionalConcept || storyProgress(state) >= STORY_CHAPTER_LIMIT
    ? state?.chapter ?? 0 : state?.seriesStartChapter ?? 0;
}

export function seriesSchedule(chapter: number, endingMode: SeriesArc["endingMode"] = "continue") {
  const final = endingMode === "final";
  return {
    chapter, totalChapters: STORY_CHAPTER_LIMIT, remainingAfterThis: STORY_CHAPTER_LIMIT - chapter,
    phase: chapter === 1 ? "setup" : chapter === 2 ? "development" : chapter === 3 ? "crisis" : chapter === 4 ? "climax" : final ? "finale" : "resolution",
    direction: chapter === 1
      ? "Establish this arc's conflict, stakes, goals and groundwork for its intended outcome."
      : chapter === 2
      ? "Develop the arc through consequential choices and emotional developments."
      : chapter === 3
      ? "Bring the current conflict to a crisis through choices, consequences or discoveries consistent with the concept."
      : chapter === 4
      ? "Deliver this arc's climactic choice or confrontation and establish its consequences. Prepare the fifth installment's payoff."
      : final
      ? "The user asked to finish the whole story. Resolve the central conflict and long-term goal on the page, with the protagonist's lasting outcome and the central relationship's outcome. Pay off important open threads and close without a sequel hook."
      : "Resolve this arc's immediate conflict and deliver its payoff on the page. Keep the ongoing premise and leave a concrete, natural next step through an established goal, relationship or consequence. End on a complete scene; avoid a forced cliffhanger, a definitive series epilogue or a final wrap-up of every thread.",
  };
}
