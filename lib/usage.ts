export type UsageRecord = {
  id: string; feature: string; model: string; responseId?: string; startedAt: string;
  durationMs: number; status: "running" | "completed" | "failed" | "unknown";
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  cachedTokens: number | null; reasoningTokens: number | null;
};
export type UsageListener = (record: UsageRecord) => void;

const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

// Only numeric usage and request metadata leave this module; never prompts or outputs.
export function trackUsage(feature: string, model: string, listener?: UsageListener) {
  const start = Date.now();
  const initial: UsageRecord = { id: crypto.randomUUID(), feature, model, startedAt: new Date(start).toISOString(),
    durationMs: 0, status: "running", inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null };
  let finished = false;
  const emit = (record: UsageRecord) => {
    console.info("ai-usage", JSON.stringify(record));
    listener?.(record);
  };
  emit(initial);
  return (data?: unknown, status: UsageRecord["status"] = "completed") => {
    if (finished) return;
    finished = true;
    const result = data as { id?: unknown; model?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown;
      input_tokens_details?: { cached_tokens?: unknown }; output_tokens_details?: { reasoning_tokens?: unknown } } } | undefined;
    const usage = result?.usage;
    const inputTokens = count(usage?.input_tokens), outputTokens = count(usage?.output_tokens);
    emit({ ...initial, status, durationMs: Date.now() - start,
      model: typeof result?.model === "string" ? result.model : model,
      ...(typeof result?.id === "string" ? { responseId: result.id } : {}),
      inputTokens, outputTokens, totalTokens: count(usage?.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
      cachedTokens: count(usage?.input_tokens_details?.cached_tokens), reasoningTokens: count(usage?.output_tokens_details?.reasoning_tokens) });
  };
}

// Read each JSON body once; generation requests and output validation stay unchanged.
export async function usageFetch(feature: string, model: string, url: string, init: RequestInit, listener?: UsageListener) {
  const finish = trackUsage(feature, model, listener);
  try {
    const response = await fetch(url, init);
    const data = response.ok ? await response.json() : await response.json().catch(() => undefined);
    finish(data, response.ok && (!data?.status || data.status === "completed") ? "completed" : "failed");
    return { response, data };
  } catch (error) {
    finish(undefined, "unknown");
    throw error;
  }
}
