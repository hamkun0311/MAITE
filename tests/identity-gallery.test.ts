import { test } from "node:test";
import assert from "node:assert/strict";
import { userDisplayName, userNamingInstructions } from "../lib/chat/identity.ts";
import { uniqueGalleryIds } from "../lib/characters/gallery.ts";
import { advanceTimeline, emptyTimeline, timelineChatMemory, timelineSchema } from "../lib/chat/timeline.ts";
import { emptyChatMemory, mergeChatMemory } from "../lib/chat/memory.ts";
import { POST } from "../app/api/chat/route.ts";
import { readEvents } from "../lib/chat/stream.ts";

test("concept self-designation overrides nickname without stealing an NPC identity", () => {
  assert.equal(userDisplayName({ concept: "희진은 롤랑과 사랑하고 있다.", userName: "햄군" }), "햄군");
  assert.equal(userDisplayName({ concept: "나는 수호기사 롤랑이다.", userName: "햄군" }), "수호기사 롤랑");
  assert.equal(userDisplayName({ concept: "나의 이름은 루이.", userName: "햄군" }), "루이");
  assert.equal(userDisplayName({ concept: "나(롤랑)는 공주의 친구", userName: "햄군" }), "롤랑");
  assert.equal(userDisplayName({ concept: "나의 이름은 루이.", userName: "햄군" }, "나의 호칭은 전하."), "전하");
  assert.equal(userDisplayName({ concept: "서점" }), "당신");
  assert.match(userNamingInstructions({ concept: "서점", userName: "햄군" }), /explicit self-name or role\/title/);
});

test("nicknames survive memory merging and timeline updates with stable participant IDs", () => {
  const memory = emptyChatMemory("희진"); memory.participants[0].name = "햄군";
  const next = mergeChatMemory(memory, { participants: [], updates: [], mood: null }, "안녕", "반가워");
  const timeline = advanceTimeline(emptyTimeline(), "희진", next, undefined, undefined, [], "햄군");
  assert.equal(timelineSchema.safeParse(timeline).success, true);
  assert.equal(timeline.participants.find(p => p.id === "user")?.name, "햄군");
  assert.equal(timelineChatMemory(emptyChatMemory("희진"), timeline).participants[0].name, "햄군");
});

test("legacy duplicate illustration IDs become unique without dropping different image jobs", () => {
  const images = [{ id: "original", jobId: "a" }, { id: "illustration-4", jobId: "b" }, { id: "illustration-4", jobId: "c" }];
  const fixed = uniqueGalleryIds(images);
  assert.equal(new Set(fixed.map(image => image.id)).size, 3);
  assert.deepEqual(fixed.map(image => image.jobId), ["a", "b", "c"]);
  assert.equal(fixed[1].id, "illustration-4");
  assert.deepEqual(uniqueGalleryIds(fixed), fixed);
  assert.equal(images[2].id, "illustration-4");
});

test("chat API normalizes legacy user labels and keeps the nickname or concept name on the first timeline", async t => {
  const names = ["OPENAI_API_KEY", "ACCOUNT_FEATURES_ENABLED", "NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED"];
  const old = names.map(name => process.env[name]);
  process.env.OPENAI_API_KEY = "mock-key";
  process.env.ACCOUNT_FEATURES_ENABLED = "false"; process.env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED = "false";
  t.after(() => names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }));
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body)); assert.match(body.instructions, /account nickname/);
    const result = { speechStyle: "casual", continuity: { actorId: null, targetId: null, intent: "other", premise: "consistent", factIds: [] }, utterances: ["다시 만나서 반가워."], clothingMentioned: false, locationChanged: false, memory: { participants: [], updates: [], mood: null } };
    return new Response(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(result) })}\n\ndata: {"type":"response.completed"}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  });
  for (const [concept, expected] of [["서점의 친구", "햄군"], ["나의 이름은 롤랑.", "롤랑"]]) {
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: { name: "희진", age: 25, personality: "다정함", concept, mode: "chat", imageDescription: "서점", userName: "햄군" }, chatMemory: emptyChatMemory("희진"), timeline: emptyTimeline(), messages: [{ role: "user", content: "안녕" }] }) }));
    assert.equal(response.status, 200);
    const events: Record<string, any>[] = []; for await (const event of readEvents(response.body!)) events.push(event);
    assert.equal(events.find(event => event.type === "memory")?.state.participants.find((p: { id: string }) => p.id === "user")?.name, expected);
    assert.equal(events.find(event => event.type === "timeline")?.state.participants.find((p: { id: string }) => p.id === "user")?.name, expected);
    assert.equal(events.at(-1)?.type, "done");
  }
});
