import {trackUsage, type UsageListener} from "../usage.ts";
import {NovelUpstreamError} from "./upstream-error.ts";
import {gatewayBase} from "../ai-provider.ts";

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
  choices?: {finish_reason?: string; message?: {content?: string | null}}[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {cached_tokens?: number};
    completion_tokens_details?: {reasoning_tokens?: number};
  };
};

function gatewayEndpoint(base: string) {
  const endpoint = new URL(base);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Invalid Gemini base URL");
  const path = endpoint.pathname.replace(/\/+$/, "") || "/v1";
  endpoint.pathname = path + "/chat/completions";
  return endpoint.href;
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
}) {
  const {model, key, instructions, input, maxOutputTokens, responseSchema, feature, signal, onUsage} = options;
  const base = geminiBase();
  const endpoint = base ? gatewayEndpoint(base) : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const finish = trackUsage(feature, model, onUsage);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      redirect: "error",
      headers: {"Content-Type": "application/json", ...(base ? {Authorization: `Bearer ${key}`} : {"x-goog-api-key": key})},
      body: JSON.stringify(base ? {
        model, max_tokens: maxOutputTokens, reasoning_effort: "low",
        ...(responseSchema ? {response_format: {type: "json_object"}} : {}),
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

    if (base) {
      const data: GeminiGatewayResponse = await response.json();
      const choice = data.choices?.[0];
      const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
      const finishReason = choice?.finish_reason === "length" ? "MAX_TOKENS" : choice?.finish_reason?.toUpperCase();
      const usage = data.usage;
      finish({
        id: data.id, model: data.model,
        usage: {
          input_tokens: usage?.prompt_tokens,
          output_tokens: usage?.completion_tokens,
          total_tokens: usage?.total_tokens,
          input_tokens_details: usage?.prompt_tokens_details,
          output_tokens_details: usage?.completion_tokens_details,
        },
      }, finishReason === "STOP" && text.trim() ? "completed" : "failed");
      return {text, finishReason};
    }

    const data: GeminiResponse = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("") ?? "";
    const usage = data.usageMetadata;
    const completed = candidate?.finishReason === "STOP" && !!text.trim();
    finish({
      id: data.responseId,
      model: data.modelVersion,
      usage: {
        input_tokens: usage?.promptTokenCount,
        output_tokens: usage?.candidatesTokenCount != null || usage?.thoughtsTokenCount != null
          ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
          : undefined,
        total_tokens: usage?.totalTokenCount,
        input_tokens_details: {cached_tokens: usage?.cachedContentTokenCount},
        output_tokens_details: {reasoning_tokens: usage?.thoughtsTokenCount},
      },
    }, completed ? "completed" : "failed");
    return {text, finishReason: candidate?.finishReason};
  } catch (error) {
    finish(undefined, "unknown");
    throw error;
  }
}
