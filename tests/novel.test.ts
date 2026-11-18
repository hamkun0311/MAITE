import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChapter, novelJsonSchema } from "../lib/novel/generate.ts";
import { createReviewSchema, createMemoryPatchSchema, emptyStoryState, mergeMemory, repeatsPrevious, storyStateSchema } from "../lib/novel/state.ts";
import { z } from "zod";
import { POST } from "../app/api/chat/route.ts";
import { manuscriptSources, resolveSources } from "../lib/novel/sources.ts";
import { seriesArcSchema, seriesSchedule, storyComplete, storyProgress } from "../lib/novel/series.ts";
import { emptyTimeline } from "../lib/chat/timeline.ts";

const character = { mode: "story" as const, name: "서하", age: 25, personality: "다정함", concept: "친구와 서점 복구", genre: "막장드라마" as const, imageDescription: "서점의 탐정" };
const prose = "서하는 서랍에서 계약서를 찾았다. 그가 약속한 수리 날짜가 문서에 적혀 있었다. " + "그녀는 친구에게 전화를 걸어 내일 함께 서점을 정리하자고 말했다. 망설이던 친구가 수화기 너머에서 웃었다. " + "둘은 닫힌 서점 문을 열고 먼지 쌓인 책을 창가로 옮겼다. 새로 비워진 진열대 사이로 햇빛이 들어왔다. 오래 미뤄 두었던 일이 드디어 시작되었다. " + "친구가 가져온 달력에 수리 날짜를 표시했다. 내일 아침에는 창문을 닦기로 했다.";
const fact = { text: "계약서를 찾았다", evidence: "서하는 서랍에서 계약서를 찾았다." };
const seriesArc = { endingPromise: "서점을 다시 열고 친구와 함께 운영한다", installments: Array.from({ length: 5 }, (_, index) => ({ chapter: index + 1, goal: `${index + 1}편 목표`, payoff: `${index + 1}편 결과` })) };
const plan = { seriesArc, chapterGoal: "서점 복구를 시작한다", longTermGoal: "함께 서점을 다시 연다", newInformation: "계약서의 날짜", protagonistChoice: "친구를 부른다", costOrConsequence: "함께 정리를 시작한다",
  beats: [1, 2, 3].map(i => ({ goal: `목표${i}`, obstacle: "망설임", action: "정리한다", outcome: "진전" })), endingChange: "서점 문을 열었다", mustNotRepeat: [] };
const review = { pass: true, conceptAlignment: { satisfied: true, evidence: fact.evidence, fix: "설정 준수" }, blockingIssues: [], completedBeats: [1, 2, 3], newEvents: [fact], endingChange: { text: "정리가 시작됨", evidence: "오래 미뤄 두었던 일이 드디어 시작되었다." } };
const patch = { summary: "서하가 계약서를 찾아 친구와 서점 정리를 시작했다.", currentSituation: fact,
  newEvents: [fact], resolvedEvents: [fact], openedThreads: [], closedThreads: [], worldFacts: [fact],
  characters: [{ name: "서하", goal: null, knowledge: [fact], relationships: [] }], nextChapterGoal: "창문을 닦는다" };
const response = (value: unknown, init?: RequestInit) => {
  if (value && typeof value === "object" && "pass" in value) value = { memoryPatch: patch, ...value };
  const input = init ? JSON.parse(JSON.parse(String(init.body)).input) : {};
  const cite = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(cite);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === "evidence"
      ? input.sourceUnits?.find((unit: { id: string; text: string }) => typeof child === "string" && unit.text.includes(child))?.id ?? "unknown_source"
      : cite(child)]));
  };
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(init ? cite(value) : value) }] }] });
};

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

