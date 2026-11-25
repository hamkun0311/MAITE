import { readEvents, streamedJsonStrings } from "../chat/stream.ts";
import { trackUsage, type UsageListener } from "../usage.ts";

export function streamedDraftParagraphs(json: string) {
  const opening = /^\s*\{\s*"events"\s*:\s*\[/u.exec(json);
  if (!opening) return "";
  const { complete, partial } = streamedJsonStrings(json, opening[0].length, 5);
  const paragraphs = partial?.split(/\r?\n[ \t]*\r?\n/u) ?? [];
  return [...complete, ...paragraphs.slice(0, -1)].join("\n\n").trim();
}

export async function streamNovelWrite(model: string, url: string, init: RequestInit, onDraft: (text: string) => void, onUsage: UsageListener) {
  const finish = trackUsage("novel.write", model, onUsage);
  try {
    const response = await fetch(url, init);
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      const data = await response.json().catch(() => undefined);
      finish(data, response.ok && data?.status === "completed" ? "completed" : "failed");
      return { response, data, raw: "" };
    }
    let raw = "", published = "";
    for await (const event of readEvents(response.body)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        raw += event.delta;
        if (raw.length > 128000) throw new Error("Novel draft stream too large");
        const text = streamedDraftParagraphs(raw);
        if (text && text !== published) {
          published = text;
          onDraft(text);
        }
      }
      if (["response.completed", "response.incomplete", "response.failed", "error"].includes(String(event.type))) {
        const complete = event.type === "response.completed";
        finish(event.response, complete ? "completed" : "failed");
        return { response, data: event.response ?? { status: complete ? "completed" : "failed" }, raw };
      }
    }
    throw new Error("Incomplete novel stage");
  } catch (error) {
    finish(undefined, "unknown");
    throw error;
  }
}
