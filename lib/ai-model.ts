// Read on each request so all text generation paths share the server setting.
export function textModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
}

export function reasoningOptions(model = textModel()) {
  if (!/^(?:gpt-[56](?:[.-]|$)|o[134](?:[.-]|$))/.test(model)) return {};
  const configured = process.env.OPENAI_REASONING_EFFORT?.trim();
  const effort = configured === "low" || configured === "high" ? configured : "medium";
  return { reasoning: { effort } };
}

export function imageQuality() {
  const quality = process.env.OPENAI_IMAGE_QUALITY?.trim();
  return quality === "low" || quality === "high" || quality === "auto" ? quality : "medium";
}

// Keep review effort and its total reasoning + JSON budget independently tunable.
export function novelReviewReasoningOptions(model = textModel()) {
  return stageReasoningOptions("OPENAI_NOVEL_REVIEW_REASONING_EFFORT", model);
}

export function imageDescriptionReasoningOptions(model = textModel()) {
  return stageReasoningOptions("OPENAI_IMAGE_DESCRIPTION_REASONING_EFFORT", model);
}

function stageReasoningOptions(key: string, model: string) {
  const options = reasoningOptions(model);
  if (!options.reasoning) return options;
  const configured = process.env[key]?.trim();
  const effort = configured === "medium" || configured === "high" ? configured : "low";
  return { reasoning: { effort } };
}

export function novelReviewMaxOutputTokens() {
  const configured = Number(process.env.OPENAI_NOVEL_REVIEW_MAX_OUTPUT_TOKENS);
  return Number.isInteger(configured) && configured >= 4000 && configured <= 32000 ? configured : 12000;
}

export function novelPlanMaxOutputTokens() {
  const configured = Number(process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS);
  return Number.isInteger(configured) && configured >= 4000 && configured <= 32000 ? configured : 12000;
}