test("first and final chapter plans use the expanded, configurable reasoning and output budget",async t=>{
 const previous=process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;else process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS=previous;});
 const {seriesArc: _arc,...nextPlan}=plan;
 for(const budget of [12000,16000]){
  if(budget===12000)delete process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;else process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS=String(budget);
  for(const final of [false,true]){
   const state=final?{...emptyStoryState(),chapter:4,seriesArc}:undefined;
   const finalReview={...review,resolution:{centralConflictResolved:true,protagonistOutcomeShown:true,relationshipOutcomeShown:true,hasSequelHook:false,evidence:fact.evidence,fix:"완결"}};
   const values:unknown[]=[final?nextPlan:plan,prose,final?finalReview:review];let calls=0;
   const records:{feature:string;status:string;outputTokens:number|null}[]=[];
   const mocked=t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));calls++;
    const result=response(values.shift(),init);
    if(body.text?.format?.name!=="chapter_plan")return result;
    assert.equal(body.max_output_tokens,budget);assert.deepEqual(body.reasoning,{effort:"medium"});
    return Response.json({...await result.json(),usage:{input_tokens:500,output_tokens:6000,total_tokens:6500,output_tokens_details:{reasoning_tokens:5000}}});
   });
   try{
    const result=await generateChapter({character,state,direction:"다음 이야기",key:"test",signal:new AbortController().signal,phase:()=>{},onUsage:record=>records.push(record)});
    assert.equal(result.state.chapter,final?5:1);assert.equal(calls,3);
    assert.equal(records.find(record=>record.feature==="novel.chapter_plan"&&record.status==="completed")?.outputTokens,6000);
   }finally{mocked.mock.restore();}
  }
 }
});

test("medium reviews have room for reasoning beyond the old cap and still commit only a completed review",async t=>{
 const previous=process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT;
 process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT="medium";
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT;else process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT=previous;});
 const values:unknown[]=[plan,prose,review];
 const records:{feature:string;status:string;reasoningTokens:number|null}[]=[];
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));
  const result=response(values.shift(),init);
  if(body.text?.format?.name!=="chapter_review")return result;
  assert.deepEqual(body.reasoning,{effort:"medium"});assert.equal(body.max_output_tokens,12000);
  return Response.json({...await result.json(),usage:{input_tokens:14101,output_tokens:5700,total_tokens:19801,output_tokens_details:{reasoning_tokens:5000}}});
 });
 const result=await generateChapter({character,direction:"첫 이야기",key:"test",signal:new AbortController().signal,phase:()=>{},onUsage:record=>records.push(record)});
 assert.equal(result.state.chapter,1);assert.equal(calls,3);
 assert.equal(records.find(record=>record.feature==="novel.chapter_review"&&record.status==="completed")?.reasoningTokens,5000);
});

test("a reused outline still reviews and repairs a grounded continuity error at most once",async t=>{
 const bad={...review,pass:false,blockingIssues:[{type:"continuity",evidence:fact.evidence,fix:"확정된 인물 관계를 유지한다"}]};
 const values:unknown[]=[prose,bad,prose,review];
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));assert.notEqual(body.text?.format?.name,"chapter_plan");
  if(calls===3)assert.equal(JSON.parse(JSON.parse(body.input).corrections).issues[0].type,"continuity");
  return response(values.shift(),init);
 });
 const old={...emptyStoryState(),chapter:1,seriesArc,longTermGoal:plan.longTermGoal};
 const before=structuredClone(old);
 const result=await generateChapter({character,state:old,direction:"이어서 써줘",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(result.state.chapter,2);assert.equal(calls,4);assert.deepEqual(old,before);
});

