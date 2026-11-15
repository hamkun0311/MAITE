import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents } from "../lib/chat/stream.ts";
import { POST } from "../app/api/chat/route.ts";
import { CHARACTER_GENRES, characterContextSchema, characterInstructions } from "../lib/chat/character.ts";
import { illustrationContext, mentionsClothing, plainDialogue, visualContext, outfitContext } from "../lib/chat/presentation.ts";
import { explicitSpeechRequest, speechInstructions, resolveSpeechStyle } from "../lib/chat/speech.ts";
import { detectClothing } from "../lib/chat/clothing.ts";
import { dialogueSchema, streamedDialogue } from "../lib/chat/dialogue.ts";
import { characterDialogueSchema, chatMemorySchema, emptyChatMemory, mergeChatMemory, type ChatMemoryPatch } from "../lib/chat/memory.ts";

const encoder = new TextEncoder();
const wire = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
const emptyPatch = (): ChatMemoryPatch => ({ participants: [], updates: [], mood: null });
const verdict = { actorId: null, targetId: null, premise: "consistent", factIds: [] };

test("conversation memory separates participants, preserves sources and applies explicit actor corrections", () => {
  const state = emptyChatMemory("유나");
  const first = mergeChatMemory(state, {
    participants: [{ id: "npc_1", name: "민수", evidence: "민수가 늦는대" }],
    updates: [{ subjectId: "npc_1", objectId: null, action: "arrival_status", value: "오늘 늦을 예정", certainty: "asserted", evidence: "민수가 늦는대", replaces: [] }],
    mood: { emotion: "curious", evidence: "얼마나 늦는데?" },
  }, "민수가 늦는대", "얼마나 늦는데?");
  assert.equal(state.turn, 0);
  assert.equal(first.facts[0].subjectId, "npc_1");
  assert.equal(first.facts[0].sourceTurnId, "user_1");
  assert.equal(first.emotion, "curious");
  const corrected = mergeChatMemory(first, { ...emptyPatch(), updates: [{ subjectId: "user", objectId: null, action: "arrival_status", value: "사용자가 늦을 예정", certainty: "asserted", evidence: "내가 늦어", replaces: [first.facts[0].id] }] }, "아니, 내가 늦어", "아, 네가 늦는 거구나.");
  assert.equal(corrected.facts.length, 1);
  assert.equal(corrected.facts[0].subjectId, "user");
  assert.equal(corrected.facts[0].sourceTurnId, "user_2");
  assert.equal(corrected.emotion, "curious");
  assert.deepEqual(corrected.participants, first.participants);
});

test("unsupported, uncertain, misattributed and third-party simulated facts never enter memory", () => {
  const state = emptyChatMemory("유나");
  const sample = { subjectId: "character", action: "arrival_status", objectId: null, value: "늦음", certainty: "asserted", evidence: "내가 늦어", replaces: [] } as const;
  const result = mergeChatMemory(state, { participants: [{ id: "npc_1", name: "민수", evidence: "언급되지 않음" }], mood: null, updates: [
    { ...sample, replaces: [] },
    { ...sample, subjectId: "user", certainty: "inferred", replaces: [] },
    { ...sample, subjectId: "npc_2", replaces: [] },
    { ...sample, subjectId: "user", evidence: "원문에 없는 말", replaces: [] },
    { ...sample, subjectId: "user", certainty: "simulated", evidence: "알겠어", replaces: [] },
  ] }, "내가 늦어", "알겠어");
  assert.equal(result.facts.length, 0);
  assert.equal(result.participants.length, 2);
  const external = mergeChatMemory(state, { ...emptyPatch(), updates: [{ ...sample, action: "send_message", certainty: "simulated", evidence: "보냈어", replaces: [] }] }, "민수한테 실제로 문자 보내줘", "보냈어");
  assert.equal(external.facts.length, 0);
  assert.equal(chatMemorySchema.safeParse({ ...state, participants: [state.participants[0], state.participants[0]] }).success, false);
  assert.equal(characterDialogueSchema.safeParse({ utterances: ["안녕"], memory: emptyPatch(), narration: "웃었다" }).success, false);
});

