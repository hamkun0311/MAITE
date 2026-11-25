import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { generateChapter, novelJsonSchema } from "../lib/novel/generate.ts";
import { createReviewSchema, createMemoryPatchSchema, emptyStoryState, mergeMemory, repeatsPrevious, storyStateSchema } from "../lib/novel/state.ts";
import { findRepeatedPassage, findReplayedInsertion } from "../lib/novel/repetition.ts";
import { inspectEventAudit } from "../lib/novel/event-audit.ts";
import { z } from "zod";
import { POST } from "../app/api/chat/route.ts";
import { manuscriptSources, resolveSources } from "../lib/novel/sources.ts";
import { emptyTimeline } from "../lib/chat/timeline.ts";
import {novelTimelineContext,sourceContext} from "../lib/novel/context.ts";
import { formatStoryForReading, stripStoryMetadata } from "../lib/novel/scene-headings.ts";
import { MIN_STORY_CHARS, missingEventTransition, recoverEventEvidence, storyChars, StoryDraftPaused, type StoryCheckpoint } from "../lib/novel/checkpoint.ts";
import {novelDialogueRules} from "../lib/novel/dialogue.ts";
import { applyDialogueEdits, applyNarrationEdits, applyProofreading } from "../lib/novel/proofread.ts";
import {novelWriterQualityInstructions,novelReviewerQualityInstructions} from "../lib/novel/quality.ts";
import {createNovelReviewLogger,novelReviewLogLevel,manuscriptFingerprint,logNovelDocumentSaved} from "../lib/novel/review-log.ts";
import { conceptRuleViolations, markedConceptEvents, novelConceptInstructions, scheduleMarkedEvents } from "../lib/novel/concept.ts";
import { parseStyleEditResponse } from "../lib/novel/style-edit.ts";
import { streamedDraftParagraphs } from "../lib/novel/draft-stream.ts";
import { novelRetryDelay, NovelUpstreamError } from "../lib/novel/upstream-error.ts";
import {openAIImageEndpoint, openAIImageKey, openAIResponsesEndpoint, openAITextKey} from "../lib/openai-endpoint.ts";
import { textModel } from "../lib/ai-model.ts";

test("OpenAI text and image select endpoints and credentials independently", t => {
 const settings = {
  OPENAI_TEXT_PROVIDER:"direct", OPENAI_IMAGE_PROVIDER:"vnai",
  OPENAI_BASE_URL:"https://text-gateway.example/v1", OPENAI_IMAGE_BASE_URL:"",
  OPENAI_API_KEY:"official", OPENAI_TEXT_API_KEY:"gateway-text",
  OPENAI_IMAGE_API_KEY:"gateway-image", OPENAI_IMAGE_DIRECT_API_KEY:"official-image",
 };
 const keys=Object.keys(settings);
 const previous=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 Object.assign(process.env,settings);
 assert.equal(openAIResponsesEndpoint(),"https://api.openai.com/v1/responses");
 assert.equal(openAITextKey(),"official");
 assert.equal(openAIImageEndpoint("edits"),"https://text-gateway.example/v1/images/edits");
 assert.equal(openAIImageKey(),"gateway-image");
 process.env.OPENAI_TEXT_PROVIDER="vnai";
 delete process.env.OPENAI_BASE_URL;
 process.env.OPENAI_IMAGE_PROVIDER="direct";
 process.env.OPENAI_IMAGE_BASE_URL="https://image-gateway.example/v1";
 assert.equal(openAIResponsesEndpoint(),"https://apikey.vnaipro.app/v1/responses");
 assert.equal(openAITextKey(),"gateway-text");
 assert.equal(openAIImageEndpoint("generations"),"https://api.openai.com/v1/images/generations");
 assert.equal(openAIImageKey(),"official-image");
});

test("switching the OpenAI text provider selects its configured model", t => {
 const settings = { OPENAI_MODEL: "gpt-5.4-mini", OPENAI_VNAI_MODEL: "gpt-5.6-terra", OPENAI_TEXT_PROVIDER: "vnai" };
 for (const [key, value] of Object.entries(settings)) {
  const original = process.env[key];
  process.env[key] = value;
  t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
 }
 assert.equal(textModel(), "gpt-5.6-terra");
 assert.equal(textModel("direct"), "gpt-5.4-mini");
 process.env.OPENAI_TEXT_PROVIDER = "direct";
 assert.equal(textModel(), "gpt-5.4-mini");
 assert.equal(textModel("vnai"), "gpt-5.6-terra");
 delete process.env.OPENAI_VNAI_MODEL;
 assert.equal(textModel("vnai"), "gpt-5.4-mini");
});

const character = { mode: "story" as const, name: "서하", age: 25, personality: "다정함", concept: "친구와 서점 복구", genre: "막장드라마" as const, imageDescription: "서점의 탐정" };
const prose = "서하는 서랍에서 계약서를 찾았다. 그가 약속한 수리 날짜가 문서에 적혀 있었다. " + "그녀는 친구에게 전화를 걸어 내일 함께 서점을 정리하자고 말했다. 망설이던 친구가 수화기 너머에서 웃었다. " + "둘은 닫힌 서점 문을 열고 먼지 쌓인 책을 창가로 옮겼다. 새로 비워진 진열대 사이로 햇빛이 들어왔다. 오래 미뤄 두었던 일이 드디어 시작되었다. " + "친구가 가져온 달력에 수리 날짜를 표시했다. 내일 아침에는 창문을 닦기로 했다.";
const fact = { text: "계약서를 찾았다", evidence: "서하는 서랍에서 계약서를 찾았다." };
const seriesArc = { endingPromise: "서점을 다시 열고 친구와 함께 운영한다", installments: Array.from({ length: 5 }, (_, index) => ({ chapter: index + 1, goal: `${index + 1}편 목표`, payoff: `${index + 1}편 결과` })) };
const review = { pass: true, sceneAudit:{rolesStable:true,speechIntentClear:true,movementsConsistent:true,actionsCoherent:true}, conceptAlignment: { satisfied: true, evidence: fact.evidence, fix: "설정 준수" }, blockingIssues: [], completedBeats: [1, 2, 3], newEvents: [fact], endingChange: { text: "정리가 시작됨", evidence: "오래 미뤄 두었던 일이 드디어 시작되었다." } };
const patch = { summary: "서하가 계약서를 찾아 친구와 서점 정리를 시작했다.", currentSituation: fact,
  newEvents: [fact], resolvedEvents: [fact], openedThreads: [], closedThreads: [], worldFacts: [fact],
  characters: [{ name: "서하", goal: null, knowledge: [fact], relationships: [] }], nextChapterGoal: "창문을 닦는다",sharedChanges:[],dialogueRegisters:[],propChanges:[] };
const unpack = (value: any): any[] => Array.isArray(value)?value:value?.rows?.map((row:any[])=>Object.fromEntries(value.columns.map((name:string,index:number)=>[name,row[index]])))??[];
const response = (value: unknown, init?: RequestInit) => {
  if (value && typeof value === "object" && "pass" in value) value = { memoryPatch: patch, ...value };
  const body = init ? JSON.parse(String(init.body)) : undefined;
  const input = body ? JSON.parse(body.input) : {};
  if (value && typeof value === "object" && body?.text?.format?.name === "chapter_review" && !("eventAudit" in value)) {
   const first = unpack(input.sourceUnits)[0].text;
   value = {...value, eventAudit:[{eventKey:"fixture-event",depiction:"action",occurrenceStart:first,evidence:first,triggerEvidence:null}]};
  }
  if (value && typeof value === "object" && input.expandedSources?.length && !("insertionAudit" in value)) {
   const units = unpack(input.sourceUnits);
   value = { ...value, insertionAudit: input.expandedSources.map((range: {afterPassage:number;first:string}) => ({
    afterPassage:range.afterPassage, repeats:false, sequence:"fits", evidence:units.find(unit=>unit.id===range.first).text, fix:"-",
   })) };
  }
  const cite = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(cite);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === "evidence"||key==="occurrenceStart"||((key==="changeEvidence"||key==="triggerEvidence")&&child!==null)
      ? unpack(input.sourceUnits).find((unit: { id: string; text: string }) => typeof child === "string" && unit.text.includes(child))?.id ?? "unknown_source"
      : cite(child)]));
  };
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(init ? cite(value) : value) }] }] });
};

const expectedBeats = ["발단", "전개", "위기", "절정", "결말"];
const episodePlan = { goal: "서점 문을 다시 연다", conflict: "계약 조건을 확인해야 한다", decisiveChoice: "친구에게 계약서를 보여준다",
 payoff: "두 사람이 같이 정리하기로 한다",
 events: expectedBeats.map(beat => ({ entry: beat + "의 상황", action: beat + "의 선택", result: beat + "의 결과" })) };
const eventDraft = [prose + "가나다라".repeat(64), "마바사아".repeat(122), "하헤호휴".repeat(122), "느너나네".repeat(122), "파패포프".repeat(122)];
const acceptedReview = { ...review, completedBeats: [1, 2, 3, 4, 5], edits: [] };
const options = () => ({ character, direction: "이야기를 이어줘", key: "fixture", signal: new AbortController().signal, phase: () => {} });

