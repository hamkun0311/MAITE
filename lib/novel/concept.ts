import { z } from "zod";

export const conceptRulesSchema = z.array(z.string().trim().min(1).max(180)).max(8);
const markedInstallment = z.number().int().min(1).max(5);
export const markedScheduleSchema = z.array(z.array(markedInstallment).min(1).max(5)).max(334);

export function markedConceptEvents(concept: string) {
  return [...new Set([...concept.matchAll(/(?<![\\*])(\*{1,2})(?![\s*])([^*\r\n]*?[^\s*\\])\1(?!\*)/gu)].map(match => match[2].trim()))];
}

export function scheduleMarkedEvents(events: string[], proposed: number[][] | undefined, current: number, arcStart: number) {
  return events.map((text, index) => {
    const explicit = text.match(/^(?:이야기\s*#\s*(\d+)|(\d+)\s*(?:화|회차)(?!\d))/u);
    if (explicit) {
      const installment = Number(explicit[1] ?? explicit[2]) - arcStart;
      if (installment >= 1 && installment <= 5) return [installment];
    }
    const installments = proposed?.[index];
    return installments?.length ? [...new Set(installments)].sort((a, b) => a - b) : [current];
  });
}

export function markedEventAuditSchema(citation: z.ZodType<string>, count: number) {
  return z.array(z.object({
    fulfilled: z.boolean(), source: citation.nullable(),
    event: markedInstallment, fix: z.string().max(240),
  }).strict()).length(count);
}

const detail = z.string().trim().min(1).max(240);
export const markedScenesSchema = z.array(z.object({
  requirement: z.string().min(1).max(1000), event: markedInstallment,
  actor: detail, action: detail, consequence: detail,
}).strict()).max(334);

export function plannedMarkedScenes(due: string[], scenes: z.infer<typeof markedScenesSchema> = []) {
  const assignments = due.map(requirement => scenes.find(scene => scene.requirement === requirement && scene.action !== scene.consequence));
  return assignments.every(scene => scene !== undefined) ? assignments : undefined;
}

export const markedPlanInstructions = "Return markedScenes for the requirements due now. For each, copy the exact requirement text, assign its event number (1–5), and specify the actor, concrete on-page action and observable consequence. The assigned event's action and result must include these details. Preserve the required means and outcome, and correct any generic action, preparation or promise that substitutes for them. Keep the other scenes when correcting a supplied draft plan.";
export const markedReviewInstructions = "Audit each dueMarkedEvent in order in markedEventAudit. Search all events in the current chapter. The assigned event is a planning hint; accept a different scene if the actual action and its consequence occur at the time required by the user. Cite the decisive source and give its actual event number. Preparation, a promise, a recap, or a substitute action does not count. If the requirement explicitly calls for repeated occurrences, check for distinct completed occurrences. For an unfulfilled requirement, cite any passage that might be partial or ambiguous and explain only what remains missing; use null when no such passage exists.";

export function markedEvidenceReviewSchema(citation: z.ZodType<string>, count: number) {
  return z.object({ findings: z.array(z.object({
    status: z.enum(["fulfilled", "partial", "missing", "uncertain"]),
    source: citation.nullable(),
    fix: z.string().max(240),
  }).strict()).length(count) }).strict();
}

export const markedEvidenceReviewInstructions = "Review only the supplied requirements in order against the current chapter. Search all the source units once. Use fulfilled with a decisive source only when the required action and consequence happened at the requested time; an outline scene number does not determine fulfillment. Use partial with the source where the action actually occurred if only the consequence or another required step is missing. Use missing if the required action did not happen anywhere, including cases with only preparation, promises, recollection or substitute actions. Use uncertain if the text cannot establish a verdict. Respect explicit repetition counts and distinguish separate occurrences from a description of the same act. Do not draft edits. Report only what is absent in fix.";

export function groundedConceptRules(rules: string[], concepts: string[]) {
  return [...new Set(rules.flatMap(rule => {
    const excerpt = rule.trim();
    if (excerpt && concepts.some(concept => concept.includes(excerpt))) return [excerpt];
    const unquoted = excerpt.match(/^(?:"([^"]+)"|“([^”]+)”|'([^']+)'|‘([^’]+)’)$/u)
      ?.slice(1).find(Boolean)?.trim();
    return unquoted && concepts.some(concept => concept.includes(unquoted)) ? [unquoted] : [];
  }))];
}

export function conceptRuleAuditSchema(citation: z.ZodType<string>, count: number) {
  return z.array(z.object({
    rule: z.number().int().min(1).max(count),
    status: z.enum(["compatible", "not_due", "contradicted", "missing"]),
    source: citation.nullable(),
    repairEvent: z.number().int().min(1).max(5).nullable(),
    fix: z.string().max(240),
  }).strict()).length(count);
}

export function conceptRuleViolations(
  audit: unknown,
  rules: string[],
  passageFor: (source: string) => { text: string; event: number } | undefined,
  anchorForEvent: (event: number) => string | undefined,
) {
  const rows = conceptRuleAuditSchema(z.string(), rules.length).parse(audit);
  if (new Set(rows.map(row => row.rule)).size !== rules.length)
    throw new Error("Invalid concept rule audit");
  return rows.filter(row => row.status === "contradicted" || row.status === "missing").map(row => {
    const cited = row.source === null ? undefined : passageFor(row.source);
    const event = cited?.event ?? (row.status === "missing" ? row.repairEvent : null);
    const fallback = !cited && event !== null ? anchorForEvent(event) : undefined;
    return {
      type: "continuity" as const, rule: row.rule, status: row.status, event,
      evidence: cited?.text ?? fallback ?? null,
      anchor: cited ? "cited" : fallback ? "planned_event" : "unlocated",
      fix: `사용자 조건 ‘${rules[row.rule - 1]}’을 지킨다. ${row.fix}`.slice(0, 240),
    };
  });
}

export const conceptRuleAuditInstructions = "Audit each numbered conceptRules quote against the actual prose, in order. Honor explicit newer overrides and user timing over the outline. Use not_due for an unfulfilled condition belonging to a later installment, missing only when a required action or outcome is absent from this installment, contradicted when the prose violates the condition, and compatible otherwise. A future requirement's absence must not lower conceptAlignment on its own. For contradicted cite the conflicting prose in source. For missing cite the nearby paragraph or unfinished ending if available; source may be null. Set repairEvent to the numbered event where an omitted action belongs based on the plan and draft, or null if no reliable location is identifiable. For compatible and not_due use source=null and repairEvent=null. Distinguish suspicion from actual discovery. For each actionable issue give a concrete local fix.";

// A product default for sparse seeds, not another checklist of blocking errors.
export const novelConceptInstructions=`CONCEPT-LED DRAMA: A rough seed is enough. Infer its central relationship/goal and reader appeal; develop compatible details, future situations, conflicting wants, obstacles and costly choices instead of merely restating the setup. Explicit user facts, tone limits and endings outrank invented enhancements and stale model goals. Enhancements are optional creative choices, not new user requirements or automatic review failures; never overwrite established history or promote plans to facts.
Across an adult romance arc, show actual mutual encounters, changing affection, jealousy, trust or loyalties. When a sensual tone fits, linger on a charged pause, revealing dialogue and a freely reciprocated gesture that changes their relationship. Clothes, possessiveness and lack of resistance do not establish mutual desire. Keep earned closeness and consequences on the page. For other seeds, develop their own stakes; do not force romance or infidelity. Default to strong, grounded conflict/reversals; alternate payoffs with setbacks. Explicit gentle/no-romance/no-tragedy requests override defaults. Never age up minors or sexualize unclear ages; intimacy requires clearly adult consenting people and stays non-graphic, without explicit sexual acts or anatomy.`;
