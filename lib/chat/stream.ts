// Parse SSE incrementally: network chunks may split UTF-8 characters or event lines.
export async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("Stream event too large");
      if (done) buffer += "\n\n";
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (!line && data.length) {
          const payload = data.join("\n");
          data = [];
          if (payload === "[DONE]") return;
          yield JSON.parse(payload) as Record<string, unknown>;
        }
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read complete strings and the available text of an unfinished JSON string array. */
export function streamedJsonStrings(json: string, offset: number, limit: number) {
  const complete: string[] = [];
  while (offset < json.length && complete.length < limit) {
    while (offset < json.length && /[\s,]/.test(json[offset])) offset++;
    if (json[offset] !== '"') break;
    offset++;
    let text = "", closed = false;
    while (offset < json.length) {
      const char = json[offset];
      if (char === '"') { offset++; closed = true; break; }
      if (char === "\\") {
        const length = json[offset + 1] === "u" ? 6 : 2;
        if (offset + length > json.length) break;
        try { text += JSON.parse('"' + json.slice(offset, offset + length) + '"'); }
        catch { break; }
        offset += length;
      } else { text += char; offset++; }
    }
    if (!closed) return { complete, partial: text.replace(/[\uD800-\uDBFF]$/, "") };
    complete.push(text.replace(/[\uD800-\uDBFF]$/, ""));
  }
  return { complete, partial: undefined };
}
