// Read on each request so all text generation paths share the server setting.
export function textModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
}
