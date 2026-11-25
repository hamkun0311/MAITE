import { trackUsage, type UsageListener } from "../usage.ts";
import { z } from "zod";
import { fiveEventDraftSchema, parseStyleEditResponse } from "./style-edit.ts";
import { NovelUpstreamError } from "./upstream-error.ts";

const officialBase = "https://api.anthropic.com/v1";

type ClaudeResponse = {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string; name?: string; input?: unknown }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

const partialDraftSchema = z.object({ events: z.array(z.string().trim().min(1)).min(1).max(5) }).strict();

function draftPayload(text: string) {
  try { return JSON.parse(text.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, "$1")) as unknown; }
  catch { return undefined; }
}

export async function writeClaudeNovelStage(options: {
  key: string; model: string; instructions: string; input: string; maxOutputTokens: number;
  schema?: object; stage: string; feature: string; signal: AbortSignal; onUsage: UsageListener;
}) {
  const { key, model, instructions, input, maxOutputTokens, schema, stage, feature, signal, onUsage } = options;
  const endpoint = new URL(process.env.CLAUDE_BASE_URL?.trim() || officialBase);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Invalid Claude base URL");
  const direct = endpoint.origin === new URL(officialBase).origin;
  endpoint.pathname = (endpoint.pathname.replace(/\/+$/, "") || "/v1") + "/messages";
  const finish = trackUsage(feature, model, onUsage);
  try {
    const response = await fetch(endpoint, {
      method: "POST", signal, redirect: "error",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01",
        ...(direct ? { "x-api-key": key } : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify({
        model, max_tokens: maxOutputTokens, system: instructions, messages: [{ role: "user", content: input }],
        ...(schema ? {
          tools: [{ name: stage, description: "Return the requested novel data in this schema.", input_schema: schema }],
          tool_choice: { type: "tool", name: stage, disable_parallel_tool_use: true },
        } : {}),
      }),
    });
    if (!response.ok) {
      finish(undefined, "failed");
      throw new NovelUpstreamError("claude", response.status, await response.json().catch(() => undefined), response.headers.get("retry-after"));
    }
    const data: ClaudeResponse = await response.json();
    const content = Array.isArray(data.content) ? data.content : [];
    const block = content.find(item => item?.type === "tool_use" && item.name === stage);
    const plain = content.filter(item => item?.type === "text").map(item => item.text ?? "").join("");
    let text = schema ? (block ? JSON.stringify(block.input) ?? "" : "") : plain;
    let completed = Boolean(text.trim()) && data.stop_reason === (schema ? "tool_use" : "end_turn");
    let partialDraft: string[] | undefined;
    let recoveredFrom: "tool_input" | "text" | undefined;
    if (stage === "write" && schema) {
      const toolInput = typeof block?.input === "string" ? draftPayload(block.input) : block?.input;
      const toolDraft = fiveEventDraftSchema.safeParse(toolInput);
      const draft = toolDraft.success ? toolDraft.data : parseStyleEditResponse(plain)?.draft;
      completed = !!draft && (data.stop_reason == null || ["tool_use", "end_turn", "stop_sequence"].includes(data.stop_reason));
      if (draft && completed) {
        text = JSON.stringify(draft);
        if (!toolDraft.success) recoveredFrom = "text";
        else if (typeof block?.input === "string" || data.stop_reason !== "tool_use") recoveredFrom = "tool_input";
      } else if (data.stop_reason !== "refusal") {
        const partialTool = partialDraftSchema.safeParse(toolInput);
        const partialText = partialDraftSchema.safeParse(draftPayload(plain));
        partialDraft = draft?.events ?? (partialTool.success ? partialTool.data.events :
          partialText.success ? partialText.data.events : undefined);
      }
    }
    const usage = data.usage;
    finish({ id: data.id, model: data.model, usage: usage && {
      input_tokens: usage.input_tokens === undefined ? undefined : usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens, input_tokens_details: { cached_tokens: usage.cache_read_input_tokens },
    } }, completed ? "completed" : "failed");
    const safeLabel = (value: unknown) => typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : null;
    return { text, completed, partialDraft, recoveredFrom, outputLimit: data.stop_reason === "max_tokens",
      diagnostics: { stopReason: safeLabel(data.stop_reason),
        contentTypes: [...new Set(content.map(item => safeLabel(item?.type)))].slice(0, 12), expectedToolPresent: !!block } };
  } catch (error) {
    finish(undefined, "unknown");
    throw error;
  }
}
