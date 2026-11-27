import { AccountError } from "./account.ts";
export async function readTextBounded(request: Request, max: number) {
  const reader = request.body?.getReader(); if (!reader) throw new AccountError("요청 내용이 없습니다.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > max) { await reader.cancel(); throw new AccountError("요청이 너무 큽니다.", 413); } chunks.push(value); } } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || (process.env.MOBILE_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean).includes(origin);
}
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return origin && allowedOrigin(request) ? {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Track-Usage, X-Request-Id, X-Image-Attempt, X-Image-Scope, X-Image-Retry",
    "Access-Control-Expose-Headers": "Server-Timing, X-Token-Usage, X-Job-Id, X-Character-Title, X-Character-Summary, X-Character-Prompt, X-Character-Style, X-Character-Render-Style, X-Character-Composition, X-Character-Width, X-Character-Height, X-Image-Retry",
    "Cache-Control": "no-store",
  } : { "Cache-Control": "no-store" };
}
export function preflight(request: Request) { return new Response(null, { status: allowedOrigin(request) ? 204 : 403, headers: corsHeaders(request) }); }