test("conversation memory stays bounded and never merges a different actor's unchanged fact", () => {
  let state = emptyChatMemory("유나");
  for (let index = 0; index < 40; index++) {
    state = mergeChatMemory(state, { ...emptyPatch(), updates: [{ subjectId: "user", objectId: null, action: `event_${index}`, value: "사건".repeat(90), certainty: "asserted", evidence: "내가 했어", replaces: [] }] }, "내가 했어", "기억할게");
  }
  assert.ok(state.facts.length <= 24);
  assert.ok(JSON.stringify(state).length <= 10000);
  assert.equal(state.turn, 40);
  const next = mergeChatMemory(state, { ...emptyPatch(), updates: [{ subjectId: "character", objectId: null, action: "event_39", value: "캐릭터가 함", certainty: "simulated", evidence: "내가 했어", replaces: [state.facts.at(-1)!.id] }] }, "뭐했어?", "내가 했어");
  assert.ok(next.facts.some(fact => fact.action === "event_39" && fact.subjectId === "user"));
  assert.ok(next.facts.some(fact => fact.action === "event_39" && fact.subjectId === "character"));
});

test("user source IDs restore exact evidence and named NPC statements cannot be assigned to the character", () => {
  const state = mergeChatMemory(emptyChatMemory("유나"), {
    participants: [{ id: "npc_1", name: "민수", evidence: "user_1_1" }], mood: null,
    updates: [
      { subjectId: "npc_1", action: "arrival_status", objectId: null, value: "민수가 늦음", certainty: "asserted", evidence: "user_1_1", replaces: [] },
      { subjectId: "character", action: "understanding", objectId: null, value: "캐릭터가 늦음", certainty: "asserted", evidence: "user_1_1", replaces: [] },
      { subjectId: "user", action: "arrival_status", objectId: null, value: "사용자가 도착함", certainty: "asserted", evidence: "user_1_2", replaces: [] },
    ],
  }, "민수는 늦는대. 나는 도착했어.", "네가 먼저 왔네.");
  assert.equal(state.facts.length, 2);
  assert.equal(state.facts[0].subjectId, "npc_1");
  assert.equal(state.facts[0].evidence, "민수는 늦는대.");
  assert.equal(state.facts[1].subjectId, "user");
  assert.equal(state.facts[1].evidence, "나는 도착했어.");
});

test("current location and outfit survive unrelated memory growth and newer outfits replace older ones", () => {
  let memory = mergeChatMemory(emptyChatMemory("서하"), { ...emptyPatch(), updates: [
    { subjectId: "character", objectId: null, action: "location", value: "옷가게 피팅룸", certainty: "simulated", evidence: "피팅룸이야", replaces: [] },
    { subjectId: "character", objectId: null, action: "outfit", value: "파란 원피스", certainty: "simulated", evidence: "파란 원피스 입었어", replaces: [] },
  ] }, "갈아입어줘", "피팅룸이야. 파란 원피스 입었어.");
  for (let index = 0; index < 35; index++) memory = mergeChatMemory(memory, { ...emptyPatch(), updates: [
    { subjectId: "user", objectId: null, action: `event_${index}`, value: "지나간 사건".repeat(30), certainty: "asserted", evidence: "내가 했어", replaces: [] },
  ] }, "내가 했어", "알겠어");
  assert.ok(memory.facts.some(fact => fact.action === "location" && fact.value === "옷가게 피팅룸"));
  assert.ok(memory.facts.some(fact => fact.action === "outfit" && fact.value === "파란 원피스"));
  assert.ok(memory.facts.length <= 24 && JSON.stringify(memory).length <= 10000);
  memory = mergeChatMemory(memory, { ...emptyPatch(), updates: [
    { subjectId: "character", objectId: null, action: "outfit", value: "흰색 셔츠", certainty: "simulated", evidence: "흰색 셔츠로 갈아입었어", replaces: [] },
  ] }, "셔츠로 바꿔줘", "흰색 셔츠로 갈아입었어");
  assert.ok(!memory.facts.some(fact => fact.action === "outfit" && fact.value === "파란 원피스"));
  assert.ok(memory.facts.some(fact => fact.action === "outfit" && fact.value === "흰색 셔츠"));
});