test("concept checks distinguish future requirements, uncited omissions and uncited contradictions", () => {
 const rows = [
  { rule: 1, status: "not_due", source: null, repairEvent: null, fix: "" },
  { rule: 2, status: "missing", source: null, repairEvent: 2, fix: "첫 주문의 결과를 보여준다." },
  { rule: 3, status: "contradicted", source: null, repairEvent: 2, fix: "소지품의 주인을 확인한다." },
  { rule: 4, status: "missing", source: null, repairEvent: null, fix: "장면의 위치를 알 수 없다." },
 ];
 const issues = conceptRuleViolations(rows, ["결말에 범인 공개", "이번 화의 첫 주문", "열쇠 소유자", "이번 회차의 방문"],
  () => undefined, event => event === 2 ? "손에 쥔 지팡이가 떨렸다." : undefined);
 assert.deepEqual(issues.map(({ rule, event, evidence, anchor }) => ({ rule, event, evidence, anchor })), [
  { rule: 2, event: 2, evidence: "손에 쥔 지팡이가 떨렸다.", anchor: "planned_event" },
  { rule: 3, event: null, evidence: null, anchor: "unlocated" },
  { rule: 4, event: null, evidence: null, anchor: "unlocated" },
 ]);
});

test("an uncited due condition repairs the planned event without redrafting or enforcing later outcomes", async t => {
 const due = "2화에서 주인공이 첫 주문에 성공한다.";
 const future = "마지막 화에서 범인이 밝혀진다.";
 const anchor = "주인공은 지팡이를 처음 들어 올렸다.";
 const corrected = anchor + " 이번에는 불꽃이 피어났다.";
 const events = [...eventDraft];
 events[1] += "\n\n" + anchor;
 const calls: string[] = [];
 let reviews = 0;
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write") return response({ events }, init);
  if (stage === "passage_repair") {
   assert.deepEqual(input.issues.map(({ status, event, evidence, anchor }: Record<string, unknown>) => ({ status, event, evidence, anchor })),
    [{ status: "missing", event: 2, evidence: anchor, anchor: "planned_event" }]);
   return response({ edits: [{ event: 2, before: anchor, after: corrected }] }, init);
  }
  assert.equal(stage, "chapter_review");
  const initial = ++reviews === 1;
  return response({ ...acceptedReview, conceptRuleAudit: [
   { rule: 1, status: initial ? "missing" : "compatible", source: null, repairEvent: initial ? 2 : null, fix: "주문의 성공을 보여준다." },
   { rule: 2, status: "not_due", source: null, repairEvent: null, fix: "" },
  ] }, init);
 });
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const,
  seriesConcept: due + " " + future, conceptRules: [due, future] };
 const result = await generateChapter({ ...options(), state });
 assert.equal(result.text, events.join("\n\n").replace(anchor, corrected));
 assert.deepEqual(calls, ["chapter_plan", "write", "chapter_review", "passage_repair", "chapter_review"]);
});

test("asterisk markers are distinct from bullets and explicit chapter numbers override the proposed schedule", () => {
 const events = markedConceptEvents("* 편지\n*7화에서 편지를 연다.* **약속을 바꾼다.** \\*표시가 아니다\\*");
 assert.deepEqual(events, ["7화에서 편지를 연다.", "약속을 바꾼다."]);
 assert.deepEqual(scheduleMarkedEvents(events, [[1], [4]], 1, 5), [[2], [4]]);
});

test("a due marked event without evidence is repaired locally and its schedule is saved", async t => {
 const due = "1화에서 봉인된 편지를 연다.";
 const future = "2화에서 약속 장소를 바꾼다.";
 const anchor = "주인공은 봉인된 편지를 들어 올렸다.";
 const corrected = "주인공은 봉인을 뜯고 편지를 펼쳤다.";
 const markedScene = { requirement: due, event: 2, actor: "주인공", action: "봉인을 뜯고 편지를 펼친다.", consequence: "편지를 읽을 수 있게 된다." };
 const events = [...eventDraft];
 events[1] += "\n\n" + anchor;
 const calls: string[] = [];
 let reviews = 0;
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  if (stage === "series_plan") {
   assert.deepEqual(input.markedEvents, [due, future]);
   return response({ arc: seriesArc, conceptRules: [], chapterPlan: { ...episodePlan, markedScenes: [] }, markedSchedule: [[2], [1]] }, init);
  }
  if (stage === "chapter_plan") {
   assert.deepEqual(input.dueMarkedEvents, [due]);
   assert.deepEqual(input.previous.markedScenes, []);
   return response({ ...episodePlan, markedScenes: [markedScene] }, init);
  }
  if (stage === "write") {
   assert.deepEqual(input.plan.events[1].requiredActions, [markedScene]);
   assert.equal(input.plan.events[0].requiredActions, undefined);
   return response({ events }, init);
  }
  if (stage === "marked_evidence_review") {
   assert.deepEqual(input.requirements, [{ text: due, sourceHint: null }]);
   return response({ findings: [{ status: "missing", source: null, fix: "봉인을 실제로 뜯는다." }] }, init);
  }
  if (stage === "passage_repair") {
   assert.match(body.instructions, /perform each missing concrete action now/);
   assert.equal(input.issues.at(-1).event, 2);
   assert.equal(input.issues.at(-1).evidence, anchor);
   return response({ edits: [{ event: 2, before: anchor, after: corrected }] }, init);
  }
  assert.equal(stage, "chapter_review");
  assert.deepEqual(input.dueMarkedEvents, [due]);
  const initial = ++reviews === 1;
  const evidence = initial ? null : input.events[1].sourceIds.at(-1);
  return response({ ...acceptedReview,
   edits: initial ? [{ event: 2, before: anchor, after: anchor + " 내일 열어 보기로 했다." }] : [],
   markedEventAudit: [{ fulfilled: true, source: evidence, event: initial ? 3 : 2, fix: "봉인을 실제로 뜯는다." }] }, init);
 });
 const result = await generateChapter({ ...options(), additionalConcept: `*${due}* *${future}*` });
 assert.deepEqual(result.state.markedSchedule, [[1], [2]]);
 assert.equal(result.text, events.join("\n\n").replace(anchor, corrected));
 assert.deepEqual(calls, ["series_plan", "chapter_plan", "write", "chapter_review", "marked_evidence_review", "passage_repair", "chapter_review"]);
});

for (const ambiguous of [false, true]) {
 test(ambiguous ? "ambiguous marked evidence is confirmed without replaying the action" : "marked evidence in an unplanned scene passes without another call", async t => {
  const due = "1화에서 주인공이 종을 울려 사람들을 불러 모은다.";
  const events = [...eventDraft];
  events[0] += "\n\n주인공이 종을 울리자 사람들이 광장으로 모여들었다.";
  const assigned = { requirement: due, event: 2, actor: "주인공", action: "종을 울린다.", consequence: "사람들이 모인다." };
  const calls: string[] = [];
  let source: string;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
   const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
   calls.push(stage);
   if (stage === "series_plan") return response({ arc: seriesArc, conceptRules: [], chapterPlan: { ...episodePlan, markedScenes: [assigned] }, markedSchedule: [[1]] }, init);
   if (stage === "write") return response({ events }, init);
   if (stage === "marked_evidence_review") {
    assert.equal(input.requirements[0].sourceHint, source);
    return response({ findings: [{ status: "fulfilled", source, fix: "" }] }, init);
   }
   assert.equal(stage, "chapter_review");
   source = input.events[0].sourceIds.at(-1);
   return response({ ...acceptedReview, markedEventAudit: [{ fulfilled: !ambiguous, source, event: 2, fix: "" }] }, init);
  });
  const result = await generateChapter({ ...options(), additionalConcept: `*${due}*` });
  assert.equal(result.text, events.join("\n\n"));
  assert.deepEqual(calls, ["series_plan", "write", "chapter_review", ...(ambiguous ? ["marked_evidence_review"] : [])]);
 });
}

test("a chapter streams complete draft paragraphs before editing or review and publishes only the final chapter", {timeout: 5000}, async t => {
 const draft = ["첫 문단.\n\n" + eventDraft[0], ...eventDraft.slice(1)];
 const json = JSON.stringify({ events: draft });
 const split = json.indexOf("\\n\\n") + 4;
 const calls: string[] = [];
 const usage: { feature: string; status: string; outputTokens: number | null }[] = [];
 const updates: string[] = [];
 let endWrite!: () => void;
 const firstDraft = Promise.withResolvers<void>();
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name;
  calls.push(stage);
  if (stage === "write") {
   assert.equal(body.stream, true);
   return new Response(new ReadableStream({
    start(controller) {
     const send = (event: object) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
     send({ type: "response.output_text.delta", delta: json.slice(0, split) });
     endWrite = () => {
      send({ type: "response.output_text.delta", delta: json.slice(split) });
      send({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 100, output_tokens: 200 } } });
      controller.close();
     };
    },
   }), { headers: { "Content-Type": "text/event-stream" } });
  }
  assert.equal(body.stream, undefined);
  if (stage === "chapter_plan") return response(episodePlan, init);
  assert.equal(stage, "chapter_review");
  assert.equal(updates.at(-1), draft.join("\n\n"));
  return response(acceptedReview, init);
 });
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 const generation = generateChapter({ ...options(), state, onUsage: record => usage.push(record), onDraftUpdate: text => {
  updates.push(text);
  firstDraft.resolve();
 } });
 await Promise.race([firstDraft.promise, generation.then(() => assert.fail("The draft arrived after generation"))]);
 assert.deepEqual(updates, ["첫 문단."]);
 assert.deepEqual(calls, ["chapter_plan", "write"]);
 endWrite();
 const result = await generation;
 assert.deepEqual(calls, ["chapter_plan", "write", "chapter_review"]);
 assert.equal(result.text, draft.join("\n\n"));
 assert.equal(usage.find(record => record.feature === "novel.write" && record.status === "completed")?.outputTokens, 200);
 assert.equal(streamedDraftParagraphs('{"events":["“먼저 가.”\\n\\n두 번째 진행 중'), "“먼저 가.”");
 assert.equal(streamedDraftParagraphs('{"other":"비공개","events":["본문'), "");
});

