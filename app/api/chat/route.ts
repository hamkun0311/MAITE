import { z } from "zod";
import { readEvents } from "../../../lib/chat/stream.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const schema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8000),
  }).strict()).min(1).max(21),
}).strict().refine(({ messages }) =>
  messages.at(-1)?.role === "user" &&
  messages.reduce((n, m) => n + m.content.length, 0) <= 24000,
);
const usage = { count: 0, until: 0 };
const fail = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(150000)]);
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return fail("허용되지 않은 요청입니다.", 403);
    const key = process.env.OPENAI_API_KEY;
    if (!key) return fail("서버에 OPENAI_API_KEY를 설정해주세요.", 503);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return fail("JSON 형식으로 요청해주세요.", 400);
    if (Number(request.headers.get("content-length")) > 100000)
      return fail("대화 내용이 너무 깁니다. 새 대화를 시작해주세요.", 413);
    const reader = request.body?.getReader();
    if (!reader) return fail("대화 내용을 입력해주세요.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 100000) {
          await reader.cancel();
          return fail("대화 내용이 너무 깁니다. 새 대화를 시작해주세요.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const { messages } = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (Date.now() > usage.until) { usage.count = 0; usage.until = Date.now() + 60000; }
    if (usage.count >= 15) return fail("요청이 많습니다. 잠시 후 다시 대화해주세요.", 429);
    usage.count++;
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: "gpt-5.4-mini", stream: true, store: false,
        reasoning: { effort: "low" }, max_output_tokens: 2000,
        instructions: "You are MAITE, a helpful conversational AI. Reply naturally in the user's language. Discuss ideas, character designs, or everyday topics as requested. This is a text conversation only: do not claim you generated or changed an image, saw an image that was not supplied, or performed an external action. Keep answers concise unless detail is requested.",
        input: messages,
      }),
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return fail(upstream.status === 429 ? "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요." : "AI에 연결하지 못했습니다. 다시 시도해주세요.", upstream.status === 429 ? 429 : 502);
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          let completed = false;
          for await (const event of readEvents(upstream.body!)) {
            if ((event.type === "response.output_text.delta" || event.type === "response.refusal.delta") && typeof event.delta === "string")
              send({ type: "delta", text: event.delta });
            if (event.type === "response.completed") { completed = true; send({ type: "done" }); break; }
            if (["error", "response.failed", "response.incomplete"].includes(String(event.type)))
              throw new Error("Incomplete response");
          }
          if (!completed) throw new Error("Disconnected stream");
        } catch {
          if (!abort.signal.aborted && !request.signal.aborted)
            send({ type: "error", message: "응답이 중단되었습니다. 다시 시도해주세요." });
        } finally {
          abort.abort();
          try { controller.close(); } catch { /* Client already disconnected. */ }
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) {
    const cancelled = signal.aborted;
    abort.abort();
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail("대화 내용을 확인해주세요. 너무 길면 새 대화를 시작해주세요.", 400);
    return fail(cancelled ? "응답 시간이 초과되었거나 요청이 취소되었습니다." : "AI에 연결하지 못했습니다. 다시 시도해주세요.", cancelled ? 504 : 502);
  }
}
