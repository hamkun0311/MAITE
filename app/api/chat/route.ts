import { changedCharacterLocation } from "../../../lib/chat/presentation.ts";
import { timelineSchema, advanceTimeline, timelineChatMemory } from "../../../lib/chat/timeline.ts";
import { textModel } from "../../../lib/ai-model.ts";
import { withGeneration, preflight } from "../../../lib/server/generation.ts";
import { allowedOrigin } from "../../../lib/server/http.ts";
import { z } from "zod";
import { readEvents } from "../../../lib/chat/stream.ts";
import { characterContextSchema, characterInstructions } from "../../../lib/chat/character.ts";
import { storyStateSchema } from "../../../lib/novel/state.ts";
import { generateChapter } from "../../../lib/novel/generate.ts";
import { explicitSpeechRequest, speechStyleSchema } from "../../../lib/chat/speech.ts";
import { streamedDialogue } from "../../../lib/chat/dialogue.ts";
import { characterDialogueSchema, chatMemorySchema, conversationInstructions, emptyChatMemory, mergeChatMemory, type ChatMemory } from "../../../lib/chat/memory.ts";
import { storyComplete } from "../../../lib/novel/series.ts";
import { trackUsage, type UsageRecord } from "../../../lib/usage.ts";
import { userDisplayName } from "../../../lib/chat/identity.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const schema = z.object({
  character: characterContextSchema.optional(),
  storyState: storyStateSchema.optional(),
  timeline: timelineSchema.optional(),
  additionalConcept: z.string().trim().min(1).max(1000).optional(),
  chatMemory: chatMemorySchema.optional(),
  speechStyle: speechStyleSchema.optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8000),
  }).strict()).min(1).max(21),
}).strict().refine(({ timeline, character }) => !timeline || !!character).refine(({ storyState, character }) => !storyState || character?.mode === "story")
  .refine(({ additionalConcept, character }) => !additionalConcept || character?.mode === "story")
  .refine(({ chatMemory, character }) => !chatMemory || character?.mode === "chat")
  .refine(({ speechStyle, character }) => !speechStyle || character?.mode === "chat").refine(({ messages }) =>
  messages.at(-1)?.role === "user" &&
  messages.reduce((n, m) => n + m.content.length, 0) <= 24000,
);
const usage = { count: 0, until: 0 };
export const OPTIONS = preflight;
export const POST = withGeneration(handle);
async function handle(request: Request) {
  const tracked = request.headers.get("X-Track-Usage") === "1";
  const records = new Map<string, UsageRecord>();
  let publishUsage: ((record: UsageRecord) => void) | undefined;
  const onUsage = (record: UsageRecord) => { records.set(record.id, record); if (tracked) publishUsage?.(record); };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: {
    "Cache-Control": "no-store", ...(tracked ? { "X-Token-Usage": JSON.stringify([...records.values()]) } : {}),
  } });
  let finishReply: ReturnType<typeof trackUsage> | undefined;
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(150000)]);
  try {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(request))
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
    const { messages, character, storyState, speechStyle, additionalConcept, chatMemory, timeline: rawTimeline } = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const userName = character ? userDisplayName(character, additionalConcept || storyState?.seriesConcept) : "당신";
    const timeline = rawTimeline ? { ...rawTimeline, participants: rawTimeline.participants.map(p => p.id === "user" ? { ...p, name: userName } : p) } : undefined;
    if (character?.mode === "story" && storyComplete(storyState) && !additionalConcept)
      return fail("완결된 이야기입니다. 컨셉을 추가하거나 새 이야기로 시작해주세요.", 409);
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
          publishUsage = record => send({ type: "usage", record });
          try {
            const chapter = await generateChapter({ character, state: storyState, additionalConcept,
              previous: messages.filter(message => message.role === "assistant").at(-1)?.content,
              direction: messages.at(-1)!.content, key, signal,
              phase: phase => { stage = phase; send({ type: "phase", phase }); }, onUsage, timeline,
            });
            if (timeline) send({ type: "timeline", expectedRevision: timeline.revision, state: advanceTimeline(timeline, character.name, undefined, chapter.state, storyState, chapter.closedPromises, userName) });
            send({ type: "chapter", text: chapter.text, state: chapter.state, expectedChapter: chapter.expectedChapter });
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
    const requestedSpeech = explicitSpeechRequest(messages.at(-1)!.content);
    const registerInstructions = `Before continuity and utterances, select speechStyle for THIS reply and use it consistently throughout. Current register: ${speechStyle ?? "unset"}. Clear direct request: ${requestedSpeech ?? "none"}. The latest request addressed to the CHARACTER overrides the current register. Interpret negations, quotations, hypotheticals and third-party speech in context; asking the user to speak casually is not a request to change your register. Otherwise preserve current register; initially follow explicit concept requirements or established speech, default polite if ambiguous. Never mix polite and casual endings or switch merely because of mood. After utterances, set clothingMentioned from ONLY the latest user message and this reply when the CHARACTER has changed clothes, chosen a new outfit, or is explicitly asked to wear/change an outfit (including uncommon garments). Exclude unchanged outfits, compliments, incidental names, unrelated homonyms, metaphors, other people's clothing and old memory. Set locationChanged when this exchange establishes a new/current changed location for the CHARACTER or a shared scene. Distinguish actual arrival/move from plans, invitations, flashbacks, negated moves, absent NPC places or the user moving alone. Do not require outfit changes for a location change. No explanations.`;
    const originalMemory = character?.mode === "chat" ? chatMemory ?? emptyChatMemory(character.name) : undefined;
    const rawMemory = originalMemory ? { ...originalMemory, participants: originalMemory.participants.map(p => p.id === "user" ? { ...p, name: userName } : p) } : undefined;
    const memory = rawMemory && timeline ? timelineChatMemory(rawMemory, timeline) : rawMemory;
    finishReply = trackUsage("chat.reply", textModel(), onUsage);
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: textModel(), stream: true, store: false,
        reasoning: { effort: "low" }, max_output_tokens: 2000,
        instructions: [characterInstructions(character), ...(character?.mode === "chat" ? [registerInstructions] : []),
          ...(memory && character ? [conversationInstructions(character, memory, messages.at(-1)!.content, timeline)] : [])].join("\n\n"),
        input: messages,
        ...(character?.mode === "chat" ? { text: { format: { type: "json_schema", name: "character_dialogue", strict: true, schema: z.toJSONSchema(characterDialogueSchema) } } } : {}),
      }),
    });
    if (!upstream.ok || !upstream.body) {
      finishReply(undefined, "failed");
      await upstream.body?.cancel();
      return fail(upstream.status === 429 ? "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요." : "AI에 연결하지 못했습니다. 다시 시도해주세요.", upstream.status === 429 ? 429 : 502);
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        publishUsage = record => { if (!signal.aborted) send({ type: "usage", record }); };
        if (tracked) for (const record of records.values()) publishUsage(record);
        try {
          let completed = false;
          let answer = "";
          let rawDialogue = "";
          let nextMemory: ChatMemory | undefined;
          let selectedSpeech: z.infer<typeof speechStyleSchema> | undefined;
          let clothingMentioned = false;
          let locationChanged = false;
          for await (const event of readEvents(upstream.body!)) {
            if ((event.type === "response.output_text.delta" || event.type === "response.refusal.delta") && typeof event.delta === "string") {
              if (character?.mode === "chat") {
                rawDialogue += event.delta;
                if (rawDialogue.length > 16000) throw new Error("Dialogue too long");
                const next = streamedDialogue(rawDialogue);
                if (!next.startsWith(answer)) throw new Error("Invalid dialogue stream");
                if (next.length > answer.length) send({ type: "delta", text: next.slice(answer.length) });
                answer = next;
              } else {
                answer = (answer + event.delta).slice(-8000);
                send({ type: "delta", text: event.delta });
              }
            }
            if (event.type === "response.completed") {
              finishReply?.(event.response);
              if (character?.mode === "chat") {
                const result = characterDialogueSchema.parse(JSON.parse(rawDialogue));
                const final = result.utterances.join("\n\n");
                if (!final.trim() || final !== answer) throw new Error("Invalid dialogue output");
                selectedSpeech = result.speechStyle;
                clothingMentioned = result.clothingMentioned;
                nextMemory = mergeChatMemory(memory!, result.memory, messages.at(-1)!.content, final);
                locationChanged = result.locationChanged || changedCharacterLocation(memory, nextMemory);
                const ids = new Set(nextMemory.participants.map(person => person.id));
                if ([result.continuity.actorId, result.continuity.targetId].some(id => id !== null && !ids.has(id)) ||
                  result.continuity.factIds.some(id => !memory!.facts.some(fact => fact.id === id))) console.info("chat-continuity-rejected");
              }
              completed = true;
              if (character?.mode === "chat") {
                send({ type: "clothing", mentioned: clothingMentioned });
                send({ type: "location", changed: locationChanged });
              }
              if (selectedSpeech) send({ type: "speech", speechStyle: selectedSpeech });
              if (nextMemory) send({ type: "memory", state: nextMemory, expectedTurn: memory!.turn });
              if (timeline && nextMemory && character) send({ type: "timeline", expectedRevision: timeline.revision, state: advanceTimeline(timeline, character.name, nextMemory, undefined, undefined, [], userName) });
              send({ type: "done" }); break;
            }
            if (["error", "response.failed", "response.incomplete"].includes(String(event.type))) {
              finishReply?.(event.response, "failed");
              throw new Error("Incomplete response");
            }
          }
          if (!completed) throw new Error("Disconnected stream");
        } catch {
          if (!abort.signal.aborted && !request.signal.aborted)
            send({ type: "error", message: "응답이 중단되었습니다. 다시 시도해주세요." });
        } finally {
          finishReply?.(undefined, "unknown");
          abort.abort();
          try { controller.close(); } catch { /* Client already disconnected. */ }
        }
      },
      cancel() { abort.abort(); finishReply?.(undefined, "unknown"); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) {
    finishReply?.(undefined, "unknown");
    const cancelled = signal.aborted;
    abort.abort();
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail("대화 내용을 확인해주세요. 너무 길면 새 대화를 시작해주세요.", 400);
    return fail(cancelled ? "응답 시간이 초과되었거나 요청이 취소되었습니다." : "AI에 연결하지 못했습니다. 다시 시도해주세요.", cancelled ? 504 : 502);
  }
}
