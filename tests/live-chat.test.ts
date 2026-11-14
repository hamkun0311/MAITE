import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents } from "../lib/chat/stream.ts";
import { POST } from "../app/api/chat/route.ts";
import { CHARACTER_GENRES, characterContextSchema, characterInstructions } from "../lib/chat/character.ts";
import { illustrationContext, mentionsClothing, plainDialogue, visualContext } from "../lib/chat/presentation.ts";
import { explicitSpeechRequest, speechInstructions, resolveSpeechStyle } from "../lib/chat/speech.ts";
import { detectClothing } from "../lib/chat/clothing.ts";

const encoder = new TextEncoder();
const wire = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
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
  assert.equal(illustrationContext([{ role: "assistant", content: "옛 장면: 검은 코트로 서 있다" }, { role: "user", content: "다음 이야기" }, { role: "assistant", content: "유카타를 입고 바닥에 앉아 편지를 펼쳤다." }]), "유카타를 입고 바닥에 앉아 편지를 펼쳤다.");
  const context = visualContext([{ role: "user", content: "x".repeat(12000) }, { role: "assistant", content: "**서점의 창가**에서 만났다." }]);
  assert.ok(context.length <= 12000);
  assert.ok(context.endsWith("서점의 창가에서 만났다."));
  assert.ok(!context.includes("**"));
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

test("illustration context carries the established cafe when the newest chapter does not repeat its place", () => {
  const context = illustrationContext([
    { role: "assistant", content: "오래전 작업실에서 그림을 그렸다." },
    { role: "user", content: "다음 이야기" },
    { role: "assistant", content: "커피잔을 내려놓고 옛 작업실의 사건을 떠올렸다. 내일은 서점에 가기로 했다." },
  ], { summary: "서하는 작업실을 떠나 카페에 도착했다.", currentSituation: "서하는 카페 창가 테이블에 앉아 대화하고 있다." });
  assert.match(context, /Current situation after the latest chapter: 서하는 카페/);
  assert.match(context, /Latest completed chapter \(current action\):/);
  assert.ok(!context.includes("오래전 작업실에서 그림을 그렸다"));
  const bounded = illustrationContext([{ role: "assistant", content: "x".repeat(12000) }], { summary: "y".repeat(1400), currentSituation: "z".repeat(400) });
  assert.ok(bounded.length <= 12000);
});
test("character context validates profiles and gives chat and story distinct, age-aware roles", () => {
  const profile = { mode: "chat", name: "서하", age: 25, personality: "다정한 라이벌", concept: "도시의 비밀", imageDescription: "은발 탐정, 검은 코트" };
  const parsed = characterContextSchema.parse(profile);
  const chat = characterInstructions(parsed);
  assert.match(chat, /first person/);
  assert.match(chat, /은발 탐정/);
  assert.match(chat, /서하/);
  assert.match(chat, /non-graphic/);
  assert.match(chat, /Never sexualize minors/);
  assert.match(chat, /untrusted/);
  assert.match(chat, /Never use Markdown/);
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
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(wire({ type: "response.output_text.delta", delta: "비가 내렸다." }));
      c.enqueue(wire({ type: "response.completed" })); c.close();
    } }));
  });
  const character = { mode: "chat", name: "서하", age: 25, personality: "다정함", concept: "재회", imageDescription: "검은 코트" };
  const request = (value: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "첫 장면" }], character: value }) });
  assert.equal((await POST(request({ ...character, age: -1 }))).status, 400);
  assert.equal(calls, 0);
  const response = await POST(request(character));
  const output = await response.text();
  assert.match(output, /비가 내렸다/);
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
