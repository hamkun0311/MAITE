import { gatewayBase } from "./ai-provider.ts";

const officialBase = "https://api.openai.com/v1";

function endpoint(base: string | undefined, path: string) {
  const url = new URL(base || officialBase);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid OpenAI base URL");
  url.pathname = (url.pathname.replace(/\/+$/, "") || "/v1") + path;
  return url.href;
}

function textBase() {
  return gatewayBase(process.env.OPENAI_TEXT_PROVIDER, process.env.OPENAI_BASE_URL);
}

export function openAITextKey() {
  const gatewayKey = process.env.OPENAI_TEXT_API_KEY?.trim();
  if (textBase()) return gatewayKey;
  const officialKey = process.env.OPENAI_API_KEY?.trim();
  return process.env.OPENAI_TEXT_PROVIDER?.trim().toLowerCase() === "direct" ? officialKey : gatewayKey || officialKey;
}

export function openAIResponsesEndpoint() {
  return endpoint(textBase(), "/responses");
}

function imageBase() {
  return gatewayBase(process.env.OPENAI_IMAGE_PROVIDER, process.env.OPENAI_IMAGE_BASE_URL?.trim() || process.env.OPENAI_BASE_URL);
}

export function openAIImageKey() {
  const gatewayKey = process.env.OPENAI_IMAGE_API_KEY?.trim();
  if (imageBase()) return gatewayKey;
  const officialKey = process.env.OPENAI_IMAGE_DIRECT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  return process.env.OPENAI_IMAGE_PROVIDER?.trim().toLowerCase() === "direct" ? officialKey : gatewayKey || officialKey;
}

export function openAIImageEndpoint(operation: "edits" | "generations") {
  return endpoint(imageBase(), `/images/${operation}`);
}