test("chat API returns grounded memory alongside speech and reuses it when older messages are trimmed", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  let generation = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.text?.format?.name === "speech_style") return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"speechStyle":"casual"}' }] }] });
    if (body.text?.format?.name === "clothing_mention") return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"mentioned":false}' }] }] });
    generation++;
    if (generation === 2) {
      assert.match(body.instructions, /"subjectId":"user"/);
      assert.match(body.instructions, /내가 늦어/);
      assert.match(body.instructions, /never say it was sent/);
      assert.deepEqual(body.input, [{ role: "user", content: "그럼 둘이 놀자. 반말해줘" }]);
    }
    const memory = generation === 1 ? { ...emptyPatch(), participants: [{ id: "npc_1", name: "민수", evidence: "민수 만나기로 했는데" }], updates: [{ subjectId: "user", objectId: null, action: "arrival_status", value: "오늘 늦음", certainty: "asserted", evidence: "내가 늦어", replaces: [] }] } : emptyPatch();
    const result = { continuity: verdict, utterances: [generation === 1 ? "늦는 건 너구나." : "잠깐, 늦는 건 너잖아. 민수는 아직 오는 거고. ㅋㅋ"], memory };
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(wire({ type: "response.output_text.delta", delta: JSON.stringify(result) }));
      controller.enqueue(wire({ type: "response.completed" })); controller.close();
    } }));
  });
  const character = { mode: "chat", name: "유나", age: 25, personality: "자기 의견이 뚜렷함", concept: "친구들과 약속", imageDescription: "검은 코트" };
  const request = (content: string, chatMemory?: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, messages: [{ role: "user", content }], ...(chatMemory ? { chatMemory } : {}) }) });
  const first = await POST(request("민수 만나기로 했는데 내가 늦어. 반말해줘"));
  const events = []; for await (const event of readEvents(first.body!)) events.push(event);
  const memory = events.find(event => event.type === "memory")!;
  assert.equal(memory.expectedTurn, 0);
  assert.equal(chatMemorySchema.parse(memory.state).facts[0].subjectId, "user");
  assert.equal(events.at(-1)!.type, "done");
  const second = await POST(request("그럼 둘이 놀자. 반말해줘", memory.state));
  const output = await second.text();
  assert.match(output, /"expectedTurn":1/);
  assert.match(output, /"turn":2/);
  assert.ok(!output.includes('"utterances"'));
});
test("dialogue-only streaming decodes utterances across every escape/chunk boundary and preserves emoticons", () => {
  const json = '{"utterances":["반가워요 \\ud83d\\ude0a ^_^~", "왜요? ㅎㅎ \\"좋아요\\"라고 했잖아요."]}';
  const expected = dialogueSchema.parse(JSON.parse(json)).utterances.join("\n\n");
  let previous = "";
  for (let i = 0; i <= json.length; i++) {
    const next = streamedDialogue(json.slice(0, i));
    assert.ok(next.startsWith(previous));
    assert.ok(!/[\uD800-\uDBFF]$/.test(next));
    previous = next;
  }
  assert.equal(previous, expected);
  assert.equal(plainDialogue("**안녕** 😊 ^_^~ ㅎㅎ :) (≧▽≦)", "chat"), "안녕 😊 ^_^~ ㅎㅎ :) (≧▽≦)");
  assert.equal(streamedDialogue('카페의 조명이 흔들렸다.'), "");
  assert.equal(dialogueSchema.safeParse({ utterances: ["안녕"], narration: "미소 지었다" }).success, false);
  assert.equal(dialogueSchema.safeParse({ utterances: [] }).success, false);
  const privateJson = JSON.stringify({ continuity: verdict, utterances: ["늦는 건 너잖아 😏"], memory: emptyPatch() });
  let decoded = "";
  for (let index = 0; index <= privateJson.length; index++) {
    const next = streamedDialogue(privateJson.slice(0, index));
    assert.ok(next.startsWith(decoded)); decoded = next;
  }
  assert.equal(decoded, "늦는 건 너잖아 😏");
});
test("dialogue removes formatting without losing prose and visual context stays bounded", () => {
  assert.equal(plainDialogue('**안녕.** *미소를 짓는다.*\n\n“다시 만나서 반가워.”'), '안녕. 미소를 짓는다.\n\n“다시 만나서 반가워.”');
  assert.equal(plainDialogue('## 제목\n- __문장__\n> `대사`'), '제목\n문장\n대사');
  assert.equal(plainDialogue('```text\n안녕\n```'), '안녕\n');
  assert.equal(plainDialogue('```안녕```'), '안녕');
  assert.equal(mentionsClothing([{ role: "assistant", content: "파란 코트를 입었어." }]), true);
  assert.equal(mentionsClothing([{ role: "assistant", content: "흰 패딩과 부츠 차림이야." }]), true);
  assert.equal(mentionsClothing([{ role: "user", content: "Wear a cardigan." }]), true);
  assert.equal(mentionsClothing([{ role: "assistant", content: "오늘은 뭐 하고 지냈어?" }]), false);
  for (const content of ["유카타", "기모노", "치파오", "아오자이", "사리", "하오리", "yukata", "a kimono", "a qipao"])
    assert.equal(mentionsClothing([{ role: "assistant", content }]), true);
  assert.ok(illustrationContext([{ role: "assistant", content: "옛 장면: 검은 코트로 서 있다" }, { role: "user", content: "다음 이야기" }, { role: "assistant", content: "유카타를 입고 바닥에 앉아 편지를 펼쳤다." }]).endsWith("Latest completed chapter (current action):\n유카타를 입고 바닥에 앉아 편지를 펼쳤다."));
  const context = visualContext([{ role: "user", content: "x".repeat(12000) }, { role: "assistant", content: "**서점의 창가**에서 만났다." }]);
  assert.ok(context.length <= 12000);
  assert.ok(context.endsWith("서점의 창가에서 만났다."));
  assert.ok(!context.includes("**"));
});

