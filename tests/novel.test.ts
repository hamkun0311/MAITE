import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChapter } from "../lib/novel/generate.ts";
import { emptyStoryState, mergeMemory, repeatsPrevious, storyStateSchema } from "../lib/novel/state.ts";
import { POST } from "../app/api/chat/route.ts";
import { manuscriptSources, resolveSources } from "../lib/novel/sources.ts";

const character = { mode: "story" as const, name: "서하", age: 25, personality: "다정함", concept: "친구와 서점 복구", genre: "막장드라마" as const, imageDescription: "서점의 탐정" };
const prose = "서하는 서랍에서 계약서를 찾았다. 그가 약속한 수리 날짜가 문서에 적혀 있었다. " + "그녀는 친구에게 전화를 걸어 내일 함께 서점을 정리하자고 말했다. 망설이던 친구가 수화기 너머에서 웃었다. " + "둘은 닫힌 서점 문을 열고 먼지 쌓인 책을 창가로 옮겼다. 새로 비워진 진열대 사이로 햇빛이 들어왔다. 오래 미뤄 두었던 일이 드디어 시작되었다. " + "친구가 가져온 달력에 수리 날짜를 표시했다. 내일 아침에는 창문을 닦기로 했다.";
const fact = { text: "계약서를 찾았다", evidence: "서하는 서랍에서 계약서를 찾았다." };
const plan = { chapterGoal: "서점 복구를 시작한다", longTermGoal: "함께 서점을 다시 연다", newInformation: "계약서의 날짜", protagonistChoice: "친구를 부른다", costOrConsequence: "함께 정리를 시작한다",
  beats: [1, 2, 3].map(i => ({ goal: `목표${i}`, obstacle: "망설임", action: "정리한다", outcome: "진전" })), endingChange: "서점 문을 열었다", mustNotRepeat: [] };
const review = { pass: true, blockingIssues: [], completedBeats: [1, 2, 3], newEvents: [fact], endingChange: { text: "정리가 시작됨", evidence: "오래 미뤄 두었던 일이 드디어 시작되었다." } };
const patch = { summary: "서하가 계약서를 찾아 친구와 서점 정리를 시작했다.", currentSituation: fact,
  newEvents: [fact], resolvedEvents: [fact], openedThreads: [], closedThreads: [], worldFacts: [fact],
  characters: [{ name: "서하", goal: null, knowledge: [fact], relationships: [] }], nextChapterGoal: "창문을 닦는다" };
const response = (value: unknown, init?: RequestInit) => {
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

test("source references select real manuscript passages instead of generated quotations", () => {
  const sources = manuscriptSources("“반가워.” 서하는 손을 내밀었다.\n응. " + "긴 문장".repeat(150));
  assert.ok(sources.every(source => source.text.length <= 360));
  const quoted = resolveSources({ evidence: sources[0].id, nested: [{ evidence: sources[1].id }] }, sources);
  assert.equal(quoted.evidence, sources[0].text);
  assert.equal(quoted.nested[0].evidence, sources[1].text);
  assert.throws(() => resolveSources({ evidence: "서하는 달아났다" }, sources), /Invalid manuscript source/);
});

test("a passing review with source IDs commits the first chapter without a quotation rewrite", async t => {
  let calls = 0;
  const values: unknown[] = [plan, prose, review, patch];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const input = JSON.parse(body.input);
    if (["chapter_review", "memory_patch"].includes(body.text?.format?.name)) {
      assert.ok(input.sourceUnits.length > 0);
      assert.deepEqual(body.text.format.schema.properties.newEvents.items.properties.evidence.enum, input.sourceUnits.map((unit: { id: string }) => unit.id));
      assert.doesNotMatch(body.instructions, /You are writing immersive fictional character roleplay/);
    }
    calls++;
    return response(values.shift(), init);
  });
  const result = await generateChapter({ character, direction: "첫 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
  assert.equal(result.state.chapter, 1); assert.equal(calls, 4);
});

test("novel pipeline plans, writes, reviews and merges only grounded events; writer gets compact memory", async t => {
  const old = { ...emptyStoryState(), chapter: 3, summary: "친구와 약속했다", worldFacts: ["서점은 도시 안에 있다"], resolvedEvents: ["친구와 화해함"], previousProse: "이전 전체 원고", previousEnding: "문 앞에 섰다", nextChapterGoal: "문을 연다" };
  const before = structuredClone(old);
  const bodies: Record<string, unknown>[] = [];
  const values = [plan, prose, review, patch];
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
  let values: unknown[] = [plan, prose, bad, prose, review, patch];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const state = emptyStoryState();
  const options = { character, state, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  assert.equal((await generateChapter(options)).state.chapter, 1);
  assert.equal(calls, 6);
  values = [plan, prose, bad, prose, bad]; calls = 0;
  await assert.rejects(generateChapter(options), /review failed/);
  assert.equal(calls, 5); assert.equal(state.chapter, 0);
});

test("partial beat completion and advisory missing beats do not reject meaningful progression", async t => {
  for (const critique of [
    { ...review, completedBeats: [1, 2] },
    { ...review, pass: false, completedBeats: [1, 2], blockingIssues: [{ type: "missing_beat", evidence: fact.evidence, fix: "나머지 장면은 다음 화에 이어간다" }] },
  ]) {
    const values: unknown[] = [{ ...plan, beats: [...plan.beats, plan.beats[0]] }, prose, critique, patch];
    let calls = 0;
    const mocked = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
    const result = await generateChapter({ character, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
    assert.equal(result.state.chapter, 1); assert.equal(calls, 4);
    mocked.mock.restore();
  }
});

test("ungrounded criticism cannot trigger a rewrite and unsupported memory cannot commit", async t => {
  let values: unknown[] = [plan, prose, { ...review, pass: false, blockingIssues: [{ type: "continuity", evidence: "원고에 없는 비밀 문장", fix: "수정" }] }];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const options = { character, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  await assert.rejects(generateChapter(options)); assert.equal(calls, 3);
  values = [plan, prose, review, { ...patch, worldFacts: [{ text: "왕이 죽었다", evidence: "왕이 쓰러졌다" }] }];
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
  const values = [plan, prose, review, { wrong: true }];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => response(values.shift(), init));
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, messages: [{ role: "user", content: "첫 장면" }] }) }));
  const wire = await result.text();
  assert.ok(wire.includes('"type":"error"'));
  assert.ok(!wire.includes('"type":"chapter"'));
  assert.ok(!wire.includes(prose)); assert.ok(!wire.includes('"type":"done"'));
});