test("additional concepts replan five future chapters without resetting actual history, even after completion", async t => {
  for (const chapter of [3, 5]) {
    const old = { ...emptyStoryState(), chapter, seriesArc, summary: "서점 정리를 시작했다", longTermGoal: "예전 목표" };
    const before = structuredClone(old);
    const newArc = { ...seriesArc, endingPromise: "라이벌과 함께 새로운 서점을 연다" };
    const values: unknown[] = [{ ...plan, seriesArc: newArc, longTermGoal: "라이벌과 서점 운영" }, prose, review];
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.reasoning,{effort:body.text?.format?.name==="chapter_review"?"low":"medium"});
      assert.doesNotMatch(body.instructions,/exactly 10 numbered installments/);
      const input = JSON.parse(body.input);
      if (body.text?.format?.name === "chapter_plan") {
        assert.equal(input.schedule.chapter, 1);
        assert.equal(input.schedule.remainingAfterThis, 4);
        assert.equal(input.memory.summary, before.summary);
        assert.equal(input.additionalConcept, "라이벌과 화해하고 동업한다");
        assert.ok(body.text.format.schema.required.includes("seriesArc"));
      }
      if (!body.text) assert.equal(input.context.installmentGoal.chapter, 1);
      return response(values.shift(), init);
    });
    const options = { character, state: old, additionalConcept: "라이벌과 화해하고 동업한다", direction: "이어서 써줘", key: "test", signal: new AbortController().signal, phase: () => {} };
    const result = await generateChapter(options);
    assert.equal(result.expectedChapter, chapter);
    assert.equal(result.state.chapter, chapter + 1);
    assert.equal(result.state.seriesStartChapter, chapter);
    assert.equal(result.state.seriesConcept, options.additionalConcept);
    assert.equal(result.state.longTermGoal, "라이벌과 서점 운영");
    assert.deepEqual(result.state.seriesArc, newArc);
    assert.equal(storyProgress(result.state), 1);
    assert.equal(storyComplete(result.state), false);
    assert.deepEqual(old, before);
    await assert.rejects(generateChapter({ ...options, additionalConcept: undefined, state: { ...result.state, chapter: chapter + 5 } }), /already complete/);
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("user-required outcomes block even an otherwise resolved ending; one repair or no commit", async t => {
  const requiredEnding = "남편이 밀회를 발견한다. 롤랑은 루이를 지키다가 죽고 루이도 그의 곁에서 숨을 거둔다.";
  const tragicCharacter = { ...character, name: "루이", concept: "공주 루이는 정략결혼 후에도 소꿉친구 롤랑과 밀회를 즐긴다." };
  const { seriesArc: omitted, ...nextPlan } = plan;
  void omitted;
  const finalReview = { ...review, resolution: { centralConflictResolved: true, protagonistOutcomeShown: true, relationshipOutcomeShown: true, hasSequelHook: false, evidence: fact.evidence, fix: "완결" } };
  const violation = { ...finalReview, pass: true, conceptAlignment: { satisfied: false, evidence: fact.evidence, fix: requiredEnding } };
  for (const repaired of [true, false]) {
    const old = { ...emptyStoryState(), chapter: 4, seriesArc, seriesConcept: requiredEnding, longTermGoal: "계약서로 결혼을 무효화하고 탈출" };
    const before = structuredClone(old);
    const values: unknown[] = [{ ...nextPlan, longTermGoal: requiredEnding }, prose, violation, prose, repaired ? finalReview : violation];
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      const input = JSON.parse(body.input);
      assert.match(body.instructions, /seriesConcept > explicit character.concept > makjang/);
      assert.match(body.instructions, /치정/);
      assert.equal((input.context ?? input).seriesConcept, requiredEnding);
      if (body.text?.format?.name === "chapter_review") {
        assert.ok(body.text.format.schema.required.includes("conceptAlignment"));
        assert.match(body.instructions, /ALL specified outcomes must actually occur/);
      }
      if (calls === 4) assert.equal(JSON.parse(input.corrections).unmetUserRequirements.fix, requiredEnding);
      return response(values.shift(), init);
    });
    const generation = generateChapter({ character: tragicCharacter, state: old, direction: "마지막 회차", key: "test", signal: new AbortController().signal, phase: () => {} });
    if (repaired) {
      const result = await generation;
      assert.equal(result.state.longTermGoal, requiredEnding);
      assert.equal(result.state.seriesConcept, requiredEnding);
    } else await assert.rejects(generation, /Chapter review failed/);
    assert.equal(calls, 5);
    assert.deepEqual(old, before);
    mock.mock.restore();
  }
});