test("series and chapter planning use direct Mini while writing, style editing and review use VNAI Terra", async t => {
 const settings = {
  OPENAI_TEXT_PROVIDER: "vnai", OPENAI_BASE_URL: "https://apikey.vnaipro.app/v1",
  OPENAI_API_KEY: "plan-fixture", OPENAI_VNAI_MODEL: "gpt-5.6-terra",
  OPENAI_NOVEL_PLAN_PROVIDER: "direct", OPENAI_NOVEL_PLAN_MODEL: "gpt-5.4-mini",
  OPENAI_NOVEL_STYLE_MODEL: "gpt-5.6-terra", GEMINI_NOVEL_STYLE_MODEL: "gemini-fixture",
  OPENAI_NOVEL_WRITE_PROVIDER: "", OPENAI_NOVEL_WRITE_MODEL: "", GEMINI_NOVEL_WRITE_MODEL: "", CLAUDE_API_KEY: "",
 };
 for (const [key, value] of Object.entries(settings)) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
 }
 const calls: string[] = [];
 t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name;
  const planning = stage === "chapter_plan" || stage === "series_plan";
  calls.push(stage);
  assert.equal(url, planning ? "https://api.openai.com/v1/responses" : "https://apikey.vnaipro.app/v1/responses");
  assert.equal(new Headers(init.headers).get("Authorization"), planning ? "Bearer plan-fixture" : "Bearer fixture");
  assert.equal(body.model, planning ? "gpt-5.4-mini" : "gpt-5.6-terra");
  if (stage === "series_plan") return response({ arc: seriesArc, conceptRules: [], chapterPlan: episodePlan }, init);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write" || stage === "style_edit") return response({ events: eventDraft }, init);
  assert.equal(stage, "chapter_review");
  return response(acceptedReview, init);
 });
 const first = await generateChapter(options());
 await generateChapter({ ...options(), state: { ...first.state, previousProse: "이전 회차의 별도 원고." } });
 assert.deepEqual(calls, ["series_plan", "write", "style_edit", "chapter_review",
  "chapter_plan", "write", "style_edit", "chapter_review"]);
 assert.equal(first.text, eventDraft.join("\n\n"));
});

test("the five-beat pipeline plans a series, writes five events once, and only repairs the cited sentence", async t => {
 const routes = { OPENAI_TEXT_PROVIDER: "direct", OPENAI_BASE_URL: "https://apikey.vnaipro.app/v1",
  OPENAI_NOVEL_WRITE_PROVIDER: "vnai", OPENAI_NOVEL_WRITE_MODEL: "gpt-5.6-terra", OPENAI_TEXT_API_KEY: "writer-fixture" };
 for (const [name, value] of Object.entries(routes)) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
 }
 const broken = "서하는 문을�� 닫았다.", fixed = "서하는 문을 닫았다.";
 const original = [...eventDraft];
 original[1] = broken + " " + original[1];
 const calls: string[] = [];
 let approved = false;
 let saved: StoryCheckpoint | object = {};
 t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  assert.equal(url, stage === "write" ? "https://apikey.vnaipro.app/v1/responses" : "https://api.openai.com/v1/responses");
  assert.equal(new Headers(init.headers).get("Authorization"), stage === "write" ? "Bearer writer-fixture" : "Bearer fixture");
  if (stage === "series_plan") {
   assert.deepEqual(input.beats, expectedBeats);
   assert.equal(input.schedule.chapter, 1);
   assert.match(body.instructions, /required outcome through all five installments/);
   assert.match(body.instructions, /show the requested outcome in action/);
   assert.match(body.instructions, /Schedule representative on-page occurrences/);
   assert.match(body.instructions, /promises and travel to it can set it up, but do not fulfill it/);
   return response({ arc: seriesArc, conceptRules: [`“${character.concept}”`], chapterPlan: episodePlan }, init);
  }
  if (stage === "write") {
   assert.match(body.instructions, /1,800–2,200 characters including spaces/);
   assert.match(body.instructions, /360–440 characters per event/);
   assert.deepEqual(input.plan, episodePlan);
   assert.deepEqual(input.conceptRules, [character.concept]);
   assert.match(body.instructions, /여러 차례 주고받는 직접 대사/);
   assert.match(body.instructions, /what the characters do or say differently on this occasion/);
   return response({ events: original }, init);
  }
  assert.equal(stage, "chapter_review");
  assert.match(body.instructions, /full user concepts even if conceptRules is empty/);
  assert.match(body.instructions, /cite where it actually happens and affects a character/);
  const conceptRuleAudit = [{ rule: 1, status: "compatible", source: null, repairEvent: null, fix: "-" }];
  assert.deepEqual(input.events.map((event: { beat: string }) => event.beat), expectedBeats);
  const secondSources = unpack(input.sourceUnits).filter(unit => input.events[1].sourceIds.includes(unit.id));
  if (approved) {
   assert.ok(secondSources.some(unit => unit.text === fixed));
   return response({ ...acceptedReview, conceptRuleAudit }, init);
  }
  approved = true;
  assert.ok(secondSources.some(unit => unit.text === broken));
  return response({ ...acceptedReview, conceptRuleAudit, pass: false, memoryPatch: null,
   blockingIssues: [{ type: "language", evidence: broken, fix: fixed }],
   edits: [{ event: 2, before: broken, after: fixed }] }, init);
 });
 const request = () => generateChapter({ ...options(), draftStore: { load: saved, async save(value) { saved = structuredClone(value); } } });
 const result = await request();
 assert.equal(result.text, original.join("\n\n").replace(broken, fixed));
 assert.equal(result.state.chapter, 1);
 assert.equal(result.state.outlineVersion, 1);
 assert.deepEqual(calls, ["series_plan", "write", "chapter_review", "chapter_review"]);
 assert.equal((await request()).text, result.text);
 assert.equal(calls.length, 4);
});

test("a gateway 503 for an unavailable model does not retry the same route", () => {
 const error = (code: string) => new NovelUpstreamError("openai", 503, { error: { code } });
 assert.equal(novelRetryDelay(error("model_not_found"), 0), undefined);
 assert.equal(novelRetryDelay(error("system_cpu_overloaded"), 0), 1000);
});

test("style response recovery requires five identifiable events and keeps quoted text intact", () => {
 const events = ['그가 말했다. "이건 [안내]야."', "두 번째 {메모}", "셋", "넷", "다섯"];
 const json = JSON.stringify({ events });
 const marked = events.map((event, i) => `[EVENT ${i + 1}]\n${event}`).join("\n");
 assert.deepEqual(parseStyleEditResponse(json), { format: "json", draft: { events } });
 assert.deepEqual(parseStyleEditResponse("편집 결과\n\x60\x60\x60json\n" + json + "\n\x60\x60\x60\n끝"),
  { format: "wrapped_json", draft: { events } });
 assert.deepEqual(parseStyleEditResponse(marked + "\n[END EVENTS]"), { format: "marked_events", draft: { events } });
 for (const invalid of [events.join("\n\n"), marked, marked.replace("[EVENT 3]", "[EVENT 4]") + "\n[END EVENTS]",
  marked + "\n[END EVENTS]\n설명", json + "\n" + json, JSON.stringify({ events: events.slice(0, 4) })]) {
  assert.equal(parseStyleEditResponse(invalid), undefined);
 }
});

