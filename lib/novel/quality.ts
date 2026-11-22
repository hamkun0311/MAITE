import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {novelCharacterRules,novelDialogueRules} from "./dialogue.ts";

// Keep new examples in regression tests; extend these principles rather than stacking prompts.
export const novelQualityPrinciples=`NOVEL QUALITY PRINCIPLES — every genre:
1. Facts and perspective: Keep roles, state owners, established relationships, counts and outcomes consistent. A decisive inference needs a visible cue that supports that conclusion; weak cues warrant suspicion, not certainty. Distinguish fact from belief, hope, fear or counterfactual. A protective act alone need not prove love; a supported omniscient viewpoint may state known feelings; known couples need not confess again. Preserve past intent without inventing promises/orders. Earlier mistaken wording cannot override facts.
2. Meaning: Resolve speaker, listener, omitted subjects, referents and action targets. Check how clauses connect and what each clause affirms or denies, including negation scope and contrast. Read movement words from the current position. Fit forms of address to the relationship. Clarify the right point; mark deliberate reversals. Preserve compatible truths, genuine denial, idiomatic emphasis and purposeful evasion. Ground images in recognizable events or feelings.
3. Mechanics: Track locations, routes, scene time, reach/posture and available weapons/abilities. Bridge consequential arrivals/exits and the action enabling escape or success; distraction alone does not finish a search. Track plot-critical props and who can see/hear an exchange. Mark time jumps/returns; do not blur separate encounters. Match gestures to support/restraint. Allow ordinary ellipsis, credible off-page outcomes and explicitly unresolved danger; avoid exhaustive choreography; injury need not prevent walking.
4. Motivation and consequence: Let pivotal events affect established goals and possibly mixed feelings, then show how choices and follow-up actions address that situation. An anticipated meeting may coexist with fear of the danger bringing it about. Do not dismiss an established threat as routine business. Risky, impulsive or mistaken choices are valid when character-grounded; do not praise pointless interference as protection or invent outcomes to justify it. Link a closing gesture, message or promise to a discernible earlier exchange or choice. Once the action conveys the change, avoid repeating it in explanation or metaphor. Bias and ambiguity may be intentional.`;

const writingTask="Check these principles throughout, including the closing exchange. In JSON mode place requested metadata only in its separate fields.";

export const novelReviewTaskInstructions=`SCENE AUDIT: Compare the draft through its closing exchange to memory, previousProse and newer sharedTimeline. All four must be true, even with no register patch. rolesStable checks facts, viewpoint and knowledge. speechIntentClear checks clause links, referents and literal assertions/negations before inferred intent, plus addressee register. movementsConsistent checks routes, timing and sight/hearing. actionsCoherent checks means, motives, causal payoffs and replayed events. Cite the later passage if a completed action happens again without a new occurrence, even in paraphrase. Allow marked recollection. Broken pivotal speech, unsupported inferences and unearned endings are material. Flag unquoted direct speech or unclear speakers. Do not supply missing links from guessed intent. Allow ordinary ellipsis and coherent ambiguity. Cite CURRENT prose by source ID (reviewed) or exact quote (integrated), use an existing issue type and give a minimal fix. Preserve past chapters.`;

const registerTask=`REGISTER MEMORY: Record only new/explicitly changed speaker/addressee registers with exact current evidence. Keep unchanged pairs; use [] otherwise. changeEvidence is null for new/unchanged pairs; a durable switch needs separate on-page motivation/agreement. Do not store temporary register shifts.`;

export async function novelWriterQualityInstructions(){
 const style=(await readFile(join(process.cwd(),"novel_prompt.md"),"utf8")).trim();
 return [novelCharacterRules,novelDialogueRules,novelQualityPrinciples,writingTask,style].join("\n");
}
export const novelReviewerQualityInstructions=[novelDialogueRules,novelQualityPrinciples,novelReviewTaskInstructions,registerTask].join("\n");
// Integrated calls already contain the writer bundle: do not repeat shared principles.
export const novelIntegratedReviewInstructions=[novelReviewTaskInstructions,registerTask].join("\n");
