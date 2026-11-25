import { z } from "zod";
import { storedSeriesArcSchema, storyConceptHistorySchema } from "./series.ts";
import {sharedChangeSchema} from "../chat/canon.ts";
import {dialogueRegisterChange,storedDialogueRegister,unjustifiedRegisterChanges,sceneAuditSchema} from "./dialogue.ts";
import { conceptRulesSchema, markedScheduleSchema } from "./concept.ts";

const short = z.string().trim().min(1).max(240);
const facts = z.array(short).max(24);
const propStateSchema = z.object({
  item: z.string().trim().min(1).max(60),
  holder: z.string().trim().min(1).max(60).nullable(),
  operator: z.string().trim().min(1).max(60).nullable(),
}).strict();
const propChangeSchema = (citation: z.ZodType<string>) => propStateSchema.extend({
  evidence: citation, changeEvidence: citation.nullable(),
});
type PropState = z.infer<typeof propStateSchema>;
const propKey = (item: string) => item.normalize("NFC").replace(/\s/g, "").toLowerCase();
function storyMemorySize({ previousProse, ...memory }: { previousProse: string }) {
  // Account for the former prose allowance without trimming memory for a longer chapter.
  return JSON.stringify({ ...memory, previousProse: "" }).length + Math.min(JSON.stringify(previousProse).length - 2, 8000);
}

export const storyStateSchema = z.object({
  version: z.literal(1),
  chapter: z.number().int().min(0).max(100000),
  seriesArc: storedSeriesArcSchema.optional(),
  outlineVersion: z.literal(1).optional(),
  seriesStartChapter: z.number().int().min(0).max(100000).optional(),
  seriesConcept: z.string().trim().max(1000).optional(),
  conceptRules: conceptRulesSchema.optional(),
  markedSchedule: markedScheduleSchema.optional(),
  markedConceptHash: z.string().length(64).optional(),
  conceptHistory: storyConceptHistorySchema.optional(),
  summary: z.string().max(1400),
  currentSituation: z.string().max(400),
  longTermGoal: z.string().max(240),
  recentEvents: facts,
  resolvedEvents: facts,
  openThreads: facts,
  worldFacts: facts,
  propStates: z.array(propStateSchema).max(8).optional(),
  characters: z.array(z.object({
    name: short, goal: short,
    knowledge: z.array(short).max(6),
    relationships: z.array(short).max(6),
  }).strict()).max(6),
  previousEnding: z.string().max(700),
  nextChapterGoal: z.string().max(240),
  previousProse: z.string(),
  dialogueRegisters:z.array(storedDialogueRegister).max(12).optional(),
}).strict().refine(value => (value.seriesStartChapter ?? 0) <= value.chapter, "Invalid series start")
  .refine(value => storyMemorySize(value) <= 16000, "Story memory is too large");
export type StoryState = z.infer<typeof storyStateSchema>;
export function emptyStoryState(): StoryState {
  return { version: 1, chapter: 0, summary: "", currentSituation: "", longTermGoal: "",
    recentEvents: [], resolvedEvents: [], openThreads: [], worldFacts: [], characters: [],
    previousEnding: "", nextChapterGoal: "", previousProse: "" };
}

