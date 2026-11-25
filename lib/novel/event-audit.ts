import { z } from "zod";

export const eventAuditInstructions = `EVENT AUDIT: List each consequential on-page action occurrence in reading order, including distinct actions within one scene. eventKey identifies equivalent actions by actor, action, target and immediate result across paraphrases. occurrenceStart cites the first source unit that begins this particular occurrence; evidence cites the passage that proves it. Prefer one row per occurrence. Use the same occurrenceStart if several sources support the same occurrence, such as handing over a note and reading the request it contains, or casting a spell and showing its effect. A reaction, consequence, additional viewpoint or a new paragraph does not replay the original action. Give a different occurrenceStart only when the text presents a fresh enactment, even if the eventKey is the same. When a genuine later occurrence has a new on-page trigger, cite it in triggerEvidence; otherwise null. Mark an unframed replay as replay, including a replay of a completed prior-chapter action. Mark an explicitly remembered, quoted or retold scene as recall. For a blocking repetition cite where the action is enacted again, not a supporting passage. Use only actual manuscript evidence. This is private metadata.`;

const eventExcerpt = z.string().trim().min(1).max(400);
export function eventAuditSchema(citation: z.ZodType<string> = eventExcerpt) {
  return z.array(z.object({
    eventKey: z.string().trim().min(1).max(120),
    depiction: z.enum(["action", "replay", "recall"]),
    occurrenceStart: citation,
    evidence: citation,
    triggerEvidence: citation.nullable(),
  }).strict()).min(1).max(24);
}

type EventAudit = z.infer<ReturnType<typeof eventAuditSchema>>;
type Source = { position: number; text: string };

export function inspectEventAudit(events: EventAudit, locate: (reference: string) => Source | undefined) {
  const entries = events.map(event => {
    const passage = locate(event.evidence);
    const start = locate(event.occurrenceStart);
    const trigger = event.triggerEvidence === null ? undefined : locate(event.triggerEvidence);
    if (!passage || !start || (event.triggerEvidence !== null && !trigger)) throw new Error("Invalid manuscript source");
    return { ...event, passage, start: Math.min(start.position, passage.position), trigger };
  }).sort((a, b) => a.start - b.start || a.passage.position - b.passage.position);
  const priorEvents = new Map<string, number>();
  const seenOccurrences = new Set<string>();
  const issues = [];
  for (const entry of entries) {
    if (entry.depiction === "recall") continue;
    const key = entry.eventKey.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
    const occurrence = `${entry.start}:${key}`;
    if (seenOccurrences.has(occurrence)) continue;
    seenOccurrences.add(occurrence);
    const previous = priorEvents.get(key);
    const newTrigger = previous !== undefined && entry.trigger && entry.trigger.position > previous
      && entry.trigger.position <= entry.start;
    if (entry.depiction === "replay" || (previous !== undefined && !newTrigger)) {
      issues.push({
        type: "repetition" as const,
        evidence: entry.passage.text,
        fix: "Keep the first occurrence. Replace this replay with a different action or consequence that follows from what already happened.",
      });
      continue;
    }
    priorEvents.set(key, entry.start);
  }
  return issues;
}