test("source references select real manuscript passages instead of generated quotations", () => {
  const sources = manuscriptSources("“반가워.” 서하는 손을 내밀었다.\n응. " + "긴 문장".repeat(150));
  assert.ok(sources.every(source => source.text.length <= 360));
  const quoted = resolveSources({ evidence: sources[0].id, nested: [{ evidence: sources[1].id }] }, sources);
  assert.equal(quoted.evidence, sources[0].text);
  assert.equal(quoted.nested[0].evidence, sources[1].text);
  assert.throws(() => resolveSources({ evidence: "서하는 달아났다" }, sources), /Invalid manuscript source/);
});

test("a five-part arc is stored once and follows the remaining chapter schedule", async t => {
  let state = emptyStoryState();
  for (let chapter = 1; chapter <= 4; chapter++) {
    const distinctPassage = Array.from({ length: 500 }, (_, index) => String.fromCharCode(0xac00 + chapter * 600 + index)).join("");
    const values: unknown[] = [...(chapter === 1 ? [plan] : []), prose + distinctPassage, review];
    let calls=0;
    const mocked = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls++;
      const input = JSON.parse(body.input);
      const context = input.context ?? input;
      if (body.text?.format?.name === "chapter_plan") {
        assert.equal(chapter,1);
        assert.equal(context.schedule.chapter, chapter);
        assert.equal(context.schedule.totalChapters, 5);
        assert.equal(context.schedule.remainingAfterThis, 5 - chapter);
        assert.equal(body.text.format.schema.required.includes("seriesArc"), chapter === 1);
      }
      if(chapter>1&&!body.text){assert.match(body.instructions,/Privately plan 3–5 causal scene beats/);assert.equal(context.installmentGoal.chapter,chapter);assert.deepEqual(context.seriesArc.installments.rows,seriesArc.installments.map(({chapter,goal,payoff})=>[chapter,goal,payoff]));}
      return response(values.shift(), init);
    });
    const result = await generateChapter({ character, state, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
    state = result.state;
    assert.equal(state.chapter, chapter);
    assert.deepEqual(state.seriesArc, seriesArc);
    assert.equal(calls,chapter===1?3:2);
    mocked.mock.restore();
  }
  assert.equal(seriesSchedule(4).phase, "climax");
  assert.equal(seriesSchedule(3).phase, "convergence");
  assert.equal(seriesSchedule(5).phase, "finale");
  assert.equal(storyComplete(state), false);
  assert.equal(seriesArcSchema.safeParse({ ...seriesArc, installments: seriesArc.installments.slice(0, 4) }).success, false);
  assert.equal(seriesArcSchema.safeParse({ ...seriesArc, installments: seriesArc.installments.map(item => ({ ...item, chapter: 1 })) }).success, false);
});

test("legacy ten-part saved plans load and replan five parts without resetting global progress", async t => {
  const legacyArc = { ...seriesArc, installments: Array.from({ length: 10 }, (_, index) => ({ chapter: index + 1, goal: "기존 목표", payoff: "기존 결과" })) };
  const old = storyStateSchema.parse({ ...emptyStoryState(), chapter: 3, seriesArc: legacyArc, summary: "세 회차의 사건은 이미 진행됐다" });
  const before = structuredClone(old);
  assert.equal(seriesArcSchema.safeParse(legacyArc).success, false);
  const values: unknown[] = [plan, prose, review];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    if (calls === 1) {
      const context = JSON.parse(body.input);
      assert.equal(context.chapter, 4);
      assert.equal(context.schedule.chapter, 4);
      assert.equal(context.memory.summary, old.summary);
      assert.ok(body.text.format.schema.required.includes("seriesArc"));
    }
    return response(values.shift(), init);
  });
  const result = await generateChapter({ character, state: old, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} });
  assert.equal(result.state.chapter, 4);
  assert.equal(result.state.seriesStartChapter, 0);
  assert.equal(result.state.seriesArc?.installments.length, 5);
  assert.equal(storyProgress(result.state), 4);
  assert.deepEqual(old, before);
  assert.equal(calls, 3);
});