test("outfit context carries established clothes and location beyond recent dialogue without using an NPC's outfit", () => {
  const memory = chatMemorySchema.parse({ ...emptyChatMemory("서하"), turn: 1,
    participants: [{ id: "user", name: "사용자" }, { id: "character", name: "서하" }, { id: "npc_1", name: "점원" }],
    facts: [
      { id: "fact_1_0", subjectId: "character", objectId: null, action: "location", value: "옷가게 피팅룸에 도착해 거울 앞에 서 있다", certainty: "simulated", evidence: "옷가게 피팅룸이야", sourceTurnId: "character_1" },
      { id: "fact_1_1", subjectId: "character", objectId: null, action: "outfit", value: "카페 앞치마를 벗고 파란 원피스를 입었다", certainty: "simulated", evidence: "파란 원피스 입었어", sourceTurnId: "character_1" },
      { id: "fact_1_2", subjectId: "npc_1", objectId: null, action: "outfit", value: "점원은 빨간 제복", certainty: "asserted", evidence: "점원은 빨간 제복", sourceTurnId: "user_1" },
    ],
  });
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `${index} ${"오늘 즐거웠어. ".repeat(300)}` }));
  messages.at(-1)!.content = "이 원피스 어때?";
  const context = outfitContext(messages, memory);
  assert.ok(context.length <= 12000);
  assert.match(context, /옷가게 피팅룸/);
  assert.match(context, /카페 앞치마를 벗고 파란 원피스/);
  assert.match(context, /"subjectId":"character"/);
  assert.ok(!context.includes("점원은 빨간 제복"));
  assert.ok(context.endsWith("이 원피스 어때?"));
  const older = [{ role: "user" as const, content: "옷가게에 도착했어." }, ...messages.slice(-16).map(message => ({ ...message, content: "계속 얘기하자." }))];
  assert.match(outfitContext(older), /옷가게에 도착했어/);
});

test("clothing names bypass extra calls and uncommon garments are detected semantically", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    assert.equal(body.text.format.name, "clothing_mention");
    assert.match(body.input, /키톤/);
    assert.match(body.instructions, /NAME ALONE/);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"mentioned":true}' }] }] });
  });
  const options = { key: "test", signal: new AbortController().signal };
  assert.equal(await detectClothing({ ...options, messages: [{ role: "assistant", content: "유카타" }] }), true);
  assert.equal(calls, 0);
  assert.equal(await detectClothing({ ...options, messages: [{ role: "assistant", content: "오늘은 키톤으로 정했어." }] }), true);
  assert.equal(calls, 1);
});

