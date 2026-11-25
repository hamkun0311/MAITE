import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import {
  claudeNovelModel, geminiNovelWriteModel, geminiNovelProofreadModel, geminiNovelStyleModel, openAINovelWriteModel, openAINovelProofreadModel,
  novelPlanMaxOutputTokens, novelReviewMaxOutputTokens, novelPlanReasoningOptions, novelReviewReasoningOptions, novelWriteReasoningOptions, textModel,
} from "../ai-model.ts";
import { conceptPriorityInstructions, type CharacterContext } from "../chat/character.ts";
import { userDisplayName, userNamingInstructions } from "../chat/identity.ts";
import { plainDialogue } from "../chat/presentation.ts";
import type { Timeline } from "../chat/timeline.ts";
import { openAIResponsesEndpoint, openAITextKey } from "../openai-endpoint.ts";
import { usageFetch, type UsageListener } from "../usage.ts";
import { MIN_STORY_CHARS, readStoryCheckpoint, storyChars, StoryDraftPaused, type StoryDraftStore } from "./checkpoint.ts";
import { writeClaudeNovelStage } from "./claude.ts";
import { conceptRuleAuditInstructions, conceptRuleAuditSchema, conceptRuleViolations, conceptRulesSchema, groundedConceptRules, markedConceptEvents, markedEventAuditSchema, markedEvidenceReviewInstructions, markedEvidenceReviewSchema, markedPlanInstructions, markedReviewInstructions, markedScenesSchema, markedScheduleSchema, novelConceptInstructions, plannedMarkedScenes, scheduleMarkedEvents } from "./concept.ts";
import { novelTimelineContext, sourceContext } from "./context.ts";
import { removeAdjacentRepeatedDialogue, unjustifiedRegisterChanges } from "./dialogue.ts";
import { streamNovelWrite } from "./draft-stream.ts";
import { eventAuditInstructions, eventAuditSchema, inspectEventAudit } from "./event-audit.ts";
import { geminiApiKey, writeGeminiProse } from "./gemini.ts";
import { applyDialogueEdits, applyProofreading, koreanTimeNumberInstructions, proofreadingEditsSchema, proofreadingInstructions, residenceChecks, sceneContextChecks } from "./proofread.ts";
import { inspectPromiseAudit, promiseAuditFields, promiseReviewInstructions, promiseWritingInstructions } from "./promises.ts";
import { novelReviewerQualityInstructions, novelWriterQualityInstructions } from "./quality.ts";
import { findRepeatedPassage, findReplayedInsertion } from "./repetition.ts";
import { createNovelReviewLogger, manuscriptFingerprint } from "./review-log.ts";
import { stripStoryMetadata } from "./scene-headings.ts";
import { seriesArcSchema, seriesSchedule, storyComplete, storyConceptEntries } from "./series.ts";
import { manuscriptSources, resolveSources } from "./sources.ts";
import { createFinalReviewSchema, createMemoryPatchSchema, createReviewSchema, emptyStoryState, mergeMemory, repeatsPrevious, unsupportedPropChanges, type StoryState } from "./state.ts";
import { fiveEventDraftSchema as draftSchema, parseStyleEditResponse } from "./style-edit.ts";
import { novelRetryDelay, NovelUpstreamError } from "./upstream-error.ts";

export const NOVEL_PROMPT_VERSION = "novel-progress-v110-review-format-recovery";
const reviewPolicy = "material-v6-marked-evidence";
const beats = ["발단", "전개", "위기", "절정", "결말"];
const detail = z.string().min(1).max(240);
const seriesPlanSchema = z.object({ arc: seriesArcSchema, conceptRules: conceptRulesSchema, markedSchedule: markedScheduleSchema.optional() }).strict();
const eventPlanSchema = z.object({
  goal: detail, conflict: detail, decisiveChoice: detail, payoff: detail,
  events: z.array(z.object({ entry: detail, action: detail, result: detail }).strict()).length(5),
  markedScenes: markedScenesSchema.optional(),
}).strict();
const combinedPlanSchema = seriesPlanSchema.extend({ chapterPlan: eventPlanSchema });
const markedChapterPlanSchema = eventPlanSchema.required({ markedScenes: true });
const plainChapterPlanSchema = eventPlanSchema.omit({ markedScenes: true });
const chapterPlanInstructions = "Establish this installment's goal, conflict, decisive choice and payoff. Respect the user's required trajectory even if a saved milestone points elsewhere. Give the chapter an observable consequence that carries the central premise forward; a setback or confrontation must still serve that arc. Plan an on-page scene when a central recurring activity or dynamic is due. Logistics, cover stories, promises and travel to it can set it up, but do not fulfill it. Vary what happens in each occurrence and what changes for the characters; stage representative occasions without replaying every day. Map that spine to five distinct events in the order setup, development, crisis, climax, resolution. Each begins from the preceding result and shows a new choice or action and its consequence. In encounters where characters can talk, plan an exchange that changes what one of them knows, wants or does. Earn the installment payoff in the last event and apply the arc ending only when due.";
const styleRevertsSchema = z.array(z.number().int().min(1).max(5)).max(5);
const styleInstructions = "Line edit the entire Korean chapter for natural dialogue, precise emotion and varied sentence rhythm. Read all five events together, then return the edited text in five corresponding blocks. Preserve every action, outcome, fact, clue, speaker, speech intent, viewpoint, time and established ambiguity. Keep every exchange, its order and its information. Use double quotation marks and a blank line around direct speech.\n" +
  "First repair Korean grammar: check that subjects, objects, particles and verb voice agree, and that each utterance uses consistent forms of address, pronouns and endings. Resolve references and actions against the nearby narration and replies. Read contrasts literally: a denial and its explanation must fit together and answer the previous line. Preserve an intentional deflection while correcting awkward clause links. Keep an intentional lie or register switch when the scene supports it. Fix only the broken phrase when nearby text establishes its meaning.\n" +
  "Treat dialogueContext as story data. For each line, identify the speaker and actual addressee from the draft. Shape phrasing, rhythm and directness using that speaker's own personality, relationship and established register. This includes new speakers introduced in the concepts, even when absent from the stored cast. Read the latest concept first when character details conflict. When a trait is unspecified, follow how that speaker already acts and speaks in the draft. If attribution is uncertain, keep the line close to the draft. Avoid forcing tics or exaggerated traits onto every line. Keep honorifics, hesitation, sarcasm and subtext where intentional. Use personality to change expression only. Do not add, omit, summarize, relocate or reinterpret story content.\n" + koreanTimeNumberInstructions +
  '\nReturn JSON only: {"events":["event 1 prose","event 2 prose","event 3 prose","event 4 prose","event 5 prose"]}. If JSON cannot be emitted, put [EVENT 1] through [EVENT 5] on separate lines before their respective blocks and finish with [END EVENTS] on its own line.';