test("the fifth chapter must resolve the story, permits one repair, and cannot generate a sixth", async t => {
  const { seriesArc: omitted, ...nextPlan } = plan;
  void omitted;
  const resolution = { centralConflictResolved: true, protagonistOutcomeShown: true, relationshipOutcomeShown: true, hasSequelHook: false, evidence: fact.evidence, fix: "해결됨" };
  const finalReview = { ...review, resolution };
  const unfinished = { ...finalReview, resolution: { ...resolution, centralConflictResolved: false, hasSequelHook: true, fix: "핵심 갈등을 해결하고 후속편 암시를 없앤다" } };
  let values: unknown[] = [nextPlan, prose, unfinished, prose, finalReview];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.text?.format?.name === "chapter_review") assert.ok(body.text.format.schema.required.includes("resolution"));
    if (!body.text) { assert.match(body.instructions, /THIS IS THE FINAL CHAPTER/); assert.match(body.instructions, /No cliffhanger/); }
    calls++;
    return response(values.shift(), init);
  });
  const state = { ...emptyStoryState(), chapter: 4, seriesArc, nextChapterGoal: "서점 개점" };
  const before = structuredClone(state);
  const options = { character, state, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} };
  const result = await generateChapter(options);
  assert.equal(calls, 5);
  assert.equal(result.state.chapter, 5);
  assert.equal(result.state.nextChapterGoal, "");
  assert.equal(storyComplete(result.state), true);
  assert.deepEqual(state, before);
  await assert.rejects(generateChapter({ ...options, state: result.state }), /already complete/);
  assert.equal(calls, 5);
  values = [nextPlan, prose, unfinished, prose, unfinished]; calls = 0;
  await assert.rejects(generateChapter(options), /review failed/);
  assert.equal(calls, 5);
  assert.deepEqual(state, before);
});

test("the API rejects requests beyond chapter five before any model call", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not call the model"); });
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, storyState: { ...emptyStoryState(), chapter: 5, seriesArc }, messages: [{ role: "user", content: "계속 써줘" }] }) }));
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /완결/);
});

test("a passing review with source IDs commits the first chapter without a quotation rewrite", async t => {
  let calls = 0;
  const values: unknown[] = [plan, prose, review];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const input = JSON.parse(body.input);
    if (["chapter_review", "memory_patch"].includes(body.text?.format?.name)) {
      assert.equal(input.context.sharedTimeline.revision, 3);
      assert.equal(input.context.memory.currentSituation, undefined);
      assert.equal(input.draft, undefined);
      assert.equal(input.context.memory.seriesArc, undefined);
      assert.ok(body.text.format.schema.required.includes("memoryPatch"));
      assert.ok(input.sourceUnits.length > 0);
      const root=body.text.format.schema;
      const item=schemaNode(root,schemaNode(root,root.properties.newEvents).items);
      assert.deepEqual(schemaNode(root,item.properties.evidence).enum, input.sourceUnits.map((unit: { id: string }) => unit.id));
      assert.equal(input.context.character.imageDescription,undefined);
      assert.equal(input.context.seriesArc.installments,undefined);
      assert.doesNotMatch(body.instructions, /You are writing immersive fictional character roleplay/);
    }
    calls++;
    return response(values.shift(), init);
  });
  const timeline = { ...emptyTimeline(), revision: 3, scene: [{ subjectId: "character", text: "서점에서 재회" }], participants: [{ id: "user", name: "당신" }, { id: "character", name: "서하" }] };
  const result = await generateChapter({ character, timeline, direction: "첫 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
  assert.equal(result.state.chapter, 1); assert.equal(calls, 3);
});