export const planSchema = z.object({
  chapterGoal: short, longTermGoal: short,
  newInformation: short, protagonistChoice: short, costOrConsequence: short,
  beats: z.array(z.object({ goal: short, obstacle: short, action: short, outcome: short }).strict()).min(1).max(5),
  endingChange: short, mustNotRepeat: z.array(short).max(12),
}).strict();
const quoteSchema = z.string().trim().min(1).max(400);
const evidence = (citation: z.ZodType<string>) => z.object({ text: short, evidence: citation }).strict();
const reviewNote = z.string().trim().max(240);
export const createReviewSchema = (citation: z.ZodType<string> = quoteSchema) => z.object({
  pass: z.boolean(),
  sceneAudit:sceneAuditSchema.optional(),
  conceptAlignment: z.object({ satisfied: z.boolean(), evidence: citation, fix: reviewNote }).strict(),
  blockingIssues: z.array(z.object({
    type: z.enum(["repetition", "continuity", "causality", "no_progress", "missing_beat","dialogue","language"]),
    evidence: citation, fix: short,
  }).strict()).max(6),
  completedBeats: z.array(z.number().int().min(1).max(5)).max(5),
  newEvents: z.array(evidence(citation)).min(1).max(6),
  endingChange: evidence(citation),
}).strict();
export const reviewSchema = createReviewSchema();
export const createFinalReviewSchema = (citation: z.ZodType<string> = quoteSchema) => createReviewSchema(citation).extend({
  resolution: z.object({
    centralConflictResolved: z.boolean(),
    protagonistOutcomeShown: z.boolean(),
    relationshipOutcomeShown: z.boolean(),
    hasSequelHook: z.boolean(),
    evidence: citation,
    fix: reviewNote,
  }).strict(),
}).strict();
export const createMemoryPatchSchema = (citation: z.ZodType<string> = quoteSchema) => z.object({
  summary: z.string().trim().min(1).max(1400),
  currentSituation: evidence(citation),
  newEvents: z.array(evidence(citation)).min(1).max(6),
  resolvedEvents: z.array(evidence(citation)).max(6),
  openedThreads: z.array(evidence(citation)).max(6),
  closedThreads: z.array(evidence(citation)).max(6),
  worldFacts: z.array(evidence(citation)).max(6),
  propChanges: z.array(propChangeSchema(citation)).max(2).optional(),
  characters: z.array(z.object({
    name: short, goal: evidence(citation).nullable(), knowledge: z.array(evidence(citation)).max(4),
    relationships: z.array(evidence(citation)).max(4),
  }).strict()).max(6),
  nextChapterGoal: short,
  sharedChanges:z.array(sharedChangeSchema(citation)).max(4).optional(),
  dialogueRegisters:z.array(dialogueRegisterChange(citation)).max(6).optional(),
}).strict();
export const memoryPatchSchema = createMemoryPatchSchema();

export function hasEvidence(prose: string, quote: string) {
  const normalize = (text: string) => text.replace(/\s+/g, "").normalize("NFC");
  return normalize(prose).includes(normalize(quote));
}
export function unsupportedPropChanges(previous: PropState[], changes: z.infer<ReturnType<typeof propChangeSchema>>[], prose: string) {
  return changes.filter(change => {
    const old = previous.find(prop => propKey(prop.item) === propKey(change.item));
    const changed = old && (
      old.holder && change.holder && old.holder !== change.holder ||
      old.operator && change.operator && old.operator !== change.operator
    );
    return !hasEvidence(prose, change.evidence) || (changed && (!change.changeEvidence || !hasEvidence(prose, change.changeEvidence)));
  });
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
  const registers=[...(old.dialogueRegisters??[])];
  if(unjustifiedRegisterChanges(registers,patch.dialogueRegisters??[],prose).length)throw new Error("Unsupported dialogue register change");
  for(const change of patch.dialogueRegisters??[]){
    checked([{text:change.style,evidence:change.evidence}]);
    if(change.changeEvidence)checked([{text:change.style,evidence:change.changeEvidence}]);
    const {changeEvidence:_changeEvidence,...stored}=change;
    const index=registers.findIndex(old=>old.speaker===change.speaker&&old.addressee===change.addressee);
    if(index>=0)registers[index]=stored;else registers.push(stored);
  }
  const propStates = [...(old.propStates ?? [])];
  for (const {item, holder, operator} of patch.propChanges ?? []) {
    const index = propStates.findIndex(prop => propKey(prop.item) === propKey(item));
    const previous = propStates[index];
    if (index >= 0) propStates.splice(index, 1);
    propStates.push({item: previous?.item ?? item, holder: holder ?? previous?.holder ?? null, operator: operator ?? previous?.operator ?? null});
  }
  if (unsupportedPropChanges(old.propStates ?? [], patch.propChanges ?? [], prose).length) throw new Error("Unsupported memory");
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
    ...(propStates.length ? {propStates:propStates.slice(-8)} : {}),
    ...(registers.length?{dialogueRegisters:registers.slice(-12)}:{}),
  };
  // Keep the rolling summary and immediate ending. Trim oldest detail only when
  // the aggregate budget is reached, so a long session cannot get stuck forever.
  const queues = [next.recentEvents, ...next.characters.map(character => character.relationships),
    ...next.characters.map(character => character.knowledge), next.resolvedEvents, next.worldFacts, next.openThreads,next.dialogueRegisters??[],next.propStates??[]];
  while (storyMemorySize(next) > 16000) {
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
