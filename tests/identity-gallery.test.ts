import { test } from "node:test";
import { visualKeywords } from "../lib/chat/presentation.ts";
import assert from "node:assert/strict";
import { userDisplayName, userNamingInstructions } from "../lib/chat/identity.ts";
import { uniqueGalleryIds, novelIllustration } from "../lib/characters/gallery.ts";
import { advanceTimeline, emptyTimeline, timelineChatMemory, timelineSchema } from "../lib/chat/timeline.ts";
import { emptyChatMemory, mergeChatMemory } from "../lib/chat/memory.ts";
import { POST } from "../app/api/chat/route.ts";
import { readEvents } from "../lib/chat/stream.ts";

test("novel backgrounds carry the nearest earlier illustration forward without using future or unrelated scenes",()=>{
 const images=[
  {id:"legacy",kind:"illustration",jobId:"legacy"},
  {id:"two",kind:"illustration",jobId:"two",scene:{novelId:"novel",chapter:2}},
  {id:"three-old",kind:"illustration",jobId:"three-old",scene:{novelId:"novel",chapter:3}},
  {id:"three",kind:"illustration",jobId:"three",scene:{novelId:"novel",chapter:3}},
  {id:"other",kind:"illustration",jobId:"other",scene:{novelId:"other",chapter:4}},
  {id:"unavailable",kind:"illustration",scene:{novelId:"novel",chapter:5}},
 ];
 assert.deepEqual([1,2,3,4,5].map(chapter=>novelIllustration(images,"novel",chapter)?.id),[undefined,"two","three","three","three"]);
 assert.equal(novelIllustration(images,"novel",4,"three-old")?.id,"three-old");
 assert.equal(novelIllustration(images,"novel",4,"two")?.id,"three");
 assert.equal(novelIllustration(images,undefined,5),undefined);
});

test("image keyword previews use the selected chapter and confirmed character facts without future places", () => {
 assert.deepEqual(visualKeywords("Previous chapter (location continuity only, NOT the moment to illustrate):\n카페에서 나왔다.\n\nLatest completed chapter (current action):\n검은 코트를 입고 서점에 도착했다. 내일은 왕궁에 가기로 했다."), ["검은 코트", "서점"]);
 const context = 'Established conversation continuity:\n'+JSON.stringify({participants:[],facts:[{subjectId:"user",action:"outfit",value:"파란 드레스",certainty:"asserted"},{subjectId:"character",action:"current_location",value:"카페 창가",certainty:"asserted"},{subjectId:"character",action:"outfit",value:"흰 셔츠",certainty:"asserted"}]})+'\n\nRecent completed dialogue:\n사용자: 안녕\n\n캐릭터: 내일 왕궁에 가자.';
 assert.deepEqual(visualKeywords(context),["카페 창가","흰 셔츠"]);
 assert.deepEqual(visualKeywords(""),[]);
});

test("concept self-designation overrides nickname without stealing an NPC identity", () => {
  assert.equal(userDisplayName({ concept: "희진은 롤랑과 사랑하고 있다.", userName: "햄군" }), "햄군");
  assert.equal(userDisplayName({ concept: "나는 수호기사 롤랑이다.", userName: "햄군" }), "수호기사 롤랑");
  assert.equal(userDisplayName({ concept: "나의 이름은 루이.", userName: "햄군" }), "루이");
  assert.equal(userDisplayName({ concept: "나(롤랑)는 공주의 친구", userName: "햄군" }), "롤랑");
  assert.equal(userDisplayName({ concept: "나의 이름은 루이.", userName: "햄군" }, "나의 호칭은 전하."), "전하");
  assert.equal(userDisplayName({ concept: "서점" }), "당신");
  for (const concept of ["나는 현아와 소꿉친구로 부모님들이 친구사이라", "나는 현아와 소꿉친구로 부모님들이 친구사이다.", "나는 현아와 친구다.", "나는 현아의 소꿉친구이다.", "나는 행복하다."]) {
    assert.equal(userDisplayName({concept,userName:"햄군"}),"햄군",concept);
    assert.equal(userDisplayName({concept}),"당신",concept);
  }
  assert.equal(userDisplayName({concept:"나는 현아와 소꿉친구로 부모님들이 친구사이다. 나의 이름은 민수.",userName:"햄군"}),"민수");
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
  for (const [concept, expected] of [["서점의 친구", "햄군"], ["나의 이름은 롤랑.", "롤랑"], ["나는 현아와 소꿉친구로 부모님들이 친구사이다.", "햄군"]]) {
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: { name: "희진", age: 25, personality: "다정함", concept, mode: "chat", imageDescription: "서점", userName: "햄군" }, chatMemory: emptyChatMemory("희진"), timeline: emptyTimeline(), messages: [{ role: "user", content: "안녕" }] }) }));
    assert.equal(response.status, 200);
    const events: Record<string, any>[] = []; for await (const event of readEvents(response.body!)) events.push(event);
    assert.equal(events.find(event => event.type === "memory")?.state.participants.find((p: { id: string }) => p.id === "user")?.name, expected);
    assert.equal(events.find(event => event.type === "timeline")?.state.participants.find((p: { id: string }) => p.id === "user")?.name, expected);
    assert.equal(events.at(-1)?.type, "done");
  }
});