test("Gemini style editing replaces copyediting and restores an event that changed meaning", async t => {
 const env = { CLAUDE_API_KEY: "", OPENAI_NOVEL_WRITE_MODEL: "gpt-5.4-mini",
  OPENAI_NOVEL_PROOFREAD_MODEL: "unused-copyeditor", GEMINI_NOVEL_STYLE_MODEL: "gemini-3.5-flash-lite",
  GEMINI_PROVIDER: "direct", GEMINI_DIRECT_API_KEY: "fixture-key" };
 for (const [key, value] of Object.entries(env)) {
  const original = process.env[key];
  process.env[key] = value;
  t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
 }
 const original = [...eventDraft];
 const additionalConcept = "새로 만난 다온은 말수가 적고 필요한 말만 한다.";
 const earlierConcept = "서하는 동료 유리에게 존댓말을 쓴다.";
 original[0] = '다온이 손을 내밀었다. “열쇠 주세요.” ' + original[0];
 original[1] = "친구가 약속을 받아들였다. " + original[1];
 original[2] = "서하가 천천히 문을 열었다. " + original[2];
 const styled = original.map((event, i) => i === 1 ? event.replace("받아들였다", "거절했다")
  : i === 2 ? event.replace("천천히 문을 열었다", "느릿하게 문을 열었다") : event);
 const calls: string[] = [];
 let reviews = 0, unavailable = false, cleanEdit = false;
 let omittedStyleAudit = false;
 t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  if (url.includes("generativelanguage.googleapis.com")) {
   calls.push("style_edit");
   assert.match(url, /gemini-3\.5-flash-lite/);
   const input = JSON.parse(body.contents[0].parts[0].text);
   assert.deepEqual(input.events, original);
   assert.deepEqual(input.dialogueContext, {
    mainCharacter: { name: character.name, personality: character.personality },
    activeConcept: additionalConcept, baseConcept: character.concept, earlierConcepts: [earlierConcept],
    cast: [{ name: "서하", relationships: ["유리와 동료"] }],
    registers: [{ speaker: "서하", addressee: "유리", style: "polite" }],
   });
   assert.match(body.systemInstruction.parts[0].text, /new speakers introduced in the concepts/);
   assert.match(body.systemInstruction.parts[0].text, /speaker and actual addressee/);
   assert.match(body.systemInstruction.parts[0].text, /subjects, objects, particles and verb voice/);
   assert.match(body.systemInstruction.parts[0].text, /a denial and its explanation must fit together and answer the previous line/);
   if (unavailable) return Response.json({ error: { code: 401 } }, { status: 401 });
   const events = cleanEdit ? styled.map((event, i) => i === 1 ? original[i] : event) : styled;
   const editedText = cleanEdit ? events.map((event, i) => `[EVENT ${i + 1}]\n${event}`).join("\n") + "\n[END EVENTS]"
    : "편집 완료\n" + JSON.stringify({ events });
   return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: editedText }] } }] });
  }
  const stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  if (stage === "series_plan") return response({ arc: seriesArc, conceptRules: [], chapterPlan: episodePlan }, init);
  if (stage === "write") return response({ events: original }, init);
  assert.equal(stage, "chapter_review");
  if (omittedStyleAudit) {
   const text = unpack(input.sourceUnits).map(unit => unit.text).join(" ");
   assert.ok(text.includes(input.styleSources ? "약속을 거절했다" : "약속을 받아들였다"));
   return response({ ...acceptedReview, conceptAlignment: { ...acceptedReview.conceptAlignment, fix: "   " } }, init);
  }
  if (unavailable) { assert.equal(input.styleSources, undefined); return response(acceptedReview, init); }
  const restore = !cleanEdit && ++reviews === 1;
  assert.deepEqual(input.styleSources, restore || cleanEdit
   ? (restore ? [2, 3] : [3]).map(event => ({ event, original: original[event - 1] })) : undefined);
  const text = unpack(input.sourceUnits).map(unit => unit.text).join(" ");
  assert.ok(text.includes(restore ? "약속을 거절했다" : "약속을 받아들였다"));
  return response(restore || cleanEdit ? { ...acceptedReview, styleReverts: restore ? [2] : [] } : acceptedReview, init);
 });
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const, seriesConcept: earlierConcept,
  characters: [{ name: "서하", goal: "서점 복구", knowledge: [], relationships: ["유리와 동료"] }],
  dialogueRegisters: [{ speaker: "서하", addressee: "유리", style: "polite" as const, evidence: "유리 씨, 도와주시겠어요?" }],
 };
 const request = () => generateChapter({ ...options(), state, additionalConcept });
 const result = await request();
 assert.equal(result.text, styled.map((event, i) => i === 1 ? original[i] : event).join("\n\n"));
 assert.deepEqual(calls.splice(0), ["series_plan", "write", "style_edit", "chapter_review", "chapter_review"]);
 cleanEdit = true;
 const clean = await request();
 assert.equal(clean.text, result.text);
 assert.deepEqual(calls.splice(0), ["series_plan", "write", "style_edit", "chapter_review"]);
 unavailable = true;
 const fallback = await request();
 assert.equal(fallback.text, original.join("\n\n"));
 assert.deepEqual(calls.splice(0), ["series_plan", "write", "style_edit", "chapter_review"]);
 unavailable = false;
 cleanEdit = false;
 omittedStyleAudit = true;
 const recovered = await request();
 assert.equal(recovered.text, original.join("\n\n"));
 assert.deepEqual(calls, ["series_plan", "write", "style_edit", "chapter_review", "chapter_review"]);
});

test("Gemini copyedits only the applied repair spans before the final review", async t => {
 const env = { CLAUDE_API_KEY: "", OPENAI_NOVEL_WRITE_MODEL: "gpt-5.6-terra", OPENAI_NOVEL_PROOFREAD_MODEL: "",
  GEMINI_NOVEL_PROOFREAD_MODEL: "gemini-3.5-flash-lite", GEMINI_PROVIDER: "direct", GEMINI_DIRECT_API_KEY: "fixture-key" };
 const originalEnv = Object.entries(env).map(([key, value]) => [key, process.env[key], value] as const);
 for (const [key, , value] of originalEnv) process.env[key] = value;
 t.after(() => {
  for (const [key, value] of originalEnv) {
   if (value === undefined) delete process.env[key];
   else process.env[key] = value;
  }
 });
 const original = [...eventDraft];
 const before = ["서하는 그걸 닫아졌다.", "친구는 구겨진 문서로 웃겼다."];
 const fixed = ["서하는 문을 조용히 닫았다.", "친구는 안도하며 계약서를 접었다."];
 const polished = ["서하는 소리가 나지 않게 문을 닫았다.", "친구는 가만히 한숨을 내쉬며 계약서를 접었다."];
 const time = "퇴근 열 분 전이었다. 열 번째 손님이 캔음료 두 개를 샀다.";
 original[1] = before.join(" ") + " " + time + " " + original[1];
 const calls: string[] = [];
 let reviews = 0, proofreads = 0;
 t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  if (url.includes("generativelanguage.googleapis.com")) {
   assert.match(url, /gemini-3\.5-flash-lite/);
   const instructions = body.systemInstruction.parts[0].text;
   assert.match(instructions, /기수.*서수/);
   assert.match(instructions, /폐점 10분 전/);
   assert.match(instructions, /열 번째 손님/);
   const input = JSON.parse(body.contents[0].parts[0].text);
   const repair = ++proofreads === 2;
   calls.push(repair ? "repair_proofread" : "proofread");
   if (repair) {
    assert.deepEqual(input.passages.map(({ text }: { text: string }) => text), fixed);
    assert.equal(input.passages[1].left.trim(), fixed[0]);
    assert.ok(!JSON.stringify(input).includes(original[4]));
    assert.equal(input.manuscript, undefined);
   }
   const edits = repair ? polished.map((text, index) => ({ text, passage: index + 1 }))
    : [{ before: "퇴근 열 분 전", after: "퇴근 10분 전" }];
   return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ edits }) }] } }] });
  }
  const stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write") return response({ events: original }, init);
  assert.equal(stage, "chapter_review");
  if (++reviews === 2) {
   const unitText = unpack(input.sourceUnits).map(unit => unit.text);
   assert.ok(polished.every(text => unitText.includes(text)));
   return response(acceptedReview, init);
  }
  return response({ ...acceptedReview, pass: false, memoryPatch: null,
   blockingIssues: [{ type: "language", evidence: before[0], fix: fixed[0] }],
   edits: fixed.map((after, index) => ({ event: 2, before: before[index], after })),
  }, init);
 });
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 const result = await generateChapter({ ...options(), state });
 assert.equal(result.text, original.join("\n\n").replace(before[0], polished[0]).replace(before[1], polished[1]).replace("퇴근 열 분 전", "퇴근 10분 전"));
 assert.deepEqual(calls, ["chapter_plan", "write", "proofread", "chapter_review", "repair_proofread", "chapter_review"]);
});

test("chapter length accepts the minimum and longer prose without a maximum", async t => {
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 let events: string[] = [];
 const stages: string[] = [];
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name;
  stages.push(stage);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write") return response({ events }, init);
  if (stage === "passage_repair") return response({ edits: [] }, init);
  const input = JSON.parse(body.input);
  assert.equal(input.minimum, MIN_STORY_CHARS);
  assert.equal(input.maximum, undefined);
  return response(acceptedReview, init);
 });
 for (const length of [1499, 1500, 2650, 4000, 5000, 9000]) {
  stages.length = 0;
  const contentLength = length - prose.length - 8;
  const slot = Math.floor(contentLength / 4);
  const words = ["마바사유", "차카타호", "겨녀더려", "느뉘거너"];
  events = [prose, ...words.map((word, index) =>
   word.repeat(contentLength).slice(0, index === 3 ? contentLength - slot * 3 : slot))];
  if (length < MIN_STORY_CHARS) {
   await assert.rejects(generateChapter({ ...options(), state }), { reason: "length" });
   assert.equal(stages.at(-1), "passage_repair");
  } else {
   const result = await generateChapter({ ...options(), state });
   assert.equal(storyChars(result.text), length);
   assert.equal(result.state.previousProse, result.text);
   assert.deepEqual(stages, ["chapter_plan", "write", "chapter_review"]);
  }
 }
});

test("advisory wording and a missing outline detail do not spend a repair or second review", async t => {
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 const calls: string[] = [];
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name;
  calls.push(stage);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write") return response({ events: eventDraft }, init);
  assert.equal(stage, "chapter_review");
  assert.ok(body.text.format.schema.required.includes("advisoryIssues"));
  return response({
   ...acceptedReview, pass: false, completedBeats: [1, 2, 4, 5],
   sceneAudit: { ...review.sceneAudit, actionsCoherent: false },
   advisoryIssues: [{ type: "language", evidence: fact.evidence, fix: "조사를 다듬을 수 있다." }],
   blockingIssues: [{ type: "missing_beat", evidence: fact.evidence, fix: "서랍을 여는 동작이 생략됐다." }],
  }, init);
 });
 const result = await generateChapter({ ...options(), state });
 assert.equal(result.text, eventDraft.join("\n\n"));
 assert.equal(result.state.chapter, 2);
 assert.deepEqual(calls, ["chapter_plan", "write", "chapter_review"]);
});

