import {z} from "zod";
import type {Timeline} from "../chat/timeline.ts";
import {hasEvidence} from "./state.ts";

export const promiseWritingInstructions = "Honor agreed sharedTimeline.promises during this installment. If the promised time or event occurs, show the agreed participants and action on-page, or show why the plan changes. Keep future promises pending and distinguish them from unilateral wishes and completed events.";

export const promiseReviewInstructions = "Audit sharedTimeline.promises in order, one verdict per promise. Use fulfilled only when the agreed action and participants appear, changed only for an explicit on-page cancellation or rescheduling, pending if the relevant time/event has not happened, and missed if the draft skips or contradicts a due promise. If rescheduled, record the new plan in sharedChanges. For every verdict cite the matching passage or the closest passage showing the timeframe or omission.";

const promiseAuditSchema = (citation: z.ZodType<string>) => z.array(z.object({
  status: z.enum(["fulfilled", "changed", "pending", "missed"]),
  evidence: citation,
}).strict());

export function promiseAuditFields(count: number, citation: z.ZodType<string> = z.string().min(1).max(400)) {
  return count ? {promiseAudit: promiseAuditSchema(citation).length(count)} : {};
}

export function inspectPromiseAudit(promises: Timeline["promises"], audit: unknown, prose: string) {
  const parsed = promiseAuditSchema(z.string()).length(promises.length).safeParse(audit);
  const items = promises.map((promise, index) => {
    const verdict = parsed.data?.[index];
    const grounded = !!verdict?.evidence.trim() && hasEvidence(prose, verdict.evidence);
    return {
      index: index + 1, key: promise.key, subjectId: promise.subjectId,
      status: grounded && verdict ? verdict.status : "unsupported",
      grounded,
      evidence: grounded && verdict ? verdict.evidence : undefined,
    };
  });
  return {
    items,
    accepted: items.every(item => item.grounded && item.status !== "missed"),
    closed: promises.filter((_, index) => ["fulfilled", "changed"].includes(items[index].status)).map(p => p.text),
  };
}
