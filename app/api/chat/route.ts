import {createNovelReviewLogger} from "../../../lib/novel/review-log.ts";
import { changedCharacterLocation } from "../../../lib/chat/presentation.ts";
import { timelineSchema, advanceTimeline, timelineChatMemory,timelineForChat } from "../../../lib/chat/timeline.ts";
import { chatReasoningOptions, geminiNovelWriteModel, geminiNovelProofreadModel, textModel } from "../../../lib/ai-model.ts";
import { withGeneration, preflight } from "../../../lib/server/generation.ts";
import { allowedOrigin } from "../../../lib/server/http.ts";
import { z } from "zod";
import { readEvents } from "../../../lib/chat/stream.ts";
import { characterContextSchema, characterInstructions } from "../../../lib/chat/character.ts";
import { storyStateSchema } from "../../../lib/novel/state.ts";
import { isProviderQuotaError, novelRetryDelay, NovelUpstreamError } from "../../../lib/novel/upstream-error.ts";
import { openAIResponsesEndpoint, openAITextKey } from "../../../lib/openai-endpoint.ts";
import { geminiApiKey } from "../../../lib/novel/gemini.ts";
import { blocksTextGeneration, GENERATION_POLICY_MESSAGE } from "../../../lib/generation-policy.ts";
import { generateChapter, NovelOutputLimitError } from "../../../lib/novel/generate.ts";
import { explicitSpeechRequest, replySpeechPolicy, speechInstructions, speechStyleSchema } from "../../../lib/chat/speech.ts";
import { streamedDialogue } from "../../../lib/chat/dialogue.ts";
import { characterDialogueSchema, chatMemorySchema, conversationInstructions, emptyChatMemory, type ChatMemory } from "../../../lib/chat/memory.ts";
import { storyComplete } from "../../../lib/novel/series.ts";
import { trackUsage, type UsageRecord } from "../../../lib/usage.ts";
import {chatCharacterInstructions} from "../../../lib/chat/prompt.ts";
import {personalityPatchSchema,personalityState} from "../../../lib/chat/personality.ts";
import { userDisplayName } from "../../../lib/chat/identity.ts";
import {completeCharacterReply,completedDialogueText} from "../../../lib/chat/completion.ts";
import { createHash } from "node:crypto";
import { MIN_STORY_CHARS, StoryDraftPaused, type StoryDraftStore } from "../../../lib/novel/checkpoint.ts";
import { claimLocalStoryDraft } from "../../../lib/server/story-drafts.ts";
import { AccountError } from "../../../lib/server/account.ts";