test("the review policy rechecks a stopped draft and accepts multiple sources for one occurrence", async t => {
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 const handoff = "토모가 영수증을 건넸다.";
 const reading = "햄군이 영수증을 펴고 퇴근 후 만나자는 문장을 읽었다.";
 const events = [handoff + " " + reading + " " + eventDraft[0], ...eventDraft.slice(1)];
 let saved: StoryCheckpoint | object = { chapterPipeline: {
  version: 1, series: { arc: seriesArc, conceptRules: [] }, plan: episodePlan,
  events, copyedited: true, repaired: true, blocked: true, blockedByPolicy: "material-v1",
 } };
 const calls: string[] = [];
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const stage = JSON.parse(String(init.body)).text.format.name;
  calls.push(stage);
  assert.equal(stage, "chapter_review");
  const occurrence = { eventKey: "토모_메모로_만남_요청", depiction: "action", occurrenceStart: handoff, triggerEvidence: null };
  return response({ ...acceptedReview, advisoryIssues: [], eventAudit: [
   { ...occurrence, evidence: handoff }, { ...occurrence, evidence: reading },
  ] }, init);
 });
 const result = await generateChapter({ ...options(), state,
  draftStore: { load: saved, async save(value) { saved = structuredClone(value); } } });
 assert.equal(result.state.chapter, 2);
 assert.equal(result.text, events.join("\n\n"));
 assert.deepEqual(calls, ["chapter_review"]);
});

test("following chapters reuse the arc, while added concepts replan five with continuous numbering", async t => {
 const calls: string[] = [];
 const additionalConcept = "내 이름은 루나. 동생이 돌아온다.";
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  const label = calls.includes("series_plan") ? "루나" : "책갈피";
  assert.equal(input.character.userLabel, label);
  assert.ok(body.instructions.includes(`Current resolved label: "${label}"`));
  assert.match(body.instructions, /Never call this person 사용자, 유저, 화자 or 독자/);
  if (stage === "series_plan") {
   assert.equal(input.seriesConcept, additionalConcept);
   assert.equal(input.completedInstallments, 0);
   assert.equal(input.schedule.chapter, 1);
   return response({ arc: seriesArc, conceptRules: [], chapterPlan: episodePlan }, init);
  }
  if (stage === "chapter_plan") {
   assert.equal(input.chapter, 4);
   assert.equal(input.schedule.chapter, 4);
   return response(episodePlan, init);
  }
  if (stage === "write") return response({ events: eventDraft }, init);
  assert.equal(stage, "chapter_review");
  return response(acceptedReview, init);
 });
 const previous = { ...emptyStoryState(), chapter: 3, seriesArc, outlineVersion: 1 as const };
 const request = { ...options(), character: { ...character, userName: "책갈피" }, state: previous };
 const continued = await generateChapter(request);
 assert.equal(continued.state.chapter, 4);
 assert.deepEqual(calls, ["chapter_plan", "write", "chapter_review"]);
 calls.length = 0;
 const restarted = await generateChapter({ ...request, additionalConcept });
 assert.equal(restarted.state.chapter, 4);
 assert.equal(restarted.state.seriesStartChapter, 3);
 assert.deepEqual(calls, ["series_plan", "write", "chapter_review"]);
 assert.equal(previous.chapter, 3);
});

test("a failed review keeps a readable draft and never replaces a whole event or advances memory", async t => {
 const calls: string[] = [];
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 let preview = "", saved: StoryCheckpoint | object = {};
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name;
  calls.push(stage);
  if (stage === "chapter_plan") return response(episodePlan, init);
  if (stage === "write") return response({ events: eventDraft }, init);
  if (stage === "chapter_review") return response({ ...acceptedReview, pass: false, memoryPatch: null, completedBeats: [1, 2, 3, 4] }, init);
  assert.equal(stage, "passage_repair");
  return response({ edits: [{ event: 2, before: eventDraft[1], after: "새 사건 전체" }] }, init);
 });
 const request = () => generateChapter({ ...options(), state, onDraftPreview: text => { preview = text; },
  draftStore: { load: saved, async save(value) { saved = structuredClone(value); } } });
 await assert.rejects(request(), StoryDraftPaused);
 assert.equal(state.chapter, 1);
 assert.equal(preview, eventDraft.join("\n\n"));
 assert.deepEqual(calls, ["chapter_plan", "write", "chapter_review", "passage_repair"]);
 await assert.rejects(request(), StoryDraftPaused);
 assert.equal(calls.length, 4);
});

test("a legacy arc replans only the unwritten milestones and the fifth chapter closes the series", async t => {
 const calls: string[] = [];
 const previous = { ...emptyStoryState(), chapter: 4, seriesArc };
 const replanned = { ...seriesArc, installments: seriesArc.installments.map(part => ({ ...part, goal: "새 목표 " + part.chapter })) };
 t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.text.format.name, input = JSON.parse(body.input);
  calls.push(stage);
  if (stage === "series_plan") {
   assert.deepEqual(input.pastMilestones, seriesArc.installments.slice(0, 4));
   assert.equal(input.schedule.phase, "finale");
   return response({ arc: replanned, conceptRules: [], chapterPlan: episodePlan }, init);
  }
  if (stage === "write") return response({ events: eventDraft }, init);
  assert.equal(stage, "chapter_review");
  return response({ ...acceptedReview, resolution: { centralConflictResolved: true, protagonistOutcomeShown: true,
   relationshipOutcomeShown: true, hasSequelHook: false, evidence: fact.evidence, fix: "마무리됨" } }, init);
 });
 const final = await generateChapter({ ...options(), state: previous });
 assert.equal(final.state.chapter, 5);
 assert.equal(final.state.nextChapterGoal, "");
 assert.deepEqual(final.state.seriesArc?.installments.slice(0, 4), seriesArc.installments.slice(0, 4));
 assert.deepEqual(final.state.seriesArc?.installments[4], replanned.installments[4]);
 await assert.rejects(generateChapter({ ...options(), state: final.state }), /already complete/);
 assert.deepEqual(calls, ["series_plan", "write", "chapter_review"]);
});

test("Claude recovers complete text drafts and resumes partial drafts from the existing plan", async t => {
 const environment = { CLAUDE_API_KEY: "test", CLAUDE_BASE_URL: "https://fixture.example/v1",
  CLAUDE_NOVEL_WRITE_MODEL: "claude-writer", CLAUDE_NOVEL_PROOFREAD_MODEL: "claude-editor", CLAUDE_NOVEL_REVIEW_MODEL: "",
  NOVEL_REVIEW_LOG_LEVEL: "summary" };
 const original = Object.entries(environment).map(([key]) => [key, process.env[key]] as const);
 Object.assign(process.env, environment);
 t.after(() => original.forEach(([key, value]) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
 }));
 const calls: string[] = [];
 const traces: { event: string; stopReason?: string; contentTypes?: string[]; expectedToolPresent?: boolean; partialEvents?: number; from?: string }[] = [];
 t.mock.method(console, "info", (prefix: unknown, line: unknown) => {
  if (prefix === "novel-review-trace") traces.push(JSON.parse(String(line)));
 });
 let writeResponse = "tool";
 const before = "수리 날짜가 문서에", after = "수리 날짜가 계약서에";
 t.mock.method(globalThis, "fetch", async (_url: string | URL, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), stage = body.tool_choice?.name ?? body.text.format.name;
  calls.push(stage);
  if (body.tool_choice) {
   assert.equal(body.model, stage === "write" ? "claude-writer" : "claude-editor");
   if (stage === "write" && writeResponse !== "tool") {
    const events = writeResponse === "partial" ? eventDraft.slice(0, 2) : eventDraft;
    return Response.json({ stop_reason: writeResponse === "limit" ? "max_tokens" : "end_turn",
     content: [{ type: "text", text: JSON.stringify({ events }) }] });
   }
   const data = stage === "write" ? { events: eventDraft } : { edits: [{ before, after }] };
   return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: stage, input: data }] });
  }
  if (stage === "chapter_plan") return response(episodePlan, init);
  assert.equal(stage, "chapter_review");
  assert.match(unpack(JSON.parse(body.input).sourceUnits).map(unit => unit.text).join(" "), /수리 날짜가 계약서에/);
  return response(acceptedReview, init);
 });
 const state = { ...emptyStoryState(), chapter: 1, seriesArc, outlineVersion: 1 as const };
 const result = await generateChapter({ ...options(), state });
 assert.deepEqual(calls, ["chapter_plan", "write", "proofread", "chapter_review"]);
 assert.equal(result.text, eventDraft.join("\n\n").replace(before, after));

 calls.length = 0;
 writeResponse = "partial";
 let saved: StoryCheckpoint | object = {};
 let preview: string | undefined;
 const request = () => generateChapter({ ...options(), state, onDraftPreview: text => { preview = text; },
  draftStore: { load: saved, async save(value) { saved = structuredClone(value); } } });
 await assert.rejects(request(), error => error instanceof StoryDraftPaused && error.reason === "format");
 assert.deepEqual(calls.splice(0), ["chapter_plan", "write"]);
 assert.equal(preview, eventDraft.slice(0, 2).join("\n\n"));
 assert.deepEqual((saved as StoryCheckpoint).chapterPipeline, {
  version: 1, series: { arc: seriesArc, conceptRules: [] }, plan: episodePlan, writePreview: eventDraft.slice(0, 2),
 });
 const incomplete = traces.find(entry => entry.event === "claude_response_incomplete");
 assert.equal(incomplete?.stopReason, "end_turn");
 assert.equal(incomplete?.expectedToolPresent, false);
 assert.deepEqual(incomplete?.contentTypes, ["text"]);
 assert.equal(incomplete?.partialEvents, 2);

 writeResponse = "limit";
 await assert.rejects(request(), /Novel output token limit/);
 assert.deepEqual(calls.splice(0), ["write"]);
 assert.ok(traces.some(entry => entry.event === "claude_response_incomplete" && entry.stopReason === "max_tokens"));

 writeResponse = "text";
 const recovered = await request();
 assert.equal(recovered.text, result.text);
 assert.deepEqual(calls, ["write", "proofread", "chapter_review"]);
 assert.ok(traces.some(entry => entry.event === "claude_response_recovered" && entry.from === "text"));
});

