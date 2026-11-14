import { z } from "zod";

const short = z.string().trim().min(1).max(240);
const facts = z.array(short).max(24);
export const storyStateSchema = z.object({
  version: z.literal(1),
  chapter: z.number().int().min(0).max(100000),
  summary: z.string().max(1400),
  currentSituation: z.string().max(400),
  longTermGoal: z.string().max(240),
  recentEvents: facts,
  resolvedEvents: facts,
  openThreads: facts,
  worldFacts: facts,
  characters: z.array(z.object({
    name: short, goal: short,
    knowledge: z.array(short).max(6),
    relationships: z.array(short).max(6),
  }).strict()).max(6),
  previousEnding: z.string().max(700),
  nextChapterGoal: z.string().max(240),
  previousProse: z.string().max(8000),
}).strict().refine(value => JSON.stringify(value).length <= 16000, "Story memory is too large");
export type StoryState = z.infer<typeof storyStateSchema>;
export function emptyStoryState(): StoryState {
  return { version: 1, chapter: 0, summary: "", currentSituation: "", longTermGoal: "",
    recentEvents: [], resolvedEvents: [], openThreads: [], worldFacts: [], characters: [],
    previousEnding: "", nextChapterGoal: "", previousProse: "" };
}

export const planSchema = z.object({
  chapterGoal: short, longTermGoal: short,
  newInformation: short, protagonistChoice: short, costOrConsequence: short,
  beats: z.array(z.object({ goal: short, obstacle: short, action: short, outcome: short }).strict()).min(3).max(5),
  endingChange: short, mustNotRepeat: z.array(short).max(12),
}).strict();
const quoteSchema = z.string().trim().min(1).max(400);
const evidence = (citation: z.ZodType<string>) => z.object({ text: short, evidence: citation }).strict();
export const createReviewSchema = (citation: z.ZodType<string> = quoteSchema) => z.object({
  pass: z.boolean(),
  blockingIssues: z.array(z.object({
    type: z.enum(["repetition", "continuity", "causality", "no_progress", "missing_beat"]),
    evidence: citation, fix: short,
  }).strict()).max(6),
  completedBeats: z.array(z.number().int().min(1).max(5)).max(5),
  newEvents: z.array(evidence(citation)).min(1).max(6),
  endingChange: evidence(citation),
}).strict();
export const reviewSchema = createReviewSchema();
export const createMemoryPatchSchema = (citation: z.ZodType<string> = quoteSchema) => z.object({
  summary: z.string().trim().min(1).max(1400),
  currentSituation: evidence(citation),
  newEvents: z.array(evidence(citation)).min(1).max(6),
  resolvedEvents: z.array(evidence(citation)).max(6),
  openedThreads: z.array(evidence(citation)).max(6),
  closedThreads: z.array(evidence(citation)).max(6),
  worldFacts: z.array(evidence(citation)).max(6),
  characters: z.array(z.object({
    name: short, goal: evidence(citation).nullable(), knowledge: z.array(evidence(citation)).max(4),
    relationships: z.array(evidence(citation)).max(4),
  }).strict()).max(6),
  nextChapterGoal: short,
}).strict();
export const memoryPatchSchema = createMemoryPatchSchema();

export function hasEvidence(prose: string, quote: string) {
  const normalize = (text: string) => text.replace(/\s+/g, "").normalize("NFC");
  return normalize(prose).includes(normalize(quote));
}
function merge(old: string[], added: string[], limit: number) {
  return [...new Set([...old, ...added])].slice(-limit);
}
export function mergeMemory(old: StoryState, patch: z.infer<typeof memoryPatchSchema>, prose: string, goal: string): StoryState {
  const checked = (items: { text: string; evidence: string }[]) => {
    if (items.some(item => !hasEvidence(prose, item.evidence))) throw new Error("Unsupported memory");
    return items.map(item => item.text);
  };
  checked([patch.currentSituation]);
  const characters = old.characters.map(character => ({ ...character, knowledge: [...character.knowledge], relationships: [...character.relationships] }));
  for (const change of patch.characters) {
    const previous = characters.find(character => character.name === change.name);
    if (change.goal) checked([change.goal]);
    const character = {
      name: change.name, goal: change.goal?.text ?? previous?.goal ?? "미정",
      knowledge: merge(previous?.knowledge ?? [], checked(change.knowledge), 6),
      relationships: merge(previous?.relationships ?? [], checked(change.relationships), 6),
    };
    if (previous) characters[characters.indexOf(previous)] = character;
    else characters.push(character);
  }
  const closed = checked(patch.closedThreads);
  const next: StoryState = {
    ...old, chapter: old.chapter + 1, summary: patch.summary,
    currentSituation: patch.currentSituation.text,
    longTermGoal: old.longTermGoal || goal,
    recentEvents: merge(old.recentEvents, checked(patch.newEvents), 8),
    resolvedEvents: merge(old.resolvedEvents, checked(patch.resolvedEvents), 24),
    openThreads: merge(old.openThreads.filter(thread => !closed.includes(thread)), checked(patch.openedThreads), 12),
    worldFacts: merge(old.worldFacts, checked(patch.worldFacts), 16),
    characters: characters.slice(-6), previousEnding: prose.slice(-700),
    previousProse: prose, nextChapterGoal: patch.nextChapterGoal,
  };
  // Keep the rolling summary and immediate ending. Trim oldest detail only when
  // the aggregate budget is reached, so a long session cannot get stuck forever.
  const queues = [next.recentEvents, ...next.characters.map(character => character.relationships),
    ...next.characters.map(character => character.knowledge), next.resolvedEvents, next.worldFacts, next.openThreads];
  while (JSON.stringify(next).length > 16000) {
    const queue = queues.find(items => items.length > 0);
    if (!queue) break;
    queue.shift();
  }
  return storyStateSchema.parse(next);
}

// Catch copied passages without requiring identical punctuation or spacing.
export function repeatsPrevious(prose: string, previous: string) {
  const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");
  const current = normalize(prose), old = normalize(previous);
  if (!old || current.length < 80 || old.length < 80) return false;
  const shingles = (text: string) => new Set(Array.from({ length: text.length - 11 }, (_, i) => text.slice(i, i + 12)));
  const a = shingles(current), b = shingles(old);
  return [...a].filter(part => b.has(part)).length / a.size > 0.6;
}