export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z.object({
  character: characterContextSchema.optional(),
  storyState: storyStateSchema.optional(),
  storyDocumentId: z.uuid().optional(),
  rewindToken: z.uuid().optional(),
  timeline: timelineSchema.optional(),
  additionalConcept: z.string().trim().min(1).max(1000).optional(),
  chatMemory: chatMemorySchema.optional(),
  speechStyle: speechStyleSchema.optional(),
  speechPreference: speechStyleSchema.optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8000),
  }).strict()).min(1).max(21),
}).strict().refine(({ timeline, character }) => !timeline || !!character).refine(({ storyState, storyDocumentId, rewindToken, character }) => !(storyState || storyDocumentId || rewindToken) || character?.mode === "story")
  .refine(({ additionalConcept, character }) => !additionalConcept || character?.mode === "story")
  .refine(({ chatMemory, character }) => !chatMemory || character?.mode === "chat")
  .refine(({ speechPreference, character }) => !speechPreference || character?.mode === "chat")
  .refine(({ speechStyle, character }) => !speechStyle || character?.mode === "chat").refine(({ messages }) =>
  messages.at(-1)?.role === "user" &&
  messages.reduce((n, m) => n + m.content.length, 0) <= 24000,
);
const usage = { count: 0, until: 0 };
const minimumStoryLength = MIN_STORY_CHARS.toLocaleString("ko-KR");
export const OPTIONS = preflight;
export const POST = withGeneration(handle);
async function handle(request: Request, draftStore?: StoryDraftStore) {
  const tracked = request.headers.get("X-Track-Usage") === "1";
  const records = new Map<string, UsageRecord>();
  let publishUsage: ((record: UsageRecord) => void) | undefined;
  const onUsage = (record: UsageRecord) => { records.set(record.id, record); if (tracked) publishUsage?.(record); };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: {
    "Cache-Control": "no-store", ...(tracked ? { "X-Token-Usage": JSON.stringify([...records.values()]) } : {}),
  } });
  let finishReply: ReturnType<typeof trackUsage> | undefined;
  const abort = new AbortController();
  let signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(270000)]);
  try {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(request))
      return fail("허용되지 않은 요청입니다.", 403);
    const key = openAITextKey();
    if (!key) return fail("서버에 GPT API 키를 설정해주세요.", 503);
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
    const body = Buffer.concat(chunks);
    const { messages, character, storyState, storyDocumentId, speechStyle, speechPreference, additionalConcept, chatMemory, timeline: rawTimeline } = schema.parse(JSON.parse(body.toString("utf8")));
    if (blocksTextGeneration({messages, character, storyState, additionalConcept})) return fail(GENERATION_POLICY_MESSAGE, 422);
    if (character?.mode === "story" && (geminiNovelWriteModel() || geminiNovelProofreadModel()) && !geminiApiKey())
      return fail("선택한 제공자의 Gemini API 키를 서버에 설정해주세요.", 503);
    if (character?.mode !== "story") signal = AbortSignal.any([signal, AbortSignal.timeout(150000)]);
    const userName = character ? userDisplayName(character, additionalConcept || storyState?.seriesConcept) : "당신";
    const timeline = rawTimeline ? { ...rawTimeline, participants: rawTimeline.participants.map(p => p.id === "user" ? { ...p, name: userName } : p.id==="character"&&character?{...p,name:character.name}:p) } : undefined;
    if (character?.mode === "story" && storyComplete(storyState) && !additionalConcept)
      return fail("완결된 이야기입니다. 컨셉을 추가하거나 새 이야기로 시작해주세요.", 409);
    if (Date.now() > usage.until) { usage.count = 0; usage.until = Date.now() + 60000; }
    if (usage.count >= 15) return fail("요청이 많습니다. 잠시 후 다시 대화해주세요.", 429);
    usage.count++;
    if (character?.mode === "story") {
      let localDraft: ReturnType<typeof claimLocalStoryDraft> | undefined;
      if (storyDocumentId && !draftStore) {
        try { localDraft = claimLocalStoryDraft(createHash("sha256").update(body).digest("hex")); }
        catch (error) { if (error instanceof AccountError) return fail(error.message, error.status); throw error; }
      }
      const encoder = new TextEncoder();
      let stage = "planning";
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: object) => {
            if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };
          publishUsage = record => send({ type: "usage", record });
          let draftPreview: string | undefined;
          try {
            const chapter = await generateChapter({ character, state: storyState, additionalConcept,
              draftStore: draftStore ?? localDraft?.store,
              traceId:request.headers.get("X-Request-Id")??undefined,
              previous: messages.filter(message => message.role === "assistant").at(-1)?.content,
              direction: messages.at(-1)!.content, key, signal,
              phase: phase => { stage = phase; send({ type: "phase", phase }); },
              onDraftProgress: progress => send({ type: "draft_progress", ...progress }),
              onDraftUpdate: text => send({ type: "draft_live", text }),
              onDraftPreview: text => { draftPreview = text; },
              onUsage, timeline,
            });
            if (timeline) send({ type: "timeline", expectedRevision: timeline.revision, state: advanceTimeline(timeline, character.name, undefined, chapter.state, storyState, chapter.closedPromises, userName,chapter.sharedChanges) });
            const readerNickname = userName === character.userName && userName !== character.name ? userName : null;
            send({ type: "chapter", text: chapter.text, state: chapter.state, expectedChapter: chapter.expectedChapter, readerNickname });
            send({ type: "done" });
          } catch (error) {
            const knownReasons = ["Chapter review failed", "Incomplete novel stage", "Empty novel stage", "Novel upstream failed", "Novel chapter too short", "Unsupported memory", "Invalid manuscript source"];
            console.warn("novel-failed", { stage, ...(error instanceof NovelUpstreamError ? error.diagnostics : {}), reason: signal.aborted ? "cancelled_or_timeout" : error instanceof StoryDraftPaused ? `story_draft_${error.reason}` : error instanceof NovelOutputLimitError ? "output_token_limit" : error instanceof z.ZodError ? "invalid_stage_output" : error instanceof Error && knownReasons.includes(error.message) ? error.message : "generation_failed" });
            if (request.signal.aborted || abort.signal.aborted) return;
            if (draftPreview) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "draft_preview", text: draftPreview })}\n\n`));
            }
            if (signal.aborted) {
              const message = draftStore || localDraft
                ? "이번 요청의 시간이 끝났어요. 다시 시도하면 저장한 지점부터 이어갑니다."
                : "이번 요청의 시간이 끝났어요. 이전 회차는 유지됩니다.";
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", code: "story_timeout", message })}\n\n`));
            } else if (error instanceof StoryDraftPaused) {
              send({ type: "error", code: "story_draft_paused",
                message: error.reason === "event_recovery"
                  ? error.eventFailure === "missing_transition" ? "장면 연결을 자동으로 복구하지 못했어요. 임시 원고는 보관했고 하트는 차감하지 않았어요."
                    : error.eventFailure === "chapter_too_long" ? "장면을 회차 분량에 맞추지 못했어요. 임시 원고는 보관했고 하트는 차감하지 않았어요."
                    : "장면을 자동으로 복구하지 못했어요. 저장된 진행 상황은 유지되며 하트는 차감하지 않았어요."
                  : error.reason === "budget" ? "이 단계의 재시도 한도에 도달했어요. 저장된 진행 상황은 유지되며 하트는 차감하지 않았어요."
                  : error.reason === "format" ? "응답 형식을 확인하지 못해 작성을 멈췄어요. 이전 회차는 유지되며 하트는 차감하지 않았어요."
                  : error.reason === "quality" ? "임시 원고가 전개 검수를 통과하지 못해 작성을 멈췄어요. 앞 회차는 그대로이며 하트는 차감하지 않았어요."
                  : `원고가 ${minimumStoryLength}자에 도달하지 못했어요. 하트는 차감하지 않았어요.` });
            } else if (error instanceof NovelUpstreamError || novelRetryDelay(error, 0) !== undefined) {
              send({ type: "error", code: "story_provider_failed", message: error instanceof NovelUpstreamError && isProviderQuotaError(error)
                ? "AI 제공자의 사용 한도가 부족해 멈췄어요. 한도가 복구되면 저장된 지점에서 이어갈 수 있어요."
                : error instanceof NovelUpstreamError && error.diagnostics.httpStatus === 401
                  ? "AI 제공자 인증을 확인해야 해요. 설정이 복구되면 저장된 지점에서 이어갈 수 있어요."
                  : error instanceof NovelUpstreamError && error.diagnostics.httpStatus === 429
                    ? "AI 제공자의 요청 한도에 도달했어요. 잠시 뒤 다시 시도하면 저장된 지점에서 이어갈 수 있어요."
                  : "AI 제공자가 요청을 처리하지 못했어요. 저장된 진행 상황은 유지되며 하트는 차감하지 않았어요." });
            } else if (error instanceof Error && error.message === "Novel chapter too short") {
              send({ type: "error", message: `${minimumStoryLength}자 이상인 원고를 완성하지 못했습니다. 이전 회차는 유지됩니다.` });
            } else {
              send(error instanceof NovelOutputLimitError
                ? { type: "error", code: "output_token_limit", message: "생성 중 출력 토큰 한도에 도달했습니다. 자동 재시도는 하지 않았으며 이전 내용은 유지됩니다. 이미 처리된 토큰은 소비될 수 있으니 사용량을 확인해주세요." }
                : { type: "error", message: "이야기를 완성하지 못했습니다. 이전 내용은 유지됩니다. 다시 시도해주세요." });
            }
          } finally {
            localDraft?.release();
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
    const speechPolicy = character?.mode === "chat" ? replySpeechPolicy(character, messages, speechStyle, speechPreference) : undefined;
    const registerInstructions = `Before continuity/utterances, select speechStyle. Current=${speechStyle??"unset"}; latest clear request=${requestedSpeech??"none"}. Respect personality, concept and relationship and the register priority; quotations, negations and the user's own register are not switches. Privately resolve intent/actor/target against supplied facts. After dialogue, set clothingMentioned/locationChanged only for newly established character outfits/locations in THIS exchange, not old memory, compliments, plans, flashbacks, negations or another person moving alone.`;
    const originalMemory = character?.mode === "chat" ? chatMemory ?? emptyChatMemory(character.name) : undefined;
    const rawMemory = originalMemory ? { ...originalMemory, participants: originalMemory.participants.map(p => p.id === "user" ? { ...p, name: userName } : p.id==="character"&&character?{...p,name:character.name}:p) } : undefined;
    const memory = rawMemory && timeline ? timelineChatMemory(rawMemory, timelineForChat(timeline,messages.at(-1)!.content)) : rawMemory;
    const factIds=memory?.facts.map(fact=>fact.id)??[];
    const continuity=characterDialogueSchema.shape.continuity.extend({factIds:factIds.length?z.array(z.enum(factIds as [string,...string[]])).max(4):characterDialogueSchema.shape.continuity.shape.factIds.max(0)});
    const personality=character&&personalityState(character,memory?.personality).profile?personalityPatchSchema.extend({profile:z.null(),profileEvidence:z.literal("")}):personalityPatchSchema;
    const outputSchema=characterDialogueSchema.extend({continuity,memory:characterDialogueSchema.shape.memory.extend({personality}),...(speechPolicy?.style?{speechStyle:z.literal(speechPolicy.style)}:{})});
    const instructions=[character?.mode==="chat"?chatCharacterInstructions(character):characterInstructions(character),...(character?.mode==="chat"?[registerInstructions,...(speechPolicy?.style?[speechInstructions(speechPolicy.style),"This register is fixed for this reply; mood/user sentence endings do not authorize switching."]:[])]:[]),...(memory&&character?[conversationInstructions(character,memory,messages.at(-1)!.content,timeline)]:[])].join("\n\n");
    const formatSchema=character?.mode==="chat"?z.toJSONSchema(outputSchema):undefined;
    if(character?.mode==="chat")console.info("chat-context",{instructionChars:instructions.length,schemaChars:JSON.stringify(formatSchema).length,historyChars:messages.reduce((sum,m)=>sum+m.content.length,0),facts:memory?.facts.length??0,sharedEvents:timeline?.canon?.length??0,profileCached:!!personalityState(character,memory?.personality).profile});
    finishReply = trackUsage("chat.reply", textModel(), onUsage);
    const upstream = await fetch(openAIResponsesEndpoint(), {
      redirect: "error",
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: textModel(), stream: true, store: false,
        ...chatReasoningOptions(), max_output_tokens: 2000,
        instructions,
        input: messages,
        ...(character?.mode === "chat" ? { text: { format: { type: "json_schema", name: "character_dialogue", strict: true, schema: formatSchema } } } : {}),
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
          let nextSharedTimeline:ReturnType<typeof advanceTimeline>|undefined;
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
                const result = completeCharacterReply(JSON.parse(completedDialogueText(event.response,rawDialogue)),memory!,character,messages.at(-1)!.content,timeline,userName);
                const final=result.text;
                if(!final.trim()||!final.startsWith(answer))throw new Error("Invalid dialogue output");
                if(final.length>answer.length)send({type:"delta",text:final.slice(answer.length)});
                answer=final;
                selectedSpeech = result.reply.speechStyle;
                clothingMentioned = result.reply.clothingMentioned;
                nextMemory = result.memory;
                nextSharedTimeline=result.timeline;
                if (timeline) {
                  const nextPromises = nextSharedTimeline?.promises ?? timeline.promises;
                  createNovelReviewLogger({traceId:request.headers.get("X-Request-Id")??undefined}).event("chat_promise_update", {
                    beforeRevision:timeline.revision, afterRevision:nextSharedTimeline?.revision ?? timeline.revision,
                    beforeCount:timeline.promises.length, afterCount:nextPromises.length, degraded:result.degraded ?? null,
                    keys:nextPromises.map(p=>({key:p.key,subjectId:p.subjectId,objectId:p.objectId})),
                  }, {promises:nextPromises});
                }
                locationChanged = result.reply.locationChanged || changedCharacterLocation(memory, nextMemory);
                if(result.degraded)console.warn("chat-metadata-discarded",{reason:result.degraded,turn:memory!.turn});
              }
              completed = true;
              if (character?.mode === "chat") {
                send({ type: "clothing", mentioned: clothingMentioned });
                send({ type: "location", changed: locationChanged });
              }
              if (selectedSpeech) send({ type: "speech", speechStyle: selectedSpeech, ...(speechPolicy?.remember ? { preference: selectedSpeech } : {}) });
              if (nextMemory) send({ type: "memory", state: nextMemory, expectedTurn: memory!.turn });
              if (timeline && nextSharedTimeline) send({ type: "timeline", expectedRevision: timeline.revision, state: nextSharedTimeline });
              send({ type: "done" }); break;
            }
            if (["error", "response.failed", "response.incomplete"].includes(String(event.type))) {
              finishReply?.(event.response, "failed");
              const response=event.response as {incomplete_details?:{reason?:string}}|undefined;
              throw new Error(event.type==="response.incomplete"&&response?.incomplete_details?.reason==="max_output_tokens"?"Chat output token limit":"Incomplete response");
            }
          }
          if (!completed) throw new Error("Disconnected stream");
        } catch(error) {
          const reason=error instanceof z.ZodError?"invalid_dialogue_schema":error instanceof SyntaxError?"invalid_dialogue_json":error instanceof Error&&["Chat output token limit","Invalid dialogue output","Invalid dialogue stream","Dialogue too long","Incomplete response","Disconnected stream"].includes(error.message)?error.message:"stream_processing_failed";
          console.warn("chat-failed",{reason,cancelled:signal.aborted});
          if (!abort.signal.aborted && !request.signal.aborted)
            send({ type: "error",...(reason==="Chat output token limit"?{code:"output_token_limit"}:{}), message: reason==="Chat output token limit"?"답변 생성 중 출력 토큰 한도에 도달했습니다. 이전 대화는 유지됩니다. 사용량을 확인한 뒤 다시 시도해주세요.":"응답이 중단되었습니다. 다시 시도해주세요." });
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
