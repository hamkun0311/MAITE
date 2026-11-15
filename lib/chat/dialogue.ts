import { z } from "zod";

export const dialogueSchema = z.object({
  utterances: z.array(z.string().min(1).max(2000).describe("Only words spoken directly by this character to the user. No narrator, scene description, action or stage direction. Emoji and text emoticons are allowed.")).min(1).max(3),
}).strict();

// Decode only the utterance string values from a growing Structured Outputs
// stream. Incomplete escapes and surrogate pairs wait for the next chunk.
export function streamedDialogue(json: string): string {
  const opening = /^\s*\{\s*"utterances"\s*:\s*\[/.exec(json);
  if (!opening) return "";
  let offset = opening[0].length;
  const utterances: string[] = [];
  while (offset < json.length) {
    while (/[\s,]/.test(json[offset] ?? "") && offset < json.length) offset++;
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
    utterances.push(text.replace(/[\uD800-\uDBFF]$/, ""));
    if (!closed) break;
  }
  return utterances.join("\n\n");
}
