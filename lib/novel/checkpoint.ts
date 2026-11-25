import { z } from "zod";

export const MIN_STORY_CHARS = 1500;
export const MAX_STORY_EVENTS = 10;
export const storyChars = (text: string) => Array.from(text.trim()).length;
const storyStageSchema = z.enum(["chapter_plan", "scene_write", "scene_metadata", "proofread", "chapter_review"]);
export type StoryStage = z.infer<typeof storyStageSchema>;

const stateItem = z.string().trim().min(1).max(120);
const evidence = z.string().trim().min(6).max(240);
export const eventStateSchema = z.object({
  location: stateItem,
  present: z.array(stateItem).max(10),
  pending: z.array(stateItem).max(8),
  completed: z.array(stateItem).max(5),
}).strict();
export const storyEventSchema = z.object({
  prose: z.string().trim().min(1).max(3000),
  state: eventStateSchema,
  transitions: z.array(z.object({ item: stateItem, evidence }).strict()).max(24),
  goalEvidence: evidence.nullable(),
}).strict();
export const storyEventMetadataSchema = storyEventSchema.omit({ prose: true });
const pendingEventSchema = z.object({
  index: z.number().int().min(0).max(MAX_STORY_EVENTS - 1),
  prose: storyEventSchema.shape.prose.optional(),
  candidate: storyEventSchema.optional(),
  step: z.enum(["metadata", "patch", "replace", "exhausted"]).default("metadata"),
  failure: z.enum(["invalid_event", "missing_transition", "chapter_too_long", "invalid_prose"]).optional(),
  missing: stateItem.optional(),
}).refine(event => event.prose || (event.step === "replace" || event.step === "exhausted"));
export type StoryEvent = z.infer<typeof storyEventSchema>;

const sceneSchema = z.object({
  prose: z.string().min(1).max(3000),
  timing: z.string().max(240).optional(),
});
const checkpointSchema = z.object({
  chapterPipeline: z.unknown().optional(),
  flow: z.literal("sequential").optional(),
  plan: z.unknown().optional(),
  scenes: z.array(sceneSchema.nullable()).max(5).default([]),
  events: z.array(storyEventSchema).max(MAX_STORY_EVENTS).default([]),
  pendingEvent: pendingEventSchema.optional(),
  boundaryNeedsReview: z.boolean().optional(),
  calls: z.record(z.string(), z.number().int().nonnegative()).default({}),
  proofread: z.string().max(8000).optional(),
  proofreadEventEnds: z.array(z.number().int().min(1).max(8000)).max(MAX_STORY_EVENTS).optional(),
  review: z.unknown().optional(),
  conceptConflict: z.object({ evidence: z.string().min(1).max(400), fix: z.string().max(240) }).optional(),
  boundaryReviewVersion: z.literal(1).optional(),
  boundaryReviewRecovery: z.literal(1).optional(),
  qualityRepairs: z.number().int().min(0).max(1).default(0),
  repair: z.object({ index: z.number().int().min(0).max(MAX_STORY_EVENTS - 1), feedback: z.string().max(5000) }).optional(),
  recoveryStage: storyStageSchema.optional(),
  blocked: z.enum(["quality", "length"]).optional(),
});
export type StoryCheckpoint = z.infer<typeof checkpointSchema>;
export type StoryDraftStore = { load: unknown; save: (data: StoryCheckpoint) => Promise<void> };

export class StoryDraftPaused extends Error {
  readonly reason: "quality" | "length" | "budget" | "format" | "event_recovery";
  readonly eventFailure?: NonNullable<StoryCheckpoint["pendingEvent"]>["failure"];
  constructor(reason: StoryDraftPaused["reason"], eventFailure?: StoryDraftPaused["eventFailure"]) {
    super("Story draft paused");
    this.reason = reason;
    this.eventFailure = eventFailure;
  }
}

export function readStoryCheckpoint(value: unknown) {
  const draft = checkpointSchema.parse(value);
  if (draft.recoveryStage === "scene_write") draft.recoveryStage = undefined;
  if (!draft.scenes.length) draft.flow = "sequential";
  const slots = draft.flow === "sequential" ? draft.events.length : draft.scenes.length;
  if ((!draft.flow && slots !== 3 && slots !== 5) ||
    (draft.repair && draft.repair.index >= slots) ||
    (draft.pendingEvent && draft.pendingEvent.index !== (draft.repair?.index ?? slots)) ||
    (draft.proofreadEventEnds && draft.proofreadEventEnds.length !== draft.events.length)) throw new Error("Invalid saved story draft");
  return draft;
}

export function parseStoryEvent(raw: string) {
  const text = raw.trim().replace(/^\x60{3}(?:json|text)?\s*([\s\S]*?)\s*\x60{3}$/i, "$1");
  let json: unknown;
  try { json = JSON.parse(text); }
  catch {
    // A JSON fragment must never become visible prose.
    if (!/^[{[\x60<]/u.test(text) && /[가-힣]/u.test(text)) json = { prose: text };
  }
  const event = storyEventSchema.safeParse(json);
  if (event.success) return { event: event.data };
  const prose = z.object({ prose: storyEventSchema.shape.prose }).safeParse(json);
  return { prose: prose.success ? prose.data.prose : undefined };
}

function changedEventItems(previous: StoryEvent["state"], state: StoryEvent["state"]) {
  return [...new Set([
    ...(previous.location === state.location ? [] : [previous.location]),
    ...previous.present.filter(person => !state.present.includes(person)),
    ...state.present.filter(person => !previous.present.includes(person)),
    ...previous.pending.filter(action => !state.pending.includes(action)),
  ])];
}

export function missingEventTransition(previous: StoryEvent["state"] | undefined, event: StoryEvent) {
  if (!previous) return undefined;
  return changedEventItems(previous, event.state).find(item =>
    !event.transitions.some(change => change.item === item && event.prose.includes(change.evidence)));
}

export function recoverEventEvidence(previous: StoryEvent["state"] | undefined, event: StoryEvent): StoryEvent {
  if (!previous) return event;
  const changed = changedEventItems(previous, event.state);
  const quotePattern = (quote: string) => quote.split(/[\s“”"]+/u).filter(Boolean)
    .map(token => token.replace(/[.*+?${}()|[\]\\]/g, "\\$&")).join('[\\s“”"]+');
  const transitions = event.transitions.map(change => {
    const exactItem = changed.find(item => item === change.item);
    const candidates = exactItem ? [exactItem] : changed.filter(item =>
      change.item.startsWith(item + " ") || change.item.startsWith(item + ":") ||
      (item === previous.location && stateDestination(change.item, item, event.state.location)));
    if (candidates.length !== 1) return change;
    if (event.prose.includes(change.evidence)) return { ...change, item: candidates[0] };
    const pattern = quotePattern(change.evidence);
    const quotes = pattern ? [...event.prose.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "gu"))] : [];
    if (quotes.length !== 1 || !evidence.safeParse(quotes[0][0]).success) return change;
    return { item: candidates[0], evidence: quotes[0][0] };
  });
  return { ...event, transitions };
}

function stateDestination(label: string, from: string, to: string) {
  return from !== to && label.startsWith(from + "에서 ") && label.slice(from.length + 3).startsWith(to);
}
