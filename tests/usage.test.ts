import { test } from "node:test";
import assert from "node:assert/strict";
import { trackUsage, usageFetch, type UsageRecord } from "../lib/usage.ts";
import { POST } from "../app/api/chat/route.ts";
import { addUsageRecord, clearUsage, finishUsageTask, startUsageTask, sumUsage, usageSnapshot } from "../lib/usage-store.ts";

test("usage keeps cache/reasoning as subsets, missing counts unknown, and finalizes once", () => {
  const records: UsageRecord[] = [];
  const finish = trackUsage("chat.reply", "requested", record => records.push(record));
  finish({ id: "resp_1", model: "actual", usage: { input_tokens: 100, output_tokens: 25,
    input_tokens_details: { cached_tokens: 70 }, output_tokens_details: { reasoning_tokens: 10 } } });
  finish(undefined, "unknown");
  assert.equal(records.length, 2);
  assert.equal(records[1].totalTokens, 125);
  assert.equal(records[1].model, "actual");
  assert.equal(records[1].cachedTokens, 70);
  assert.equal(records[1].reasoningTokens, 10);
  const unknown: UsageRecord[] = [];
  trackUsage("novel.prose", "model", record => unknown.push(record))(undefined, "unknown");
  assert.equal(unknown[1].totalTokens, null);
});

test("JSON instrumentation preserves upstream data and records incomplete/failed/network requests", async t => {
  const records: UsageRecord[] = [];
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "incomplete", usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }));
  const { response, data } = await usageFetch("novel.chapter_review", "model", "https://example.test", {}, record => records.push(record));
  assert.equal(response.status, 200);
  assert.equal(data.status, "incomplete");
  assert.equal(records.at(-1)!.status, "failed");
  assert.equal(records.at(-1)!.totalTokens, 25);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network"); });
  await assert.rejects(usageFetch("chat.speech", "model", "https://example.test", {}, record => records.push(record)));
  assert.equal(records.at(-1)!.totalTokens, null);
  assert.equal(records.at(-1)!.status, "unknown");
});

test("tracked chat streams usage before completion and preserves consumed tokens on failed output", async t => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fake";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  const wire = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(wire({ type: "response.output_text.delta", delta: "안녕하세요" }));
    controller.enqueue(wire({ type: "response.incomplete", response: { usage: { input_tokens: 60, output_tokens: 10, total_tokens: 70 } } }));
    controller.close();
  } })));
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Track-Usage": "1" },
    body: JSON.stringify({ messages: [{ role: "user", content: "안녕" }] }) }));
  const text = await response.text();
  assert.match(text, /"totalTokens":70/);
  assert.match(text, /"status":"failed"/);
  assert.match(text, /"type":"error"/);
  assert.doesNotMatch(text, /"type":"done"/);
});

test("task ledger replaces duplicate events, retains failure costs, and leaves active work when cleared", t => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
  } });
  t.after(() => { if (saved) Object.defineProperty(globalThis, "sessionStorage", saved); else Reflect.deleteProperty(globalThis, "sessionStorage"); });
  const id = startUsageTask("이야기 1회차");
  const records: UsageRecord[] = [];
  const finish = trackUsage("novel.write", "model", record => records.push(record));
  finish({ usage: { input_tokens: 60, output_tokens: 15, total_tokens: 75 } });
  addUsageRecord(id, records[0]); addUsageRecord(id, records[1]); addUsageRecord(id, records[1]);
  assert.equal(usageSnapshot()[0].records.length, 1);
  assert.equal(sumUsage(usageSnapshot()[0].records, "totalTokens"), 75);
  const pending = { ...records[0], id: "pending" };
  addUsageRecord(id, pending);
  finishUsageTask(id, "failed");
  assert.equal(usageSnapshot()[0].records.find(record => record.id === "pending")!.status, "unknown");
  assert.equal(sumUsage(usageSnapshot()[0].records, "totalTokens"), 75);
  assert.ok([...storage.values()].some(value => value.includes('"totalTokens":75')));
  const active = startUsageTask("대화");
  clearUsage();
  assert.deepEqual(usageSnapshot().map(task => task.id), [active]);
});
