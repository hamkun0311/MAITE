import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents } from "../lib/chat/stream.ts";
import { POST } from "../app/api/chat/route.ts";

const encoder = new TextEncoder();
const wire = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
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