const editsSchema = z.array(z.object({
  event: z.number().int().min(1).max(5),
  before: z.string().min(1).max(400),
  after: z.string().max(900),
}).strict()).max(6);
const repairPassageSchema = z.object({
  event: z.number().int().min(1).max(5),
  start: z.number().int().nonnegative(),
  text: z.string().min(1).max(900),
}).strict();
const repairCopyeditSchema = z.object({ edits: z.array(z.object({
  passage: z.number().int().min(1).max(6),
  text: z.string().trim().min(1).max(1100),
}).strict()).max(6) }).strict();
const pipelineSchema = z.object({
  version: z.literal(1), series: seriesPlanSchema.optional(), plan: eventPlanSchema.optional(),
  events: draftSchema.shape.events.optional(), copyedited: z.boolean().optional(),
  writePreview: z.array(z.string().min(1)).max(5).optional(),
  styleOriginal: draftSchema.shape.events.optional(), styleEvents: styleRevertsSchema.optional(),
  repaired: z.boolean().optional(), pendingRepairCopyedit: z.array(repairPassageSchema).max(6).optional(), blocked: z.boolean().optional(),
  blockedByPolicy: z.string().optional(), review: z.unknown().optional(),
}).strict();

type Options = {
  traceId?: string; draftStore?: StoryDraftStore; timeline?: Timeline; character: CharacterContext;
  state?: StoryState; direction: string; previous?: string; additionalConcept?: string; key: string;
  signal: AbortSignal; phase: (phase: string) => void; onUsage?: UsageListener;
  onDraftProgress?: (progress: { chars: number; events: number }) => void;
  onDraftUpdate?: (text: string) => void;
  onDraftPreview?: (text: string) => void;
};

export class NovelOutputLimitError extends Error {
  readonly stage: string;
  constructor(stage: string) { super("Novel output token limit"); this.stage = stage; }
}
export function novelJsonSchema(schema: z.ZodType) {
  const { $schema: _dialect, ...body } = z.toJSONSchema(schema, { reused: "ref" });
  return body;
}
const cleanProse = (text: string) => removeAdjacentRepeatedDialogue(stripStoryMetadata(plainDialogue(text))).trim();
const manuscript = (parts: string[]) => parts.join("\n\n");
const meetsMinimum = (text: string) => storyChars(text) >= MIN_STORY_CHARS;
const usableEdit = "Use numbered events and exact unique before anchors. Each edit fixes a single passage within its event. Preserve unrelated sentences and later outcomes. Use an existing sentence to anchor any missing beat or added reaction. If the chapter is too short, develop the existing five events. Omit changes when none are needed.";
const materialReview = "Judge whether this chapter is ready to read. Block only consequential errors: an explicit concept violation, a contradiction that changes a major action or outcome, an actual replay, a missing cause or payoff that makes a pivotal event unintelligible, or broken wording that obscures who did what, a reply's meaning or what a line refers to. For broken wording cite the affected phrase as language or dialogue and fix only that phrase. Use causality or no_progress for essential omissions. Put cosmetic wording, readable typos, minor register slips, reasonably inferable handoffs or movements, and skipped or merged outline details under advisoryIssues. The five beats guide pacing; completedBeats and sceneAudit describe the result and minor gaps alone do not fail the chapter. Suggest edits only for blocking issues or insufficient length. Always provide a grounded memory patch for a coherent chapter, including when it has advisory findings.";

