import { z } from "zod";
import { readEvents } from "../../../lib/chat/stream.ts";
import { characterContextSchema, characterInstructions } from "../../../lib/chat/character.ts";
import { storyStateSchema } from "../../../lib/novel/state.ts";
import { generateChapter } from "../../../lib/novel/generate.ts";
import { resolveSpeechStyle, speechInstructions, speechStyleSchema } from "../../../lib/chat/speech.ts";
import { detectClothing } from "../../../lib/chat/clothing.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const schema = z.object({
  character: characterContextSchema.optional(),
  storyState: storyStateSchema.optional(),
  speechStyle: speechStyleSchema.optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8000),
  }).strict()).min(1).max(21),
}).strict().refine(({ storyState, character }) => !storyState || character?.mode === "story")
  .refine(({ speechStyle, character }) => !speechStyle || character?.mode === "chat").refine(({ messages }) =>
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
    const { messages, character, storyState, speechStyle } = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (Date.now() > usage.until) { usage.count = 0; usage.until = Date.now() + 60000; }
    if (usage.count >= 15) return fail("요청이 많습니다. 잠시 후 다시 대화해주세요.", 429);
    usage.count++;
    if (character?.mode === "story") {
      const encoder = new TextEncoder();
      let stage = "planning";
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: object) => {
            if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };
          try {
            const chapter = await generateChapter({ character, state: storyState,
              previous: messages.filter(message => message.role === "assistant").at(-1)?.content,
              direction: messages.at(-1)!.content, key, signal,
              phase: phase => { stage = phase; send({ type: "phase", phase }); },
            });
            send({ type: "chapter", ...chapter });
            send({ type: "done" });
          } catch (error) {
            const knownReasons = ["Chapter review failed", "Incomplete novel stage", "Invalid chapter length", "Empty novel stage", "Novel upstream failed", "Unsupported memory", "Invalid manuscript source"];
            console.warn("novel-failed", { stage, reason: signal.aborted ? "cancelled_or_timeout" : error instanceof z.ZodError ? "invalid_stage_output" : error instanceof Error && knownReasons.includes(error.message) ? error.message : "generation_failed" });
            if (!request.signal.aborted && !abort.signal.aborted)
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "이야기를 완성하지 못했습니다. 이전 내용은 유지됩니다. 다시 시도해주세요." })}\n\n`));
          } finally {
            abort.abort();
            try { controller.close(); } catch { /* Client disconnected. */ }
          }
        },
        cancel() { abort.abort(); },
      });
      return new Response(stream, { headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no",
      } });
    }
    const selectedSpeech = character?.mode === "chat" ? await resolveSpeechStyle({ character, current: speechStyle, messages, key, signal }) : undefined;
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: "gpt-5.4-mini", stream: true, store: false,
        reasoning: { effort: "low" }, max_output_tokens: 2000,
        instructions: [characterInstructions(character), ...(selectedSpeech ? [speechInstructions(selectedSpeech)] : [])].join("\n\n"),
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
          let answer = "";
          for await (const event of readEvents(upstream.body!)) {
            if ((event.type === "response.output_text.delta" || event.type === "response.refusal.delta") && typeof event.delta === "string") {
              answer = (answer + event.delta).slice(-8000);
              send({ type: "delta", text: event.delta });
            }
            if (event.type === "response.completed") {
              completed = true;
              if (character?.mode === "chat") {
                try {
                  const mentioned = await detectClothing({ messages: [messages.at(-1)!, { role: "assistant", content: answer }], key, signal });
                  send({ type: "clothing", mentioned });
                } catch {
                  if (signal.aborted) throw new Error("Clothing detection cancelled");
                  // Optional image-button metadata must not discard a completed chat reply.
                  console.warn("clothing-detection-failed");
                }
              }
              if (selectedSpeech) send({ type: "speech", speechStyle: selectedSpeech });
              send({ type: "done" }); break;
            }
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