test("illustration context preserves arrival at home across a morning transition and misleading workplace discussion", () => {
  const context = illustrationContext([
    { role: "assistant", content: "카페에서 근무를 마쳤다." },
    { role: "assistant", content: "집에 도착하자마자 서하는 냉장고를 열었다. 식탁에 케이크를 놓고 파티를 했다." },
    { role: "user", content: "다음 이야기" },
    { role: "assistant", content: "아침 식탁에는 파티의 흔적이 남아 있었다. 옆에 앉아 손을 잡고 매니저의 메모를 읽었다. 다음 근무 때 카페에서 본사 사람을 만나기로 했다." },
  ], { summary: "서하는 카페 직원이다.", currentSituation: "본사 대응을 준비한다." });
  assert.match(context, /집에 도착하자마자/);
  assert.match(context, /아침 식탁/);
  assert.ok(!context.includes("카페에서 근무를 마쳤다"));
  const bounded = illustrationContext(Array.from({ length: 3 }, () => ({ role: "assistant" as const, content: "x".repeat(14000) })), { summary: "s".repeat(2000), currentSituation: "c".repeat(1000) });
  assert.ok(bounded.length <= 12000);
});

test("illustration context carries the established cafe when the newest chapter does not repeat its place", () => {
  const context = illustrationContext([
    { role: "assistant", content: "오래전 작업실에서 그림을 그렸다." },
    { role: "user", content: "다음 이야기" },
    { role: "assistant", content: "커피잔을 내려놓고 옛 작업실의 사건을 떠올렸다. 내일은 서점에 가기로 했다." },
  ], { summary: "서하는 작업실을 떠나 카페에 도착했다.", currentSituation: "서하는 카페 창가 테이블에 앉아 대화하고 있다." });
  assert.match(context, /Current situation after the latest chapter: 서하는 카페/);
  assert.match(context, /Latest completed chapter \(current action\):/);
  assert.match(context, /Previous chapter \(location continuity only/);
  const bounded = illustrationContext([{ role: "assistant", content: "x".repeat(12000) }], { summary: "y".repeat(1400), currentSituation: "z".repeat(400) });
  assert.ok(bounded.length <= 12000);
});
test("character context validates profiles and gives chat and story distinct, age-aware roles", () => {
  const profile = { mode: "chat", name: "서하", age: 25, personality: "다정한 라이벌", concept: "도시의 비밀", imageDescription: "은발 탐정, 검은 코트" };
  const parsed = characterContextSchema.parse(profile);
  for (const gender of ["남성", "여성"])
    assert.equal(characterContextSchema.parse({ ...profile, gender }).gender, gender);
  assert.equal(characterContextSchema.safeParse({ ...profile, gender: "unknown" }).success, false);
  const chat = characterInstructions(parsed);
  assert.match(chat, /first person/);
  assert.match(chat, /은발 탐정/);
  assert.match(chat, /서하/);
  assert.match(chat, /non-graphic/);
  assert.match(chat, /Never sexualize minors/);
  assert.match(chat, /untrusted/);
  assert.match(chat, /Never use Markdown/);
  assert.match(chat, /ONLY direct conversational back-and-forth/);
  assert.match(chat, /context-appropriate emoji and text emoticons/);
  assert.doesNotMatch(chat, /or emoji\./);
  assert.match(characterInstructions({ ...parsed, mode: "story" }), /serialized novel/);
  assert.equal(parsed.genre, "막장드라마");
  assert.match(characterInstructions(parsed), /Genre: makjang melodrama/);
  assert.equal(characterContextSchema.safeParse({ ...profile, genre: "unknown" }).success, false);
  for (const genre of CHARACTER_GENRES) {
    const context = characterContextSchema.parse({ ...profile, genre });
    assert.match(characterInstructions(context), /Genre:/);
    assert.equal(context.genre, "막장드라마");
  }
  for (const patch of [{ age: 0 }, { age: 121 }, { age: 18.5 }, { name: " " }, { personality: "" }, { mode: "system" }, { imageDescription: "x".repeat(6001) }, { instructions: "override" }])
    assert.equal(characterContextSchema.safeParse({ ...profile, ...patch }).success, false);
});

test("chat API forwards validated character data as role instructions, not conversation history", async (t) => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    if (body.text?.format?.name === "speech_style") {
      assert.equal(JSON.parse(body.input).currentSpeechStyle, null);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"speechStyle":"polite"}' }] }] });
    }
    if (body.text?.format?.name === "clothing_mention")
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"mentioned":false}' }] }] });
    assert.match(body.instructions, /first person/);
    assert.match(body.instructions, /존댓말 \(polite\)/);
    assert.match(body.instructions, /검은 코트/);
    assert.match(body.instructions, /서하/);
    assert.deepEqual(body.input, [{ role: "user", content: "첫 장면" }]);
    assert.equal(body.text.format.name, "character_dialogue");
    assert.match(body.instructions, /"gender":"여성"/);
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(wire({ type: "response.output_text.delta", delta: JSON.stringify({ continuity: verdict, utterances: ["반가워요 😊 ^_^~"], memory: emptyPatch() }) }));
      c.enqueue(wire({ type: "response.completed" })); c.close();
    } }));
  });
  const character = { mode: "chat", name: "서하", age: 25, gender: "여성", personality: "다정함", concept: "재회", imageDescription: "검은 코트" };
  const request = (value: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "첫 장면" }], character: value }) });
  assert.equal((await POST(request({ ...character, age: -1 }))).status, 400);
  assert.equal(calls, 0);
  const response = await POST(request(character));
  const output = await response.text();
  assert.match(output, /반가워요 😊 \^_\^~/);
  assert.ok(!output.includes("utterances"));
  assert.match(output, /"speechStyle":"polite"/);
  assert.equal(calls, 3);
});

