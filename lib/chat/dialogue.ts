import { z } from "zod";
import { streamedJsonStrings } from "./stream.ts";

export const dialogueSchema = z.object({
  utterances: z.array(z.string().min(1).max(2000).describe("Only words spoken directly by this character to the user. No narrator, scene description, action or stage direction. Emoji and text emoticons are allowed.")).min(1).max(3),
}).strict();

// Decode only the utterance string values from a growing Structured Outputs
// stream. Incomplete escapes and surrogate pairs wait for the next chunk.
export function streamedDialogue(json: string): string {
  // The optional private verdict contains only IDs, enums and a flat ID list.
  // Wait until it closes, then expose only utterance values, never metadata.
  const opening = /^\s*\{\s*(?:"speechStyle"\s*:\s*"(?:polite|casual)"\s*,\s*)?(?:"continuity"\s*:\s*\{[^{}]*\}\s*,\s*)?"utterances"\s*:\s*\[/.exec(json);
  if (!opening) return "";
  const { complete, partial } = streamedJsonStrings(json, opening[0].length, Infinity);
  return (partial === undefined ? complete : [...complete, partial]).join("\n\n");
}