test("review logging levels gate full content, chunk text and never break generation diagnostics",t=>{
 const old=process.env.NOVEL_REVIEW_LOG_LEVEL;t.after(()=>{if(old===undefined)delete process.env.NOVEL_REVIEW_LOG_LEVEL;else process.env.NOVEL_REVIEW_LOG_LEVEL=old;});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 assert.equal(novelReviewLogLevel("invalid"),"off");assert.equal(novelReviewLogLevel(" FULL "),"full");
 const traceId="11111111-1111-4111-8111-111111111111",secret="PRIVATE_MANUSCRIPT_".repeat(200);
 process.env.NOVEL_REVIEW_LOG_LEVEL="summary";createNovelReviewLogger({traceId,chapter:2}).event("draft",manuscriptFingerprint(secret),{prose:secret});
 assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_MANUSCRIPT/);
 process.env.NOVEL_REVIEW_LOG_LEVEL="off";createNovelReviewLogger({traceId}).event("draft",{}, {prose:secret});assert.equal(logs.length,1);
 process.env.NOVEL_REVIEW_LOG_LEVEL="full";createNovelReviewLogger({traceId,chapter:2}).event("draft",{attempt:1},{prose:secret});
 const parts=logs.filter(row=>row.event==="content");assert.ok(parts.length>1);assert.equal(parts.map(row=>row.text).join(""),secret);
 assert.ok(parts.every((row,i)=>row.part===i+1&&row.parts===parts.length&&row.traceId===traceId&&!row.truncated));
 assert.equal(new Set(parts.map(row=>row.contentId)).size,1);
 logNovelDocumentSaved({story:{lastJobId:traceId,storyState:{chapter:2,previousProse:secret}}},"doc","chapter");
 assert.equal(logs.at(-1).event,"document_saved");assert.equal(logs.at(-1).proseHash,manuscriptFingerprint(secret).proseHash);
 const count=logs.length;logNovelDocumentSaved({story:{lastJobId:"invalid"}},"doc","chapter");assert.equal(logs.length,count);
 t.mock.method(console,"info",()=>{throw new Error("sink unavailable");});assert.doesNotThrow(()=>createNovelReviewLogger().event("failed"));
});

test("sparse concept direction is bounded, respects explicit preferences and does not add adult content to ambiguous ages",async()=>{
 const writer=await novelWriterQualityInstructions();
 assert.ok(novelConceptInstructions.length<=1300);
 assert.ok(writer.length+novelConceptInstructions.length<=4900);
 assert.ok(novelReviewerQualityInstructions.length+novelConceptInstructions.length<=5300);
 assert.match(novelConceptInstructions,/actual mutual encounters/);assert.match(novelConceptInstructions,/Explicit user facts, tone limits and endings outrank/);
 assert.match(novelConceptInstructions,/Default to strong, grounded conflict\/reversals/);
 assert.match(novelConceptInstructions,/not new user requirements or automatic review failures/);
 assert.match(novelConceptInstructions,/do not force romance or infidelity/);assert.match(novelConceptInstructions,/gentle\/no-romance\/no-tragedy/);
 assert.match(novelConceptInstructions,/Never age up minors or sexualize unclear ages/);assert.match(novelConceptInstructions,/without explicit sexual acts or anatomy/);
});

test("novel registers persist by speaker and addressee without forcing reciprocal speakers to match",()=>{
 const first={speaker:"햄군",addressee:"지호",style:"polite" as const,evidence:fact.evidence,changeEvidence:null};
 const second={speaker:"지호",addressee:"햄군",style:"casual" as const,evidence:fact.evidence,changeEvidence:null};
 const state=mergeMemory(emptyStoryState(),{...patch,dialogueRegisters:[first,second]},prose,"서점");
 assert.deepEqual(state.dialogueRegisters?.map(p=>p.style),["polite","casual"]);
 const later=mergeMemory(state,{...patch,dialogueRegisters:[]},prose,"서점");assert.deepEqual(later.dialogueRegisters,state.dialogueRegisters);
 assert.throws(()=>mergeMemory(later,{...patch,dialogueRegisters:[{...first,style:"casual"}]},prose,"서점"),/Unsupported dialogue register/);
 const changed=mergeMemory(later,{...patch,dialogueRegisters:[{...first,style:"casual",changeEvidence:"우리 이제 말 놓자."}]},prose+" 우리 이제 말 놓자.","서점");
 assert.equal(changed.dialogueRegisters?.length,2);assert.equal(changed.dialogueRegisters?.find(p=>p.speaker==="지호")?.style,"casual");
 assert.throws(()=>mergeMemory(state,{...patch,dialogueRegisters:[{...first,evidence:"원고에 없는 말투 전환"}]},prose,"서점"),/Unsupported memory/);
 assert.equal(storyStateSchema.safeParse({...state,dialogueRegisters:[{...first,style:"unknown"}]}).success,false);
 assert.match(novelDialogueRules,/actual addressee/);
 assert.match(novelDialogueRules,/even without a stored entry/);
 const sources=manuscriptSources(prose);
 assert.deepEqual(resolveSources({changeEvidence:sources[0].id,unchanged:{changeEvidence:null}},sources),{changeEvidence:sources[0].text,unchanged:{changeEvidence:null}});
 assert.throws(()=>resolveSources({changeEvidence:"missing_source"},sources),/Invalid manuscript source/);
});

test("a missing reply can be inserted beside its exact question without moving either scene", () => {
 const question = "“도착하면 연락해 줄래?”";
 const reply = "“응, 연락할게.”";
 const scene = `리카가 햄군을 바라봤다.\n\n${question}\n\n리카는 카운터를 정리했다.\n\n두 사람은 밖으로 나섰다.`;
 assert.equal(applyDialogueEdits(scene, [{ before: question, after: `${question}\n\n${reply}` }]).text,
  scene.replace(question, `${question}\n\n${reply}`));
 assert.throws(() => applyDialogueEdits(scene, [{ before: question, after: `${question}\n\n둘은 이미 골목에 도착했다.` }]),
  /Invalid dialogue edit/);
 assert.throws(() => applyDialogueEdits(scene, [{ before: scene, after: "“새 장면이에요.”" }]), /Invalid proofreading anchor/);
});

test("copyediting keeps nonconflicting exact changes when the same response contains invalid edits", () => {
 const prose = '“갑판 앞 갑판 뒤에 있어. 거기서 기다려.”\n\n시계가 울렸다.\n\n물결이 잔잔했다.';
 const output = { edits: [
  { before: "갑판 앞 갑판 뒤에 있어.", after: "갑판 뒤에 있어." },
  { before: "시계가 울렸다.\n\n물결이 잔잔했다.", after: "밤이 됐다." },
  { before: "물결이 잔잔했다.", after: "물결이 잠잠했다." },
  { before: "물결이 잔잔했다.", after: "파도가 가라앉았다." },
  { after: "앵커가 없다." },
 ] };
 const result = applyProofreading(prose, JSON.stringify(output));
 assert.equal(result.text, prose.replace("갑판 앞 갑판 뒤에 있어.", "갑판 뒤에 있어."));
 assert.equal(result.replacements.length, 1);
 assert.equal(result.skippedEdits, 4);
});

test("copyediting a broken utterance preserves its surrounding narration and reply", () => {
 const broken = "괜찮아. 그 약속을 미뤄도 되는 거면, 나야.";
 const fixed = "그 약속을 미뤄도 괜찮으면 나랑 조금만 더 있어 줄래?";
 const exchange = `“${broken}” 그녀는 한숨을 쉬었다. “방해는 아니야.”`;
 const prose = `“누구야?” “나야.”\n\n${exchange}`;
 const result = applyProofreading(prose, JSON.stringify({ edits: [
  { before: exchange, after: `“${fixed}”` },
  { before: broken, after: fixed },
  { before: "나야.", after: "내가 왔어." },
 ] }));
 assert.equal(result.text, prose.replace(broken, fixed));
 assert.equal(result.replacements.length, 1);
 assert.equal(result.skippedEdits, 2);
 assert.equal(applyProofreading(prose, JSON.stringify({ edits: [
  { before: `“${broken}”`, after: `“${fixed}”` },
 ] })).text, result.text);
});