test("speech selection uses durable register, concept and latest request; failures do not silently switch", async t => {
  const character = characterContextSchema.parse({ mode: "chat", name: "서하", age: 25, personality: "다정함", concept: "존댓말을 쓰는 탐정", imageDescription: "검은 코트" });
  let completed = true;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "gpt-5.4-mini");
    const input = JSON.parse(body.input);
    assert.equal(input.currentSpeechStyle, "polite");
    assert.match(input.character.concept, /존댓말/);
    assert.deepEqual(input.messages, [{ role: "user", content: "우리 이제 서로 편하게 말하자." }]);
    assert.match(body.instructions, /latest explicit request/);
    assert.match(body.instructions, /hypothetical examples, negations/);
    return Response.json({ status: completed ? "completed" : "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: '{"speechStyle":"casual"}' }] }] });
  });
  const options = { character, current: "polite" as const, messages: [{ role: "user" as const, content: "우리 이제 서로 편하게 말하자." }], key: "test", signal: new AbortController().signal };
  assert.equal(await resolveSpeechStyle(options), "casual");
  assert.match(speechInstructions("casual"), /Never slip into -요/);
  assert.match(speechInstructions("polite"), /Never slip into 반말/);
  completed = false;
  await assert.rejects(resolveSpeechStyle(options), /Incomplete speech style/);
});

test("character dialogue streams only utterance values and malformed outputs never complete", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  let source!: ReadableStreamDefaultController<Uint8Array>;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; } })));
  const request = () => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: { mode: "chat", name: "서하", age: 25, gender: "여성", personality: "차분함", concept: "재벌가의 비밀과 폭풍 속 재회", imageDescription: "성인 여성" }, messages: [{ role: "user", content: "유카타 입고 반말해줘" }] }) });
  const response = await POST(request());
  const events = readEvents(response.body!);
  source.enqueue(wire({ type: "response.output_text.delta", delta: '{"continuity":'+JSON.stringify(verdict)+',"utterances":["유카타 입었어 😊' }));
  assert.deepEqual((await events.next()).value, { type: "delta", text: "유카타 입었어 😊" });
  source.enqueue(wire({ type: "response.output_text.delta", delta: ' 어때?","몰래 만나자 ㅎㅎ"],"memory":{"participants":[],"updates":[],"mood":null}}' }));
  source.enqueue(wire({ type: "response.completed" }));
  const rest = []; for await (const event of events) rest.push(event);
  assert.equal(rest[0].text, " 어때?\n\n몰래 만나자 ㅎㅎ");
  assert.equal(rest.at(-1)!.type, "done");
  assert.ok(!JSON.stringify(rest).includes("utterances"));
  const invalid = await POST(request());
  source.enqueue(wire({ type: "response.output_text.delta", delta: '{"utterances":["유카타"],"narration":"그녀는 고개를 끄덕였다"}' }));
  source.enqueue(wire({ type: "response.completed" }));
  const failure = await invalid.text();
  assert.match(failure, /"type":"error"/);
  assert.ok(!failure.includes("그녀는 고개를 끄덕였다"));
  assert.ok(!failure.includes('"type":"done"'));
});