function applyEventEdits(parts: string[], edits: z.infer<typeof editsSchema>) {
  const positions = edits.map(edit => {
    const index = edit.event - 1;
    const original = parts[index];
    if (!original.includes(edit.before) && /^["“]/u.test(edit.before)) {
      const [match] = applyDialogueEdits(original, [edit]).replacements;
      if (match) edit = { event: edit.event, before: match.before, after: match.after };
    }
    const start = original.indexOf(edit.before);
    if (start < 0 || start !== original.lastIndexOf(edit.before) || edit.before === edit.after ||
        edit.before.length === original.length || stripStoryMetadata(edit.after.trim()) !== edit.after.trim()) throw new Error("Invalid local novel edit");
    return { ...edit, index, start };
  }).sort((a, b) => b.start - a.start);
  const result = [...parts], ends = parts.map(part => part.length);
  for (const edit of positions) {
    const end = edit.start + edit.before.length;
    if (end > ends[edit.index]) throw new Error("Invalid local novel edit");
    const text = result[edit.index];
    result[edit.index] = text.slice(0, edit.start) + edit.after + text.slice(end);
    ends[edit.index] = edit.start;
  }
  const shifts = parts.map(() => 0);
  const passages = positions.reverse().flatMap(({ event, index, start, before, after }) => {
    const text = after.trim();
    const offset = start + shifts[index] + (after.length - after.trimStart().length) -
      (result[index].length - result[index].trimStart().length);
    shifts[index] += after.length - before.length;
    return text ? [{ event, start: offset, text }] : [];
  });
  return { events: draftSchema.parse({ events: result.map(text => text.trim()) }).events, passages };
}

export async function generateChapter(options: Options) {
  const { character, timeline, signal, key } = options;
  const old = options.state ?? { ...emptyStoryState(),
    previousEnding: options.previous?.slice(-700) ?? "", previousProse: options.previous?.slice(-8000) ?? "" };
  const chapter = old.chapter + 1;
  const trace = createNovelReviewLogger({ traceId: options.traceId, chapter, mode: "reviewed", promptVersion: NOVEL_PROMPT_VERSION });
  let stage = "planning", calls = 0, inputChars = 0, providerRetries = 0, preview = "";
  let partialWrite: string[] | undefined, streamedWrite = "";
  const phase = (name: string) => { stage = name; options.phase(name); };
  const openAIPlanProvider = process.env.OPENAI_NOVEL_PLAN_PROVIDER?.trim() || undefined;
  const openAIPlanModel = process.env.OPENAI_NOVEL_PLAN_MODEL?.trim() || textModel(openAIPlanProvider);
  const openAIWriterProvider = process.env.OPENAI_NOVEL_WRITE_PROVIDER?.trim() || undefined;
  const MODEL = textModel(), openAIWriter = openAINovelWriteModel() || textModel(openAIWriterProvider), geminiWriter = geminiNovelWriteModel();
  const openAIProofreader = openAINovelProofreadModel(), geminiProofreader = geminiNovelProofreadModel();
  const openAIStylist = process.env.OPENAI_NOVEL_STYLE_MODEL?.trim();
  const geminiStylist = openAIStylist ? "" : geminiNovelStyleModel();
  const claudeWriter = claudeNovelModel("WRITE"), claudeReviewer = claudeNovelModel("REVIEW"), claudeProofreader = claudeNovelModel("PROOFREAD");
  const hasProofreader = Boolean(openAIProofreader || geminiProofreader || claudeProofreader);
  const claudeKey = process.env.CLAUDE_API_KEY?.trim(), geminiKey = geminiApiKey();
  async function callProvider(instructions: string, input: string, schema: z.ZodType | undefined, name: string, tokens: number): Promise<string> {
    calls++;inputChars+=instructions.length+input.length;
    const isProse = name === "write" || name === "passage_repair";
    const isCopyedit = name === "proofread" || name === "repair_proofread";
    const isPlan = name === "chapter_plan" || name === "series_plan";
    const isReview = name === "chapter_review" || name === "marked_evidence_review";
    const feature = name;
    const callNumber=calls;
    const claudeModel = isCopyedit ? claudeProofreader : isReview ? claudeReviewer : isProse ? claudeWriter : "";
    if (claudeModel && claudeKey) {
      const metadata = { call: callNumber, feature: `novel.${feature}`, reasoningEffort: null };
      trace.event("model_call_started", { ...metadata, model: claudeModel, maxOutputTokens: tokens });
      const responseSchema = name === "proofread" ? proofreadingEditsSchema : schema;
      const result = await writeClaudeNovelStage({
        model: claudeModel, key: claudeKey,
        instructions: name === "write" ? instructions +
          '\nReturn the five prose blocks via the write tool. If the tool is unavailable, return only a JSON object with an "events" array containing the five prose strings in order.' : instructions,
        input, maxOutputTokens: tokens,
        schema: responseSchema ? novelJsonSchema(responseSchema) : undefined,
        stage: name, feature: metadata.feature, signal,
        onUsage: record => {
          if (record.status !== "running") trace.event("model_call_finished", { ...metadata, ...record });
          options.onUsage?.(record);
        },
      });
      if (!result.completed) {
        trace.event("claude_response_incomplete", { ...metadata, ...result.diagnostics,
          partialEvents: result.partialDraft?.length ?? 0 });
        if (name === "write") partialWrite = result.partialDraft;
        if (result.outputLimit) throw new NovelOutputLimitError(name);
        if (name === "write") throw new StoryDraftPaused("format");
        throw new Error("Incomplete novel stage");
      }
      if (result.recoveredFrom) {
        trace.event("claude_response_recovered", { ...metadata, ...result.diagnostics, from: result.recoveredFrom });
      }
      trace.event("model_output", metadata, { output: result.text });
      return result.text;
    }
    const geminiModel = name === "style_edit" ? geminiStylist : isCopyedit ? geminiProofreader : isProse ? geminiWriter : undefined;
    if (geminiModel && geminiKey) {
      const metadata = {call: callNumber, feature: `novel.${feature}`, reasoningEffort: "low"};
      trace.event("model_call_started", {...metadata, model: geminiModel, maxOutputTokens: tokens});
      const result = await writeGeminiProse({
        model: geminiModel, key: geminiKey, instructions, input, maxOutputTokens: tokens,
        responseSchema: schema ? novelJsonSchema(schema) : undefined,
        feature: metadata.feature, signal,
        onUsage: record => {
          if (record.status !== "running") trace.event("model_call_finished", {...metadata, ...record});
          options.onUsage?.(record);
        },
      });
      if (result.finishReason === "MAX_TOKENS") throw new NovelOutputLimitError(name);
      if (result.finishReason !== "STOP") throw new Error("Incomplete novel stage");
      if (!result.text.trim()) throw new Error("Empty novel stage");
      trace.event("model_output", metadata, {output: result.text});
      return result.text;
    }
    const model = isPlan ? openAIPlanModel : isCopyedit ? openAIProofreader : isProse ? openAIWriter
      : name === "style_edit" ? openAIStylist || MODEL : MODEL;
    const provider = isPlan ? openAIPlanProvider : isProse ? openAIWriterProvider : undefined;
    const stageKey = provider ? openAITextKey(provider) : key;
    if (!stageKey) throw new Error("Missing OpenAI novel stage API key");
    const reasoning=isReview?novelReviewReasoningOptions(model):isPlan?novelPlanReasoningOptions(model):novelWriteReasoningOptions(model);
    trace.event("model_call_started",{call:callNumber,feature:`novel.${feature}`,model,reasoningEffort:reasoning.reasoning?.effort??null,maxOutputTokens:tokens});
    const streamDraft = name === "write" && options.onDraftUpdate;
    const endpoint = openAIResponsesEndpoint(provider);
    const request: RequestInit = {
      redirect: "error",
      method: "POST", signal,
      headers: { Authorization: `Bearer ${stageKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, ...reasoning,
        ...(streamDraft ? { stream: true } : {}),
        max_output_tokens: tokens, instructions, input,
        ...(schema ? { text: { format: { type: "json_schema", name, strict: true,
          schema: novelJsonSchema(schema) } } } : {}),
      }),
    };
    const onUsage: UsageListener = record=>{if(record.status!=="running")trace.event("model_call_finished",{call:callNumber,...record,reasoningEffort:reasoning.reasoning?.effort??null});options.onUsage?.(record);};
    const result = streamDraft
      ? await streamNovelWrite(model, endpoint, request, text => {
        streamedWrite = cleanProse(text);
        streamDraft(streamedWrite);
      }, onUsage)
      : { ...await usageFetch(`novel.${feature}`, model, endpoint, request, onUsage), raw: "" };
    const { response, data, raw } = result;
    if (!response.ok) throw new NovelUpstreamError("openai", response.status, data, response.headers.get("retry-after"));
    if (data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens") throw new NovelOutputLimitError(name);
    if (data?.status !== "completed") throw new Error("Incomplete novel stage");
    const text = (Array.isArray(data.output) ? data.output.flatMap((item: { type: string; content?: { type: string; text?: string }[] }) =>
      item.type === "message" ? (item.content ?? []).filter(part => part.type === "output_text").map(part => part.text ?? "") : []).join("") : "") || raw;
    if (!text.trim()) throw new Error("Empty novel stage");
    trace.event("model_output",{call:callNumber,feature:`novel.${feature}`},{output:text});
    return text;
  }
  async function structured<T extends z.ZodType>(name: string, instructions: string, input: unknown, schema: T, tokens: number,
    wireSchema: z.ZodType = schema, parseOutput = (raw: string): unknown =>
      JSON.parse(raw.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, "$1"))): Promise<z.infer<T>> {
    for (;;) {
      signal.throwIfAborted();
      try {
        const raw = await callProvider(instructions, JSON.stringify(input), wireSchema, name, tokens);
        return schema.parse(parseOutput(raw));
      } catch (error) {
        const delay = providerRetries < 2 && !signal.aborted ? novelRetryDelay(error, providerRetries) : undefined;
        if (delay === undefined) throw error;
        providerRetries++;
        trace.event("story_stage_provider_retry", { stage: name, retry: providerRetries, delayMs: delay });
        if (name === "write" && streamedWrite) {
          streamedWrite = "";
          options.onDraftUpdate?.("");
        }
        await wait(delay, undefined, { signal });
      }
    }
  }
  trace.event("started");
  try {
    const saved = readStoryCheckpoint(options.draftStore?.load ?? {});
    const legacy = saved.events.length ? saved.events.map(event => event.prose) : saved.scenes.flatMap(scene => scene ? [scene.prose] : []);
    if (!saved.repair && saved.pendingEvent?.prose) legacy.push(saved.pendingEvent.prose);
    preview = cleanProse(saved.proofread || manuscript(legacy));
    const checkpoint = pipelineSchema.parse(saved.chapterPipeline ?? { version: 1 });
    if (checkpoint.events) preview = manuscript(checkpoint.events);
    else if (checkpoint.writePreview) preview = manuscript(checkpoint.writePreview);
    const save = async () => { await options.draftStore?.save({ ...saved, chapterPipeline: checkpoint }); };
    const wasBlocked = checkpoint.blocked;
    if (wasBlocked && checkpoint.blockedByPolicy === reviewPolicy)
      throw new StoryDraftPaused(meetsMinimum(preview) ? "quality" : "length");
    if (checkpoint.blocked) {
      checkpoint.blocked = false;
      await save();
    }
    if ((geminiWriter || geminiProofreader) && !geminiKey) throw new Error("Missing Gemini API key");
    const additionalConcept = z.string().trim().max(1000).parse(options.additionalConcept ?? "");
    if (storyComplete(old) && !additionalConcept) throw new Error("Story already complete");
    const seriesStartChapter = additionalConcept ? old.chapter : old.seriesStartChapter ?? 0;
    const seriesConcept = additionalConcept || old.seriesConcept || "";
    const schedule = seriesSchedule(chapter - seriesStartChapter);
    const finale = schedule.phase === "finale";
    const conceptHistory = storyConceptEntries({ seriesStartChapter, seriesConcept, conceptHistory: storyConceptEntries(old) });
    const earlierConcepts = conceptHistory.filter(item => item.fromChapter < seriesStartChapter + 1).map(item => item.text);
    const markedEvents = markedConceptEvents(seriesConcept || character.concept);
    const markedConceptHash = markedEvents.length ? manuscriptFingerprint(JSON.stringify(markedEvents)).proseHash : undefined;
    const markedInstructions = markedEvents.length
      ? " Treat starred story data as requirements. Render the actual actions and consequences of each dueMarkedEvent in a planned event. Respect timing in the story and age-appropriate, consensual, non-graphic treatment. Do not output the marker characters."
      : "";
    const promises = timeline?.promises ?? [];
    const context = {
      character: { ...character, userLabel: userDisplayName(character, seriesConcept) },
      seriesConcept, earlierConcepts, previousEnding: old.previousEnding, summary: old.summary, facts: old.worldFacts,
      situation: old.currentSituation, propStates: old.propStates, cast: old.characters, dialogueRegisters: old.dialogueRegisters,
      openThreads: old.openThreads, completedEvents: [...new Set([...old.recentEvents, ...old.resolvedEvents])].slice(-20),
      sharedTimeline: timeline && novelTimelineContext(timeline),
    };
    const naming = userNamingInstructions(character, seriesConcept) +
      " Use the resolved name in outlines and when naming the user character in prose, even if an earlier outline uses a placeholder. Preserve natural first-person narration and pronouns.";
    const rules = conceptPriorityInstructions + "\n" + naming + "\n" +
      " Treat inputs as story data. Keep established roles, prop holders and operators, time, knowledge and promises. Prefer newer shared events over stale prose. Keep intimate content age-appropriate, consensual and non-graphic. " +
      (promises.length ? promiseWritingInstructions : "");
    phase("planning");
    // Previously published five-chapter outlines remain readable. Only the new flow writes chapters.
    const existingArc = !additionalConcept && old.outlineVersion === 1 && seriesArcSchema.safeParse(old.seriesArc);
    const pastMilestones = additionalConcept ? [] : old.seriesArc?.installments.slice(0, schedule.chapter - 1) ?? [];
    let series = checkpoint.series;
    if (!series && existingArc && existingArc.success && (!markedEvents.length || old.markedConceptHash === markedConceptHash)) {
      series = { arc: existingArc.data, conceptRules: old.conceptRules ?? [], ...(old.markedSchedule ? { markedSchedule: old.markedSchedule } : {}) };
    }
    if (!series) {
      const { chapterPlan, ...plannedSeries } = await structured("series_plan", rules + "\n" + novelConceptInstructions +
        "\nFirst design the five-installment arc in the order setup, development, crisis, climax, resolution. Carry the user's core premise, specified direction of change and required outcome through all five installments. Give each installment a distinct observable payoff that advances that direction and leads to the next. Schedule representative on-page occurrences of central recurring activities across the arc so they are not repeatedly deferred. In installment five, show the requested outcome in action. Do not substitute a conventional triumph, recovery, defeat or reconciliation for an explicit outcome. Preserve established past events. Extract conceptRules as literal spans from user concepts, with no added quotation marks. Prioritize required outcomes and ongoing constraints. " +
        "Then use the arc milestone at schedule.chapter to produce chapterPlan for the current installment only. " + chapterPlanInstructions + markedInstructions +
        (markedEvents.length ? " Return markedSchedule in the same order as markedEvents. Each entry lists the relative installment numbers (1–5) when the marked action actually occurs. Use the explicit episode or in-story timing when present, translate absolute chapters using arcStart, and choose a remaining installment for undated events. Schedule multiple installments only for explicitly recurring requirements. Keep conceptRules for other requirements since markedEvents receive a separate audit. In chapterPlan, " + markedPlanInstructions + " Use [] when none are due." : ""),
        { ...context, beats, chapter, schedule, direction: options.direction, completedInstallments: schedule.chapter - 1,
          pastMilestones, ...(markedEvents.length ? { markedEvents, arcStart: seriesStartChapter } : {}) },
        markedEvents.length ? combinedPlanSchema.required({ markedSchedule: true }).extend({ chapterPlan: markedChapterPlanSchema })
          : combinedPlanSchema.omit({ markedSchedule: true }).extend({ chapterPlan: plainChapterPlanSchema }), novelPlanMaxOutputTokens());
      plannedSeries.arc.installments = plannedSeries.arc.installments.map((milestone, index) => pastMilestones[index] ?? milestone);
      series = plannedSeries;
      checkpoint.series = plannedSeries;
      checkpoint.plan = chapterPlan;
      await save();
    }
    const conceptRules = groundedConceptRules(series.conceptRules, [seriesConcept, ...earlierConcepts, character.concept]);
    const markedSchedule = markedEvents.length ? scheduleMarkedEvents(markedEvents, series.markedSchedule, schedule.chapter, seriesStartChapter) : undefined;
    const dueMarkedEvents = markedEvents.filter((_, index) => markedSchedule?.[index].includes(schedule.chapter));
    const draftPlan = checkpoint.plan;
    const needsAssignments = !plannedMarkedScenes(dueMarkedEvents, draftPlan?.markedScenes);
    const planChapter = (previous?: z.infer<typeof eventPlanSchema>) => structured("chapter_plan",
      rules + "\nPlan only this installment. " + chapterPlanInstructions + (dueMarkedEvents.length ? markedInstructions + " " + markedPlanInstructions : ""),
      { ...context, conceptRules, beats, chapter, schedule, installment: series.arc.installments[schedule.chapter - 1],
        endingPromise: series.arc.endingPromise, direction: options.direction,
        ...(dueMarkedEvents.length ? { dueMarkedEvents, previous } : {}) },
      dueMarkedEvents.length ? markedChapterPlanSchema : plainChapterPlanSchema, novelPlanMaxOutputTokens());
    let plan: z.infer<typeof eventPlanSchema> = draftPlan && !needsAssignments ? draftPlan : await planChapter(draftPlan);
    let markedScenes = plannedMarkedScenes(dueMarkedEvents, plan.markedScenes);
    if (!markedScenes) {
      trace.event("marked_scene_plan_missing");
      plan = await planChapter(plan);
      markedScenes = plannedMarkedScenes(dueMarkedEvents, plan.markedScenes);
      if (!markedScenes) throw new Error("Missing marked scene assignments");
    }
    const markedContext = markedScenes.length ? { dueMarkedEvents, markedScenes } : {};
    if (plan !== draftPlan || !checkpoint.series) {
      checkpoint.series = series;
      checkpoint.plan = plan;
      if (needsAssignments && checkpoint.repaired) {
        checkpoint.repaired = false;
        checkpoint.review = undefined;
      }
      await save();
    }
    const episode = { ...context, conceptRules, plan, chapter, schedule, beats, endingPromise: series.arc.endingPromise };
    if (!checkpoint.events) {
      phase("writing");
      const { markedScenes: _assignments, ...writerPlan } = plan;
      const result = await structured("write", rules + (markedScenes.length ? " Write each requiredAction in its assigned scene as an actual action and consequence. The requirement, actor, action and consequence must agree. A promise or setup cannot fulfill a scene." : "") + "\n" + await novelWriterQualityInstructions() +
        "\nWrite the five planned events as five Korean prose blocks in one response. Follow the user's required trajectory wherever a saved plan conflicts, and show the installment's consequence on the page. Aim for 1,800–2,200 characters including spaces, with " + MIN_STORY_CHARS +
        " characters as the minimum. Budget roughly 360–440 characters per event on average and give the decisive scenes more room. Use blank lines between prose paragraphs and around direct speech. Show each action, reaction, emotion and consequence; trim recaps and filler. When the concept calls for a recurring activity in this installment, let it happen on the page and show what the characters do or say differently on this occasion and how it changes them. Carry each result into the next event. Keep speakers, register and viewpoint clear. Use only prose inside the blocks, without stage names or timestamp headings. Do not replay prior events.",
        { ...episode, plan: { ...writerPlan,
          events: writerPlan.events.map((event, index) => {
            const requiredActions = markedScenes.filter(assignment => assignment.event === index + 1);
            return requiredActions.length ? { ...event, requiredActions } : event;
          }),
        } }, draftSchema, 6500).catch(async error => {
          if (partialWrite) {
            const tentative = partialWrite.map(cleanProse).filter(Boolean);
            if (tentative.length) {
              checkpoint.writePreview = tentative;
              preview = manuscript(tentative);
              await save();
            }
          }
          throw error;
        });
      const parts = result.events.map(cleanProse);
      preview = manuscript(parts);
      checkpoint.events = draftSchema.parse({ events: parts }).events;
      checkpoint.writePreview = undefined;
      await save();
    }
    options.onDraftUpdate?.(manuscript(checkpoint.events));
    const report = () => {
      preview = manuscript(checkpoint.events!);
      options.onDraftProgress?.({ chars: storyChars(preview), events: 5 });
    };
    report();
    if (!checkpoint.copyedited) {
      if (openAIStylist || geminiStylist) {
        phase("copyediting");
        try {
          if (geminiStylist && !geminiKey) throw new Error("Missing Gemini API key");
          const original = checkpoint.events!;
          const result = await structured("style_edit", styleInstructions + "\n" + naming,
            { events: original, dialogueContext: {
              mainCharacter: { name: character.name, personality: character.personality },
              activeConcept: seriesConcept,
              baseConcept: character.concept,
              earlierConcepts,
              cast: old.characters.map(({ name, relationships }) => ({ name, relationships })),
              registers: old.dialogueRegisters?.map(({ speaker, addressee, style }) => ({ speaker, addressee, style })),
            } }, draftSchema, 6500, draftSchema, raw => {
              const parsed = parseStyleEditResponse(raw);
              if (!parsed) throw new SyntaxError("Invalid style edit response");
              if (parsed.format !== "json") trace.event("style_edit_response_recovered", { format: parsed.format });
              return parsed.draft;
            });
          const next = result.events.map(cleanProse);
          const edited = manuscript(next);
          const rejection = !draftSchema.safeParse({ events: next }).success ? "empty_event"
            : meetsMinimum(preview) && !meetsMinimum(edited) ? "below_minimum"
            : findRepeatedPassage(edited) ? "repeated_passage" : undefined;
          if (rejection) {
            trace.event("style_edit_skipped", { reason: rejection });
          } else {
            checkpoint.styleOriginal = original;
            checkpoint.styleEvents = next.flatMap((event, index) => event === original[index] ? [] : [index + 1]);
            checkpoint.events = next;
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof SyntaxError || error instanceof TypeError || error instanceof z.ZodError || error instanceof NovelUpstreamError ||
            error instanceof NovelOutputLimitError || error instanceof Error &&
            ["Missing Gemini API key", "Invalid Gemini base URL", "Incomplete novel stage", "Empty novel stage"].includes(error.message))) throw error;
          const reason = error instanceof SyntaxError || error instanceof z.ZodError ? "invalid_response_format"
            : error instanceof NovelOutputLimitError ? "output_token_limit"
            : error instanceof NovelUpstreamError ? "provider_http_error"
            : error instanceof TypeError ? "transport_failure" : error.message;
          trace.event("style_edit_skipped", { reason, ...(error instanceof NovelUpstreamError ? error.diagnostics : {}) });
        }
      } else if (hasProofreader) {
        phase("copyediting");
        try {
          const edited = await structured("proofread", proofreadingInstructions + "\n" + naming,
            { manuscript: preview, previousEnding: old.previousEnding, worldFacts: old.worldFacts },
            z.object({ edits: z.array(z.unknown()).max(12) }), 3200, proofreadingEditsSchema);
          const raw = JSON.stringify(edited);
          const next = checkpoint.events.map(event => applyProofreading(event, raw).text);
          const global = applyProofreading(preview, raw).text;
          if (manuscript(next) === global && draftSchema.safeParse({ events: next }).success &&
              (!meetsMinimum(preview) || meetsMinimum(global)) && stripStoryMetadata(global) === global && !findRepeatedPassage(global)) checkpoint.events = next;
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof SyntaxError || error instanceof z.ZodError || error instanceof NovelUpstreamError || error instanceof NovelOutputLimitError ||
            error instanceof Error && ["Incomplete novel stage", "Empty novel stage"].includes(error.message))) throw error;
        }
      }
      checkpoint.copyedited = true;
      await save();
    }
    for (;;) {
      const pendingCopyedit = checkpoint.pendingRepairCopyedit;
      if (pendingCopyedit?.length) {
        if (hasProofreader) {
          phase("copyediting");
          const parts = checkpoint.events!;
          const passages = pendingCopyedit.map(({ event, start, text }, index) => {
            const prose = parts[event - 1];
            return {
              passage: index + 1, text,
              left: prose.slice(Math.max(0, start - 160), start),
              right: prose.slice(start + text.length, start + text.length + 160),
            };
          });
          try {
            const { edits } = await structured("repair_proofread",
              "Copyedit only each supplied Korean passage's text. Read left and right as context. Polish word choice, emotional nuance and sentence rhythm while preserving meaning, speaker, register, actions, facts and the actual repair. Preserve quotation marks and paragraph structure. Return the passage number and its full edited text. Omit passages that need no changes.\n" +
              koreanTimeNumberInstructions + "\n" + naming,
              { passages }, repairCopyeditSchema, 1800);
            const revised = [...parts];
            const changes = edits.flatMap(edit => {
              const span = pendingCopyedit[edit.passage - 1];
              if (!span || edits.filter(other => other.passage === edit.passage).length !== 1 ||
                  edit.text === span.text || stripStoryMetadata(edit.text) !== edit.text ||
                  (edit.text.match(/["“”]/gu)?.length ?? 0) !== (span.text.match(/["“”]/gu)?.length ?? 0)) return [];
              const prose = parts[span.event - 1];
              return prose.slice(span.start, span.start + span.text.length) === span.text ? [{ ...span, revisedText: edit.text }] : [];
            }).sort((a, b) => b.start - a.start);
            for (const { event, start, text, revisedText } of changes) {
              const prose = revised[event - 1];
              revised[event - 1] = prose.slice(0, start) + revisedText + prose.slice(start + text.length);
            }
            const result = manuscript(revised);
            if (changes.length && meetsMinimum(result) && !findRepeatedPassage(result)) {
              checkpoint.events = revised;
              trace.event("repair_proofread_applied", { edits: changes.length });
            }
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof SyntaxError || error instanceof z.ZodError || error instanceof NovelUpstreamError ||
                error instanceof NovelOutputLimitError || error instanceof Error &&
                ["Incomplete novel stage", "Empty novel stage"].includes(error.message))) throw error;
            trace.event("repair_proofread_skipped", { reason: "copyedit_unavailable" });
          }
        }
        checkpoint.pendingRepairCopyedit = undefined;
        await save();
      }
      report();
      phase("reviewing");
      const parts: string[] = checkpoint.events!;
      const events = parts.map((text, i) => ({ number: i + 1, beat: beats[i], text }));
      let offset = 0;
      const units = events.flatMap(({ text, number }) => manuscriptSources(text)
        .map(unit => ({ ...unit, id: "source_" + ++offset, event: number })));
      const lookup = new Map(units.map((unit, position) => [unit.id, { text: unit.text, event: unit.event, position }]));
      const cite = z.enum(units.map(unit => unit.id) as [string, ...string[]]);
      const reviewSchema = (finale ? createFinalReviewSchema(cite) : createReviewSchema(cite)).required({ sceneAudit: true });
      const styleSources = checkpoint.styleOriginal && checkpoint.styleEvents?.length
        ? checkpoint.styleEvents.map(event => ({ event, original: checkpoint.styleOriginal![event - 1] })) : [];
      const schema = reviewSchema.extend({
        eventAudit: eventAuditSchema(cite),
        advisoryIssues: reviewSchema.shape.blockingIssues.optional(),
        memoryPatch: createMemoryPatchSchema(cite).required({ sharedChanges: true, dialogueRegisters: true, propChanges: true }).nullable(),
        edits: editsSchema, ...promiseAuditFields(promises.length, cite),
        ...(conceptRules.length ? { conceptRuleAudit: conceptRuleAuditSchema(cite, conceptRules.length) } : {}),
        ...(dueMarkedEvents.length ? { markedEventAudit: markedEventAuditSchema(cite, dueMarkedEvents.length) } : {}),
        ...(styleSources.length ? { styleReverts: z.unknown().optional() } : {}),
      });
      const wireSchema = schema.required({ advisoryIssues: true }).extend(styleSources.length ? { styleReverts: styleRevertsSchema } : {});
      const input = { ...episode, ...markedContext, previousProse: old.previousProse, sourceUnits: sourceContext(units),
        events: events.map(({ number, beat }) => ({ number, beat, sourceIds: units.filter(unit => unit.event === number).map(unit => unit.id) })),
        length: storyChars(preview), minimum: MIN_STORY_CHARS,
        ...(styleSources.length ? { styleSources } : {}) };
      const cachedReview = schema.safeParse(checkpoint.review);
      const verdict = cachedReview.success ? cachedReview.data : await structured("chapter_review",
        rules + "\n" + novelReviewerQualityInstructions + "\n" + sceneContextChecks + " " + residenceChecks +
        "\nJudge conceptAlignment against the full user concepts even if conceptRules is empty. Compare the on-page consequence to the required direction of change, and on the finale check that the requested outcome actually happens. If a central recurring activity is due in this installment, cite where it actually happens and affects a character. A promise, setup or departure toward it is not the activity itself. Allow an installment devoted to a different beat when the activity is neither due nor being repeatedly deferred. Do not treat a theme mention or agreement with a conflicting outline as fulfillment. " +
        "\n" + materialReview + " Use supplied source IDs in every evidence field. Use an empty fix string for passing concept alignment or resolution. Include significant shared changes, registers and prop ownership in memory. Use memoryPatch=null when a material error prevents publishing. " +
        eventAuditInstructions + " " + (promises.length ? promiseReviewInstructions : "") + " " +
        (conceptRules.length ? conceptRuleAuditInstructions : "") + " " + (dueMarkedEvents.length ? markedReviewInstructions : "") + " " + usableEdit +
        (styleSources.length ? " Compare each styleSources original to the revised event's source units. In styleReverts list events whose facts, actions, dialogue intent, clues, order, viewpoint or outcome changed, or where any story content was added or omitted. Accept expression-only changes. Use [] if none changed." : ""),
        input, schema, novelReviewMaxOutputTokens(), wireSchema);
      if (styleSources.length) {
        const reported = styleRevertsSchema.safeParse(verdict.styleReverts);
        const usable = reported.success && reported.data.every(event => styleSources.some(source => source.event === event));
        const restored = usable ? styleSources.filter(source => reported.data.includes(source.event)) : styleSources;
        if (restored.length) {
          checkpoint.events = parts.map((event, index) => restored.find(source => source.event === index + 1)?.original ?? event);
          checkpoint.styleEvents = [];
          checkpoint.review = undefined;
          await save();
          trace.event("style_events_restored", { events: restored.map(source => source.event), ...(!usable ? { reason: "invalid_style_review" } : {}) });
          continue;
        }
      }
      const resolved = resolveSources(verdict, units);
      const promise = inspectPromiseAudit(promises, resolved.promiseAudit, preview);
      const advisoryIssues = [...(resolved.advisoryIssues ?? []), ...resolved.blockingIssues.filter(issue => issue.type === "missing_beat")];
      const conceptIssues = conceptRules.length ? conceptRuleViolations(verdict.conceptRuleAudit, conceptRules, id => lookup.get(id), event => {
        const part = parts[event - 1];
        return units.findLast(unit => unit.event === event && unit.text.trim() && unit.text.length < part.length &&
          part.indexOf(unit.text) === part.lastIndexOf(unit.text))?.text;
      }) : [];
      const markedAudit = dueMarkedEvents.length ? markedEventAuditSchema(cite, dueMarkedEvents.length).parse(verdict.markedEventAudit) : [];
      const uncertain = markedAudit.flatMap((entry, index) =>
        (entry.fulfilled ? !entry.source : !!entry.source) ? [index] : []);
      const confirmed = new Map<number, z.infer<ReturnType<typeof markedEvidenceReviewSchema>>["findings"][number]>();
      if (uncertain.length) {
        trace.event("marked_evidence_recheck", { requirements: uncertain.map(index => index + 1) });
        const result = await structured("marked_evidence_review", markedEvidenceReviewInstructions,
          { chapter, sourceUnits: input.sourceUnits, events: input.events,
            requirements: uncertain.map(index => ({ text: dueMarkedEvents[index], sourceHint: markedAudit[index].source })) },
          markedEvidenceReviewSchema(cite, uncertain.length), 2600);
        result.findings.forEach((finding, index) => confirmed.set(uncertain[index], finding));
      }
      const markedIssues = markedAudit
        .flatMap((entry, index) => {
          const assignment = markedScenes[index];
          const finding = confirmed.get(index);
          const source = finding ? finding.source : entry.source;
          const cited = source ? lookup.get(source) : undefined;
          const status = finding?.status ?? (entry.fulfilled ? "fulfilled" : "missing");
          if (status === "fulfilled" && cited) {
            if (cited.event !== assignment.event || cited.event !== entry.event)
              trace.event("marked_evidence_resolved", { requirement: index + 1, event: cited.event, assignedEvent: assignment.event, source });
            return [];
          }
          const partial = status === "partial" && !!cited;
          const event = partial ? cited.event : assignment.event;
          const repairable = status === "missing" || partial;
          const isAnchor = (unit: { text: string; event: number }) => unit.event === event && unit.text.length <= 400 &&
            parts[event - 1].indexOf(unit.text) === parts[event - 1].lastIndexOf(unit.text);
          const anchor = partial && isAnchor(cited) ? cited : repairable ? units.findLast(isAnchor) : undefined;
          return [{ type: "continuity" as const, event, evidence: anchor?.text ?? null, assignment,
            partial, fix: finding?.fix ?? entry.fix }];
        });
      if (markedIssues.length) trace.event("marked_events_missing", { events: markedIssues.map(issue => issue.event) });
      if (conceptIssues.length) trace.event("concept_audit_findings", {
        rules: conceptIssues.map(({ rule, status, event, anchor }) => ({ rule, status, event, anchor })),
      });
      const issues = [...resolved.blockingIssues.filter(issue => issue.type !== "missing_beat"), ...inspectEventAudit(verdict.eventAudit, id => lookup.get(id)),
        ...conceptIssues, ...markedIssues];
      const repeatedPassage = findRepeatedPassage(preview);
      const canonical = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");
      const repeated = repeatedPassage && (repeatedPassage.kind === "action" ||
        canonical(repeatedPassage.first) === canonical(repeatedPassage.repeated)) ? repeatedPassage : undefined;
      const possibleRepeat = !repeated && (repeatedPassage ||
        parts.map((text, i) => findReplayedInsertion(text, manuscript(parts.slice(0, i)))).find(Boolean));
      const resolution = "resolution" in resolved ? resolved.resolution as z.infer<ReturnType<typeof createFinalReviewSchema>>["resolution"] : undefined;
      const endingValid = !finale || !!resolution && resolution.centralConflictResolved && resolution.protagonistOutcomeShown &&
        resolution.relationshipOutcomeShown && !resolution.hasSequelHook;
      const memory = resolved.memoryPatch;
      const memoryValid = memory && !unsupportedPropChanges(old.propStates ?? [], memory.propChanges ?? [], preview).length &&
        !unjustifiedRegisterChanges(old.dialogueRegisters ?? [], memory.dialogueRegisters ?? [], preview).length;
      const accepted = resolved.conceptAlignment.satisfied &&
        !issues.length && promise.accepted && endingValid && meetsMinimum(preview) && !repeated &&
        !repeatsPrevious(preview, old.previousProse) && memoryValid;
      trace.event("review_decision", { accepted: Boolean(accepted), repaired: Boolean(checkpoint.repaired),
        issues: issues.map(issue => issue.type), advisoryIssues: advisoryIssues.map(issue => issue.type),
        possibleRepeat: Boolean(possibleRepeat), chars: storyChars(preview) });
      if (accepted && memory) {
        const state = mergeMemory({ ...old, seriesArc: series.arc, outlineVersion: 1, seriesStartChapter, seriesConcept, conceptHistory, conceptRules,
          ...(markedSchedule ? { markedSchedule, markedConceptHash } : old.markedSchedule ? { markedSchedule: undefined, markedConceptHash: undefined } : {}) },
          memory, preview, series.arc.endingPromise);
        if (finale) state.nextChapterGoal = "";
        checkpoint.review = confirmed.size ? {
          ...verdict,
          markedEventAudit: markedAudit.map((entry, index) => {
            const finding = confirmed.get(index);
            const cited = finding?.source ? lookup.get(finding.source) : undefined;
            return cited ? { fulfilled: true, source: finding!.source, event: cited.event, fix: "" } : entry;
          }),
        } : verdict;
        await save();
        trace.event("completed", { calls, inputChars, events: 5, ...manuscriptFingerprint(preview) }, { prose: preview });
        return { text: preview, state, expectedChapter: old.chapter, sharedChanges: memory.sharedChanges ?? [],
          closedPromises: [...memory.closedThreads.map(item => item.text).filter(text => !promises.some(p => p.text === text)), ...promise.closed] };
      }
      const missingScenes = new Set(markedIssues.map(issue => issue.event));
      const repairIssues = missingScenes.size ? markedIssues : conceptIssues;
      if (!checkpoint.repaired && !repairIssues.some(issue => issue.evidence === null)) {
        phase("rewriting");
        const tryEdits = (edits: z.infer<typeof editsSchema>): ReturnType<typeof applyEventEdits> | undefined => {
          try { return edits.length ? applyEventEdits(parts, edits) : undefined; }
          catch (error) {
            if (!(error instanceof z.ZodError || error instanceof Error &&
              ["Invalid local novel edit", "Invalid dialogue edit", "Invalid proofreading anchor"].includes(error.message))) throw error;
            return undefined;
          }
        };
        let next = missingScenes.size ? undefined : tryEdits(verdict.edits);
        if (!next) {
          try {
            const repair = await structured("passage_repair", rules + "\n" + usableEdit + (missingScenes.size
              ? " Edit only the numbered events listed in issues. Make the actor perform each missing concrete action now and show its consequence in the passage. For partial fulfillment, complete only the missing step or consequence and keep actions already performed from happening again. Preserve the exact required means. A future plan, recollection, and substitute action do not fix the omission. Keep the adjacent events unchanged."
              : ""),
              missingScenes.size ? { events, issues: markedIssues, length: input.length, minimum: input.minimum }
                : { events, plan, issues, repeated, scene: resolved.sceneAudit, concept: resolved.conceptAlignment,
                  seriesConcept, earlierConcepts, characterConcept: character.concept, conceptRules, ...markedContext,
                  resolution, promises: promise.items, length: input.length, minimum: input.minimum },
              z.object({ edits: editsSchema }).strict(), 2600);
            if (!missingScenes.size || repair.edits.every(edit => missingScenes.has(edit.event)) &&
              [...missingScenes].every(event => repair.edits.some(edit => edit.event === event && edit.before !== edit.after))) {
              next = tryEdits(repair.edits);
            }
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof z.ZodError || error instanceof SyntaxError)) throw error;
          }
        }
        if (next && manuscript(next.events) !== preview) {
          checkpoint.events = next.events;
          if (hasProofreader && next.passages.length) checkpoint.pendingRepairCopyedit = next.passages;
          checkpoint.repaired = true;
          checkpoint.review = undefined;
          await save();
          continue;
        }
      }
      checkpoint.blocked = true;
      checkpoint.blockedByPolicy = reviewPolicy;
      await save();
      throw new StoryDraftPaused(meetsMinimum(preview) ? "quality" : "length");
    }
  } catch (error) {
    if (preview.trim() || streamedWrite) options.onDraftPreview?.(preview.trim() ? preview : streamedWrite);
    trace.event("failed", { stage, ...(error instanceof NovelUpstreamError ? error.diagnostics : {}),
      reason: signal.aborted ? "cancelled_or_timeout" : error instanceof StoryDraftPaused ? "story_draft_" + error.reason :
        error instanceof NovelOutputLimitError ? "output_token_limit" : error instanceof z.ZodError ? "invalid_stage_output" : "generation_failed" });
    throw error;
  }
}