test("novel pipeline plans, writes, reviews and merges only grounded events; writer gets compact memory", async t => {
  const previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = "gpt-5.4-mini";
  t.after(() => {
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  });
  const old = { ...emptyStoryState(), chapter: 3, summary: "친구와 약속했다", worldFacts: ["서점은 도시 안에 있다"], resolvedEvents: ["친구와 화해함"], previousProse: "이전 전체 원고", previousEnding: "문 앞에 섰다", nextChapterGoal: "문을 연다" };
  const before = structuredClone(old);
  const bodies: Record<string, unknown>[] = [];
  const values = [plan, prose, review];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body);
    assert.equal(body.model, "gpt-5.4-mini"); assert.equal(body.store, false);
    return response(values.shift(), init);
  });
  const phases: string[] = [];
  const result = await generateChapter({ character, state: old, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: value => phases.push(value) });
  assert.equal(result.expectedChapter, 3); assert.equal(result.state.chapter, 4);
  assert.deepEqual(old, before);
  assert.deepEqual(result.state.worldFacts, ["서점은 도시 안에 있다", fact.text]);
  assert.ok(result.state.resolvedEvents.includes("친구와 화해함"));
  assert.equal(result.state.characters[0].knowledge[0], fact.text);
  assert.ok(!String(bodies[1].input).includes("이전 전체 원고"));
  assert.ok(String(bodies[1].input).includes("친구와 화해함"));
  assert.deepEqual(phases, ["planning", "writing", "reviewing", "remembering"]);
});

test("grounded repetition permits one rewrite; repeated failure never advances memory", async t => {
  const bad = { ...review, pass: false, blockingIssues: [{ type: "no_progress", evidence: fact.evidence, fix: "정리를 실제로 진행하라" }] };
  let values: unknown[] = [plan, prose, bad, prose, review];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const state = emptyStoryState();
  const options = { character, state, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  assert.equal((await generateChapter(options)).state.chapter, 1);
  assert.equal(calls, 5);
  values = [plan, prose, bad, prose, bad]; calls = 0;
  await assert.rejects(generateChapter(options), /review failed/);
  assert.equal(calls, 5); assert.equal(state.chapter, 0);
});

test("partial beat completion and advisory missing beats do not reject meaningful progression", async t => {
  for (const critique of [
    { ...review, completedBeats: [1, 2] },
    { ...review, pass: false, completedBeats: [1, 2], blockingIssues: [{ type: "missing_beat", evidence: fact.evidence, fix: "나머지 장면은 다음 화에 이어간다" }] },
  ]) {
    const values: unknown[] = [{ ...plan, beats: [...plan.beats, plan.beats[0]] }, prose, critique];
    let calls = 0;
    const mocked = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
    const result = await generateChapter({ character, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
    assert.equal(result.state.chapter, 1); assert.equal(calls, 3);
    mocked.mock.restore();
  }
});

test("ungrounded criticism cannot trigger a rewrite and unsupported memory cannot commit", async t => {
  let values: unknown[] = [plan, prose, { ...review, pass: false, blockingIssues: [{ type: "continuity", evidence: "원고에 없는 비밀 문장", fix: "수정" }] }];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const options = { character, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  await assert.rejects(generateChapter(options)); assert.equal(calls, 3);
  values = [plan, prose, { ...review, memoryPatch: { ...patch, worldFacts: [{ text: "왕이 죽었다", evidence: "왕이 쓰러졌다" }] } }];
  await assert.rejects(generateChapter(options));
  assert.throws(() => mergeMemory(emptyStoryState(), { ...patch, characters: [{ name: "친구", goal: { text: "복수", evidence: "나는 복수한다" }, knowledge: [], relationships: [] }] }, prose, "서점"), /Unsupported/);
});

test("novel stages reject malformed or incomplete responses and propagate cancellation", async t => {
  const controller = new AbortController();
  let mode = "invalid";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, controller.signal);
    if (mode === "incomplete") return Response.json({ status: "incomplete", output: [] });
    return response({ wrong: true });
  });
  const options = { character, direction: "이어줘", key: "test", signal: controller.signal, phase: () => {} };
  await assert.rejects(generateChapter(options));
  mode = "incomplete"; await assert.rejects(generateChapter(options), /Incomplete/);
  controller.abort(); await assert.rejects(generateChapter(options), { name: "AbortError" });
});

test("memory stays bounded, detects copied prose and rejects excessive client state", () => {
  const state = { ...emptyStoryState(), recentEvents: Array.from({ length: 24 }, (_, i) => `이전 사건${i}`), resolvedEvents: Array.from({ length: 24 }, (_, i) => `해결${i}`), openThreads: ["미해결"] };
  const updated = mergeMemory(state, { ...patch, closedThreads: [{ text: "미해결", evidence: fact.evidence }] }, prose, "서점");
  assert.equal(updated.recentEvents.length, 8); assert.equal(updated.resolvedEvents.length, 24);
  assert.deepEqual(updated.openThreads, []);
  assert.equal(repeatsPrevious(prose, prose.replaceAll(" ", "\n")), true);
  assert.equal(repeatsPrevious(prose, "바다로 항해했다.".repeat(40)), false);
  assert.equal(storyStateSchema.safeParse({ ...state, previousProse: "x".repeat(8001) }).success, false);
  const crowded = { ...state, previousProse: "x".repeat(8000),
    worldFacts: Array.from({ length: 16 }, (_, i) => `${i}${"사실".repeat(100)}`),
    characters: Array.from({ length: 6 }, (_, i) => ({ name: `인물${i}`, goal: "목표", knowledge: Array.from({ length: 6 }, (_, j) => `${j}${"지식".repeat(100)}`), relationships: ["친구"] })) };
  const copy = structuredClone(crowded);
  const bounded = mergeMemory(crowded, patch, prose.repeat(8).slice(0, 8000), "서점");
  assert.ok(JSON.stringify(bounded).length <= 16000);
  assert.deepEqual(crowded, copy);
});

test("story API publishes no draft or memory when extraction fails", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  const values = [plan, prose, { ...review, memoryPatch: { wrong: true } }];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => response(values.shift(), init));
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, messages: [{ role: "user", content: "첫 장면" }] }) }));
  const wire = await result.text();
  assert.ok(wire.includes('"type":"error"'));
  assert.ok(!wire.includes('"type":"chapter"'));
  assert.ok(!wire.includes(prose)); assert.ok(!wire.includes('"type":"done"'));
});