test("reviewed dialogue fragments stay inside the unique original quotation", () => {
 const phrase = "북문 앞 북문 뒤에 모여.";
 const fixed = "북문 뒤에 모여.";
 const dialogue = `“${phrase} 두 번째 종이 울리면 출발하자.”`;
 const prose = `대장이 속삭였다. ${dialogue}\n\n정찰대가 떠났다.`;
 for (const before of [phrase, `"${phrase}"`]) {
  assert.equal(applyDialogueEdits(prose, [{ before, after: fixed }]).text, prose.replace(phrase, fixed));
 }
 assert.throws(() => applyDialogueEdits(`${prose}\n\n${dialogue}`, [{ before: phrase, after: fixed }]), /Invalid proofreading anchor/);
});

test("narration repair rejects sentence fragments, dialogue, and unrelated edits", () => {
 const broken = "서하는 문을�� 닫았다.";
 const fixed = "서하는 문을 닫았다.";
 const adjacent = "어둠이 내려앉았다.";
 const draft = `“문 닫았어?” ${broken} ${adjacent}`;
 assert.equal(applyNarrationEdits(draft, [{ before: broken, after: fixed }], [broken]).text, draft.replace(broken, fixed));
 for (const edit of [
  { before: "문을�� 닫았다.", after: "문을 닫았다." },
  { before: broken, after: `${fixed} 시간이 흘렀다.` },
  { before: broken, after: "“문을 닫았어.”" },
  { before: adjacent, after: "날이 밝았다." },
 ]) assert.throws(() => applyNarrationEdits(draft, [edit], [broken]), /Invalid narration edit/);
});

test("quality instructions keep a bounded shared core and separate prose from review duties",async()=>{
 const writer=await novelWriterQualityInstructions();
 const style=(await readFile("novel_prompt.md","utf8")).trim();
 assert.equal(writer.split(style).length-1,1);
 assert.ok(!novelReviewerQualityInstructions.includes(style));
 assert.ok(writer.length<=3600);
 assert.ok(novelReviewerQualityInstructions.length<=4200);
 for(const text of [writer,novelReviewerQualityInstructions]){
  assert.equal(text.split("NOVEL QUALITY PRINCIPLES").length-1,1);
  assert.match(text,/each clause affirms or denies/);assert.match(text,/negation scope and contrast/);
  assert.match(text,/Check how clauses connect/);
  assert.match(text,/A decisive inference needs a visible cue/);
  assert.match(text,/Link a closing gesture, message or promise/);
  assert.match(text,/possibly mixed feelings/);assert.match(text,/supported omniscient viewpoint/);
  assert.match(text,/Risky, impulsive or mistaken choices are valid/);
  assert.match(text,/action enabling escape or success/);assert.match(text,/plot-critical props/);
  assert.match(text,/who can see\/hear/);assert.match(text,/Mark time jumps\/returns/);
  assert.match(text,/ordinary ellipsis/);assert.match(text,/explicitly unresolved danger/);
 }
 assert.match(novelReviewerQualityInstructions,/speechIntentClear checks clause links, referents and literal assertions\/negations before inferred intent/);
 for(const instructions of [novelReviewerQualityInstructions]) assert.match(instructions,/서술·대사에서 뜻을 깨뜨리는 오탈자/);
 assert.doesNotMatch(writer,/SCENE AUDIT:|REGISTER MEMORY:/);
 assert.doesNotMatch(novelReviewerQualityInstructions,/WRITING TASK:/);
 assert.match(writer,/in JSON mode place requested metadata only in its separate fields/i);
});

const longProse=(prose+Array.from({length:90},(_,i)=>` 서하는 ${i+1}번째 서가를 정리하며 친구와 다음 작업을 의논했다. 약속한 날짜를 지키려면 오늘 이 일을 끝내야 했다.`).join("")).slice(0,2700);

test("novel prompt tables preserve every canon and source field without mutating saved memory",()=>{
 const timeline={...emptyTimeline(),participants:[{id:"user",name:"당신"},{id:"character",name:"서하"}],canon:Array.from({length:10},(_,i)=>({id:`novel:${i+1}:character:event_${i}`,source:"novel" as const,sourceId:`chapter_${i+1}`,subjectId:"character",objectId:"user",key:`event_${i}`,kind:"event" as const,status:"completed" as const,visibility:i%2?"reader" as const:"character" as const,text:`중요한 사건 ${i}`,evidence:`원고 근거 ${i}`}))};
 const before=structuredClone(timeline),packed=novelTimelineContext(timeline);
 assert.deepEqual(unpack(packed.canon),timeline.canon);assert.deepEqual(unpack(packed.participants),timeline.participants);
 assert.deepEqual(timeline,before);assert.ok(JSON.stringify(packed).length<JSON.stringify(timeline).length);
 const sources=manuscriptSources(longProse),compact=sourceContext(sources);
 assert.deepEqual(unpack(compact),sources);assert.ok(JSON.stringify(compact).length<JSON.stringify(sources).length);
 assert.equal(resolveSources({evidence:sources[0].id},sources).evidence,sources[0].text);
});

test("event evidence recovery corrects an unambiguous state label without changing the prose", () => {
 const previous = { location: "편의점 진열대 앞", present: [], pending: [], completed: [] };
 const prose = "둘은 진열대를 떠나 계산대 앞에 섰다.";
 const event = { prose, state: { ...previous, location: "편의점 계산대 앞" }, goalEvidence: null,
  transitions: [{ item: "편의점 진열대 앞에서 편의점 계산대 앞으로 이동", evidence: prose }] };
 assert.equal(missingEventTransition(previous, event), previous.location);
 const recovered = recoverEventEvidence(previous, event);
 assert.equal(recovered.prose, prose);
 assert.deepEqual(recovered.transitions, [{ item: previous.location, evidence: prose }]);
 assert.equal(missingEventTransition(previous, recovered), undefined);
 assert.equal(missingEventTransition(previous, recoverEventEvidence(previous, {
  ...event, transitions: [{ item: previous.location, evidence: "본문에 없는 이동 근거입니다." }],
 })), previous.location);
 const quoted = "“계산대 앞으로 가자.”\n\n둘은 함께 이동했다.";
 const reQuoted = recoverEventEvidence(previous, { ...event, prose: quoted,
  transitions: [{ item: previous.location, evidence: '"계산대 앞으로 가자." 둘은 함께 이동했다.' }] });
 assert.equal(reQuoted.prose, quoted);
 assert.equal(missingEventTransition(previous, reQuoted), undefined);
});
test("story headings are hidden while explicit times in prose or dialogue remain visible", () => {
 const prose = "10:05에 벨이 울렸다.\n\n“10:20에 다시 올게.”";
 assert.equal(stripStoryMetadata(`10:05 · 현관 복도\r\n\r\n${prose}\n\n## 10:20 · 주방\n\n발소리가 났다.`), `${prose}\n\n발소리가 났다.`);
});

test("story readers separate direct speech while retaining inline quoted terms", () => {
 const text = '그가 문 앞에서 말했다. “여기 있어.” 그녀는 “집”이라는 말을 떠올렸다. 그가 물었다. "갈까?" 그녀가 고개를 끄덕였다.';
 const expected = '그가 문 앞에서 말했다.\n\n“여기 있어.”\n\n그녀는 “집”이라는 말을 떠올렸다. 그가 물었다.\n\n"갈까?"\n\n그녀가 고개를 끄덕였다.';
 assert.equal(formatStoryForReading(text), expected);
 assert.equal(formatStoryForReading(expected), expected);
 assert.equal(formatStoryForReading(expected.replaceAll("\n", "\r\n")), expected);
 const shortTurns = '“응” "그래" 그녀는 “집”이라는 단어를 적었다. 그가 물었다. “지금” 그녀가 멈췄다.';
 const formatted = '“응”\n\n"그래"\n\n그녀는 “집”이라는 단어를 적었다. 그가 물었다.\n\n“지금”\n\n그녀가 멈췄다.';
 assert.equal(formatStoryForReading(shortTurns), formatted);
 assert.equal(formatStoryForReading(formatted), formatted);
});


test("numeric source lists are removed without stripping numbers in prose", () => {
 assert.equal(stripStoryMetadata("문을 닫았다 [9]. 쇼핑백을 내려놨다 [10]. “이건[11] 내 거야.”\n\n[3]\n그는 10층으로 올라갔다."),
  "문을 닫았다. 쇼핑백을 내려놨다. “이건 내 거야.”\n\n그는 10층으로 올라갔다.");
 const line = "복도에 긴장이 남아 있었다.";
 const next = "“12, 13번은 내가 맡을게.”";
 assert.equal(stripStoryMetadata(`복도에 긴장이 남아 있었다 [12, 13].\n\n${next}\n\n[2, 4].`), `${line}\n\n${next}`);
});

test("internal event labels stay out of the story while sentence punctuation remains", () => {
 assert.equal(stripStoryMetadata("[이벤트 시작]\n그녀는 화면으로 시선을 돌렸다 [이벤트 종료]. 그는 숨을 골랐다.\n\n[이벤트 종료]"),
  "그녀는 화면으로 시선을 돌렸다. 그는 숨을 골랐다.");
 assert.equal(stripStoryMetadata("“게시판의 [이벤트 안내]를 읽어 봐.”"), "“게시판의 [이벤트 안내]를 읽어 봐.”");
});