test("clear speech requests override a concept directly without interpreting quoted or negated requests", async t => {
  for (const text of ["반말해줘", "이제 저한테 반말해도 돼. 편하게 말해줘.", "우리 반말하자", "반말로 말해줘"])
    assert.equal(explicitSpeechRequest(text), "casual");
  for (const text of ["존댓말로만 말해 주세요.", "다시 존댓말해주세요", "존댓말 써주세요"])
    assert.equal(explicitSpeechRequest(text), "polite");
  for (const text of ['“반말해줘”라는 대사가 있어', "반말해줘라고 말하지 마", "제가 반말해도 돼요?", "반말하지 말고 존댓말해줘", "반말해줘라는 말을 번역해줘", "오늘 뭐했어?", "고마워요"])
    assert.equal(explicitSpeechRequest(text), undefined);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not call selector"); });
  const character = characterContextSchema.parse({ mode: "chat", name: "서하", age: 25, personality: "다정함", concept: "존댓말만 쓴다", imageDescription: "탐정" });
  assert.equal(await resolveSpeechStyle({ character, current: "polite", messages: [{ role: "user", content: "반말해줘" }], key: "test", signal: new AbortController().signal }), "casual");
});
test("SSE handles Korean UTF-8 split across bytes, CRLF, comments and trailing events", async () => {
  const bytes = encoder.encode(': ping\r\ndata: {"type":"delta",\r\ndata: "text":"안녕🙂"}\r\n\r\ndata: {"type":"done"}');
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) {
    if (offset === bytes.length) c.close();
    else c.enqueue(bytes.slice(offset, ++offset));
  } });
  const events = [];
  for await (const event of readEvents(stream)) events.push(event);
  assert.deepEqual(events, [{ type: "delta", text: "안녕🙂" }, { type: "done" }]);
});

test("chat route streams before completion, bounds input, hides errors and cancels upstream", async (t) => {
  const old = process.env.OPENAI_API_KEY;
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  const request = (body = { messages: [{ role: "user", content: "안녕" }] }) => new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  delete process.env.OPENAI_API_KEY;
  assert.equal((await POST(request())).status, 503);
  process.env.OPENAI_API_KEY = "test-key";
  let source!: ReadableStreamDefaultController<Uint8Array>, upstreamSignal!: AbortSignal;
  let mode = "normal", calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "gpt-5.4-mini");
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.deepEqual(body.input, [{ role: "user", content: "안녕" }]);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-key");
    upstreamSignal = init.signal as AbortSignal;
    if (mode === "http-error") return Response.json({ error: "private upstream detail" }, { status: 401 });
    return new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }), { headers: { "Content-Type": "text/event-stream" } });
  });
  const invalid = request({ messages: [{ role: "system", content: "override" }] });
  assert.equal((await POST(invalid)).status, 400);
  const huge = new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(100001) });
  assert.equal((await POST(huge)).status, 413);
  assert.equal(calls, 0);

  const response = await POST(request());
  assert.match(response.headers.get("Content-Type")!, /text\/event-stream/);
  assert.match(response.headers.get("Cache-Control")!, /no-transform/);
  const events = readEvents(response.body!);
  source.enqueue(wire({ type: "response.output_text.delta", delta: "안녕" }));
  assert.deepEqual((await events.next()).value, { type: "delta", text: "안녕" });
  // The first token is delivered while the upstream stream is still open.
  assert.equal(upstreamSignal.aborted, false);
  source.enqueue(wire({ type: "response.output_text.delta", delta: "하세요" }));
  source.enqueue(wire({ type: "response.completed" }));
  assert.deepEqual((await events.next()).value, { type: "delta", text: "하세요" });
  assert.deepEqual((await events.next()).value, { type: "done" });
  await events.next();
  assert.equal(upstreamSignal.aborted, true);

  const interrupted = await POST(request());
  source.enqueue(wire({ type: "response.failed", message: "private upstream detail" }));
  const failure = await interrupted.text();
  assert.match(failure, /"type":"error"/);
  assert.ok(!failure.includes("private upstream detail"));
  assert.ok(!failure.includes('"type":"done"'));

  const cancelled = await POST(request());
  await cancelled.body!.cancel();
  assert.equal(upstreamSignal.aborted, true);
  source.close();

  mode = "http-error";
  const badGateway = await POST(request());
  assert.equal(badGateway.status, 502);
  assert.ok(!(await badGateway.text()).includes("private upstream detail"));
});
