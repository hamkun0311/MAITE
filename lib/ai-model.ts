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

export function chatReasoningOptions(model = textModel()) {
  return configuredReasoning("OPENAI_CHAT_REASONING_EFFORT",model,reasoningOptions(model));
}

// Legacy novel setting remains the fallback for existing deployments.
export function novelReasoningOptions(model = textModel()) {
  return configuredReasoning("OPENAI_NOVEL_REASONING_EFFORT",model,reasoningOptions(model));
}
export function novelWriteReasoningOptions(model = textModel()) {
  return configuredReasoning("OPENAI_NOVEL_WRITE_REASONING_EFFORT",model,novelReasoningOptions(model));
}
export function novelPlanReasoningOptions(model = textModel()) {
  return configuredReasoning("OPENAI_NOVEL_PLAN_REASONING_EFFORT",model,novelReasoningOptions(model));
}
function configuredReasoning(key:string,model:string,fallback:ReturnType<typeof reasoningOptions>) {
  if(!reasoningOptions(model).reasoning)return fallback;
  const effort=process.env[key]?.trim();
  return effort==="low"||effort==="medium"||effort==="high"?{reasoning:{effort}}:fallback;
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

// Independent review remains the quality-preserving default.
export function geminiNovelWriteModel() {
  return process.env.GEMINI_NOVEL_WRITE_MODEL?.trim() || "";
}

export function novelGenerationMode(geminiWriter = geminiNovelWriteModel()) {
  return !geminiWriter && process.env.OPENAI_NOVEL_GENERATION_MODE?.trim() === "integrated" ? "integrated" : "reviewed";
}
export function novelIntegratedMaxOutputTokens(){
 const value=Number(process.env.OPENAI_NOVEL_INTEGRATED_MAX_OUTPUT_TOKENS);
 return Number.isInteger(value)&&value>=4000&&value<=32000?value:12000;
}
