import {trackUsage, type UsageListener} from "../usage.ts";

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

export async function writeGeminiProse(options: {
  model: string;
  key: string;
  instructions: string;
  input: string;
  maxOutputTokens: number;
  feature: string;
  signal: AbortSignal;
  onUsage: UsageListener;
}) {
  const {model, key, instructions, input, maxOutputTokens, feature, signal, onUsage} = options;
  const finish = trackUsage(feature, model, onUsage);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal,
      headers: {"x-goog-api-key": key, "Content-Type": "application/json"},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: instructions}]},
        contents: [{role: "user", parts: [{text: input}]}],
        generationConfig: {maxOutputTokens, thinkingConfig: {thinkingLevel: "LOW"}},
      }),
    });
    if (!response.ok) {
      finish(undefined, "failed");
      await response.body?.cancel();
      throw new Error("Novel upstream failed");
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
