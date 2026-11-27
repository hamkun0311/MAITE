import {trackUsage, type UsageListener} from "../usage.ts";
import {NovelUpstreamError} from "./upstream-error.ts";
import {gatewayBase} from "../ai-provider.ts";
import {readEvents} from "../chat/stream.ts";
import {streamedDraftParagraphs} from "./draft-stream.ts";

function geminiBase() {
  return gatewayBase(process.env.GEMINI_PROVIDER, process.env.GEMINI_BASE_URL);
}

export function geminiApiKey() {
  const gatewayKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiBase()) return gatewayKey;
  const directKey = process.env.GEMINI_DIRECT_API_KEY?.trim();
  return process.env.GEMINI_PROVIDER?.trim().toLowerCase() === "direct" ? directKey : directKey || gatewayKey;
}

type GeminiResponse = {
  candidates?: {finishReason?: string; content?: {parts?: {text?: string; thought?: boolean}[]}}[];
  modelVersion?: string;
  responseId?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

type GeminiGatewayResponse = {
  id?: string;
  model?: string;
  choices?: {finish_reason?: string; message?: {content?: string | null}; delta?: {content?: string | null}}[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {cached_tokens?: number};
    completion_tokens_details?: {reasoning_tokens?: number};
  };
};

function directChunk(data: GeminiResponse) {
  const candidate = data.candidates?.[0];
  const usage = data.usageMetadata;
  return {
    text: candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("") ?? "",
    finishReason: candidate?.finishReason,
    id: data.responseId,
    model: data.modelVersion,
    usage: usage && {
      input_tokens: usage.promptTokenCount,
      output_tokens: usage.candidatesTokenCount != null || usage.thoughtsTokenCount != null
        ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : undefined,
      total_tokens: usage.totalTokenCount,
      input_tokens_details: {cached_tokens: usage.cachedContentTokenCount},
      output_tokens_details: {reasoning_tokens: usage.thoughtsTokenCount},
    },
  };
}

function gatewayChunk(data: GeminiGatewayResponse) {
  const choice = data.choices?.[0];
  const usage = data.usage;
  return {
    text: choice?.delta?.content ?? choice?.message?.content ?? "",
    finishReason: choice?.finish_reason === "length" ? "MAX_TOKENS" : choice?.finish_reason?.toUpperCase(),
    id: data.id,
    model: data.model,
    usage: usage && {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      input_tokens_details: usage.prompt_tokens_details,
      output_tokens_details: usage.completion_tokens_details,
    },
  };
}

function gatewayEndpoint(base: string) {
  const endpoint = new URL(base);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Invalid Gemini base URL");
  const path = endpoint.pathname.replace(/\/+$/, "") || "/v1";
  endpoint.pathname = path + "/chat/completions";
  return endpoint.href;
}

export function usesVnaiWriteDefaults(feature: string, base = geminiBase()): boolean {
  return feature === "novel.write" && !!base && (process.env.GEMINI_PROVIDER?.trim().toLowerCase() === "vnai" ||
    ["apikey.vnaipro.app", "api.vnaipro.app"].includes(new URL(base).hostname));
}

export async function writeGeminiProse(options: {
  model: string;
  key: string;
  instructions: string;
  input: string;
  maxOutputTokens: number;
  responseSchema?: object;
  feature: string;
  signal: AbortSignal;
  onUsage: UsageListener;
  onDraft?: (text: string) => void;
}) {
  const {model, key, instructions, input, maxOutputTokens, responseSchema, feature, signal, onUsage, onDraft} = options;
  const base = geminiBase();
  const method = onDraft ? "streamGenerateContent?alt=sse" : "generateContent";
  const endpoint = base ? gatewayEndpoint(base) : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`;
  // Match the gateway's basic request shape for writing. The prompt and server still require five events.
  const useGatewayDefaults = usesVnaiWriteDefaults(feature, base);
  const finish = trackUsage(feature, model, onUsage);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      redirect: "error",
      headers: {"Content-Type": "application/json", ...(base ? {Authorization: `Bearer ${key}`} : {"x-goog-api-key": key})},
      body: JSON.stringify(base ? {
        model,
        ...(onDraft ? {stream: true} : {}),
        ...(!useGatewayDefaults ? {max_tokens: maxOutputTokens, reasoning_effort: "low"} : {}),
        ...(responseSchema && !useGatewayDefaults ? {response_format: {type: "json_object"}} : {}),
        messages: [{role: "system", content: instructions}, {role: "user", content: input}],
      } : {
        systemInstruction: {parts: [{text: instructions}]},
        contents: [{role: "user", parts: [{text: input}]}],
        generationConfig: {maxOutputTokens, thinkingConfig: {thinkingLevel: "LOW"},
          ...(responseSchema ? {responseMimeType: "application/json", responseJsonSchema: responseSchema} : {})},
      }),
    });
    if (!response.ok) {
      finish(undefined, "failed");
      const body: unknown = await response.json().catch(() => undefined);
      throw new NovelUpstreamError("gemini", response.status, body, response.headers.get("retry-after"));
    }

    const parse = base ? gatewayChunk : directChunk;
    if (onDraft && response.body && response.headers.get("content-type")?.startsWith("text/event-stream")) {
      let text = "", published = "";
      let id: string | undefined, usedModel: string | undefined, finishReason: string | undefined;
      let usage: ReturnType<typeof parse>["usage"];
      for await (const event of readEvents(response.body)) {
        if (event.error) throw new Error("Incomplete novel stage");
        const chunk = parse(event);
        id = chunk.id ?? id;
        usedModel = chunk.model ?? usedModel;
        finishReason = chunk.finishReason ?? finishReason;
        usage = chunk.usage ?? usage;
        if (typeof chunk.text !== "string" || !chunk.text) continue;
        text += chunk.text;
        if (text.length > 128000) throw new Error("Novel draft stream too large");
        const draft = streamedDraftParagraphs(text);
        if (draft && draft !== published) {
          published = draft;
          onDraft(draft);
        }
      }
      signal.throwIfAborted();
      finish({id, model: usedModel, usage}, finishReason === "STOP" && text.trim() ? "completed" : "failed");
      return {text, finishReason};
    }

    const {text, finishReason, ...metadata} = parse(await response.json());
    finish(metadata, finishReason === "STOP" && text.trim() ? "completed" : "failed");
    return {text, finishReason};
  } catch (error) {
    finish(undefined, "unknown");
    throw error;
  }
}