test("review token exhaustion preserves failed usage and returns a specific error without paid retries",async t=>{
 const keys=["OPENAI_API_KEY","ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED"];
 const old=keys.map(key=>process.env[key]);
 process.env.OPENAI_API_KEY="test-key";process.env.ACCOUNT_FEATURES_ENABLED="false";process.env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED="false";
 t.after(()=>keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index];}));
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));
  if(calls<3)return response(calls===1?plan:prose,init);
  assert.equal(body.text.format.name,"chapter_review");
  assert.deepEqual(body.reasoning,{effort:"low"});assert.equal(body.max_output_tokens,12000);
  return Response.json({id:"review_limit",status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output:[],usage:{input_tokens:14101,output_tokens:12000,total_tokens:26101,output_tokens_details:{reasoning_tokens:12000}}});
 });
 const result=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"Content-Type":"application/json","X-Track-Usage":"1"},body:JSON.stringify({character,messages:[{role:"user",content:"첫 이야기"}]})}));
 const wire=await result.text();assert.equal(calls,3);
 assert.match(wire,/output_token_limit/);assert.match(wire,/자동 재시도는 하지 않았/);
 assert.ok(!wire.includes('"type":"chapter"'));assert.ok(!wire.includes('"type":"done"'));
 const events=wire.split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
 const record=events.filter(event=>event.type==="usage").map(event=>event.record).find(record=>record.responseId==="review_limit");
 assert.equal(record.status,"failed");assert.equal(record.totalTokens,26101);assert.equal(record.reasoningTokens,12000);
});