test("insertion overlap catches a repeated action surrounded by otherwise new prose", () => {
 const action = "그녀는 친구의 연락처를 저장하고 다음 날 아침에 확인할 계약서 사진을 메시지로 보냈다.";
 const later = "서하는 친구의 연락처를 저장하고 다음 날 아침에 확인할 계약서 사진을 메시지로 보냈다.";
 const prose = [action, "계단 아래에서 창문을 닫는 소리가 들렸다.", later].join("\n\n");
 assert.deepEqual(findRepeatedPassage(prose),{first:action,repeated:later,kind:"narration"});
 assert.equal(findRepeatedPassage('“응.”\n\n그가 고개를 끄덕였다.\n\n“응.”'),undefined);
});

test("the same reply cannot be drafted and sent again in the next paragraph without a new exchange", () => {
 const first = "손가락은 이미 자판 위를 움직여 약속한 규칙에 맞춘 답장을 완성해 가고 있었다. 전송 버튼을 누르는 순간 방 안의 공기가 서늘하게 가라앉았다.";
 const repeated = "화면을 가만히 응시하던 나는 떨리는 손가락으로 문자에 대답을 적어 내려갔다. 전송 버튼을 누르는 소리 없는 타격감에 숨을 골랐다.";
 assert.deepEqual(findRepeatedPassage(`${first}\n\n${repeated}`), {first, repeated, kind:"action"});
 assert.equal(findRepeatedPassage(`${first}\n\n새로운 메시지가 도착했다. ${repeated}`), undefined);
 assert.equal(findRepeatedPassage(`${first.replace("전송 버튼을 누르는 순간", "전송 버튼을 누르려다 멈추자")}\n\n${repeated}`), undefined);
});

test("the same visitor carrying gifts cannot arrive twice in adjacent paragraphs", () => {
 const opening = "초인종 소리가 거실의 공기를 흔들었다. 현아가 먼저 현관으로 향했다. 현문이 열리고 아랫집에 이사 온 민희가 모습을 드러냈다. 민희는 손에 작은 상자 두 개를 들고 있었다.";
 const duplicate = "초인종 소리가 울리자 현아는 자리에서 일어났고 나는 문 앞에 섰다. 문이 열리자마자 민희의 향수 냄새가 났다. 민희는 두 손에 작은 상자를 각각 들고 우리를 바라보았다.";
 assert.deepEqual(findRepeatedPassage(`${opening}\n\n${duplicate}`), { first:opening, repeated:duplicate, kind:"action" });
 assert.equal(findRepeatedPassage(`${opening}\n\n민희가 눈을 마주치며 상자를 내밀었다. 현아는 두 손으로 선물을 받았다.`), undefined);
 const nextDay = "다음 날 현관 벨이 울렸다. 현아가 문을 열자 민희는 어제 두고 간 물건 대신 이번에는 다른 꾸러미를 들고 서 있었다.";
 assert.equal(findRepeatedPassage(`${opening}\n\n${nextDay}`), undefined);
 assert.equal(findRepeatedPassage(`${opening}\n\n${duplicate.replaceAll("민희", "서윤")}`), undefined);
});

test("event audit checks paraphrased sword exchanges and spellcasting without requiring matching words", () => {
 const cases = [
  ["서린의 검이 맞수의 칼을 쳐냈다.", "상대의 칼날은 서린이 펼친 검세에 옆으로 밀렸다.", "맞수가 자세를 고쳐 다시 들어왔다."],
  ["마법사가 얼음 장벽을 세워 통로를 막았다.", "술사의 주문에 하얀 벽이 솟구쳐 길을 닫았다.", "첫 장벽이 무너지자 마법사가 새 주문을 외웠다."],
 ];
 for (const [first, later, newTrigger] of cases) {
  const passages = [first, newTrigger, later];
  const locate = (ref: string) => {
   const position = passages.indexOf(ref);
   return position < 0 ? undefined : { position, text: ref };
  };
  const initial = {eventKey:"actor-action-target",depiction:"action" as const,occurrenceStart:first,evidence:first,triggerEvidence:null};
  const repeated = {...initial,occurrenceStart:later,evidence:later,eventKey:"actor action target"};
  assert.equal(inspectEventAudit([initial,repeated],locate)[0]?.evidence,later);
  assert.equal(inspectEventAudit([initial,{...repeated,triggerEvidence:first}],locate)[0]?.evidence,later);
  assert.deepEqual(inspectEventAudit([initial,{...repeated,triggerEvidence:newTrigger}],locate),[]);
  assert.deepEqual(inspectEventAudit([initial,{...repeated,depiction:"recall"}],locate),[]);
  assert.deepEqual(inspectEventAudit([initial,{...repeated,occurrenceStart:first}],locate),[]);
  assert.equal(inspectEventAudit([{...repeated,depiction:"replay"}],locate)[0]?.evidence,later);
 }
});

const duplicatedGiftAddition = "현아가 환한 미소를 지으며 쇼핑백 속 인테리어 소품을 이리저리 살펴보는 동안, 나는 민희가 건네준 묵직한 상자를 받아 들며 마른침을 삼켰다. 민희는 가벼운 눈인사를 남기고 아래층으로 내려가겠다고 말하며 현관문을 가볍게 닫았다.";
const originalGiftScene = "현아가 고맙다고 인사하며 쇼핑백을 열어 그 안의 평범한 인테리어 소품을 살펴보는 사이, 나는 민희가 내게 건넨 상자를 받아 들었다. 묵직하면서도 무언가 숨겨진 듯한 감촉이 손끝에 전해졌다. 민희는 짧은 인사를 남기고 이내 아래층으로 내려가겠다며 문을 닫았다.";

test("an insertion repeats a later scene even when the same actions are paraphrased", () => {
 assert.equal(findRepeatedPassage(duplicatedGiftAddition+"\n\n"+originalGiftScene),undefined);
 assert.equal(findReplayedInsertion(duplicatedGiftAddition,originalGiftScene)?.kind,"action_sequence");
 assert.equal(findReplayedInsertion(duplicatedGiftAddition.split(".")[0]+". 나는 포장지 아래 찢어진 영수증을 발견했다.",originalGiftScene),undefined);
});

function schemaNode(root:any,node:any):any {
 while(node.$ref) node=node.$ref.split("/").slice(1).reduce((value:any,key:string)=>value[key.replaceAll("~1","/").replaceAll("~0","~")],root);
 return node;
}

test("review schemas share source IDs without relaxing evidence validation",()=>{
 const ids=Array.from({length:180},(_,index)=>`source_${index+1}`) as [string,...string[]];
 const citation=z.enum(ids);
 const schema=createReviewSchema(citation).extend({memoryPatch:createMemoryPatchSchema(citation)});
 const compact=novelJsonSchema(schema);
 assert.ok(JSON.stringify(compact).length < JSON.stringify(z.toJSONSchema(schema)).length*0.6);
 const item=schemaNode(compact,schemaNode(compact,compact.properties!.newEvents).items);
 assert.deepEqual(schemaNode(compact,item.properties.evidence).enum,ids);
 assert.equal(citation.safeParse("source_999").success,false);
});

test("source references select real manuscript passages instead of generated quotations", () => {
  const sources = manuscriptSources("“반가워.” 서하는 손을 내밀었다.\n응. " + "긴 문장".repeat(150));
  assert.ok(sources.every(source => source.text.length <= 360));
  const quoted = resolveSources({ evidence: sources[0].id, nested: [{ evidence: sources[1].id }] }, sources);
  assert.equal(quoted.evidence, sources[0].text);
  assert.equal(quoted.nested[0].evidence, sources[1].text);
  assert.throws(() => resolveSources({ evidence: "서하는 달아났다" }, sources), /Invalid manuscript source/);
});

test("the API rejects requests beyond chapter five before any model call", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not call the model"); });
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, storyState: { ...emptyStoryState(), chapter: 5, seriesArc }, messages: [{ role: "user", content: "계속 써줘" }] }) }));
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /완결/);
});

test("memory stays bounded, detects copied prose and rejects excessive client state", () => {
  const state = { ...emptyStoryState(), recentEvents: Array.from({ length: 24 }, (_, i) => `이전 사건${i}`), resolvedEvents: Array.from({ length: 24 }, (_, i) => `해결${i}`), openThreads: ["미해결"] };
  const updated = mergeMemory(state, { ...patch, closedThreads: [{ text: "미해결", evidence: fact.evidence }] }, prose, "서점");
  assert.equal(updated.recentEvents.length, 8); assert.equal(updated.resolvedEvents.length, 24);
  assert.deepEqual(updated.openThreads, []);
  assert.equal(repeatsPrevious(prose, prose.replaceAll(" ", "\n")), true);
  assert.equal(repeatsPrevious(prose, "바다로 항해했다.".repeat(40)), false);
  assert.equal(storyStateSchema.safeParse({ ...state, previousProse: "x".repeat(9000) }).success, true);
  const crowded = { ...state, previousProse: "x".repeat(8000),
    worldFacts: Array.from({ length: 16 }, (_, i) => `${i}${"사실".repeat(100)}`),
    characters: Array.from({ length: 6 }, (_, i) => ({ name: `인물${i}`, goal: "목표", knowledge: Array.from({ length: 6 }, (_, j) => `${j}${"지식".repeat(100)}`), relationships: ["친구"] })) };
  const copy = structuredClone(crowded);
  const bounded = mergeMemory(crowded, patch, prose.repeat(8).slice(0, 8000), "서점");
  assert.ok(JSON.stringify(bounded).length <= 16000);
  assert.deepEqual(crowded, copy);
});
