function diagnosticCode(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,79}$/.test(value)) return value;
  return null;
}

export class NovelUpstreamError extends Error {
  readonly diagnostics;
  readonly retryAfter: string | null;

  constructor(provider: "gemini" | "openai" | "claude", httpStatus: number, body: unknown, retryAfter: string | null = null) {
    super("Novel upstream failed");
    this.retryAfter = retryAfter;
    const error = (body as { error?: { code?: unknown; status?: unknown; type?: unknown } } | null)?.error;
    this.diagnostics = {
      provider,
      httpStatus,
      providerErrorCode: diagnosticCode(error?.code) ?? diagnosticCode(error?.status) ?? diagnosticCode(error?.type),
      providerErrorStatus: diagnosticCode(error?.status),
    };
  }
}

export function isProviderQuotaError(error: NovelUpstreamError): boolean {
  const { providerErrorCode, providerErrorStatus } = error.diagnostics;
  return [providerErrorCode, providerErrorStatus].some(code =>
    typeof code === "string" && ["insufficient_user_quota", "insufficient_quota", "quota_exceeded", "billing_hard_limit_reached"].includes(code.toLowerCase()));
}

export function novelRetryDelay(error: unknown, retries: number): number | undefined {
  const backoff = 1000 * 2 ** retries;
  if (error instanceof NovelUpstreamError) {
    const { httpStatus, providerErrorCode } = error.diagnostics;
    if (isProviderQuotaError(error) || providerErrorCode === "model_not_found") return;
    if (![408, 500, 502, 503, 504, 529].includes(httpStatus) &&
      !(httpStatus === 429 && (error.retryAfter || providerErrorCode === "rate_limit_exceeded" || providerErrorCode === "rate_limit_error"))) return;
    const retryAfter = error.retryAfter?.trim();
    const hintedDelay = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
    const delay = Math.max(backoff, Number.isNaN(hintedDelay) ? 0 : hintedDelay);
    return delay <= 15000 ? delay : undefined;
  }
  if (error instanceof TypeError && error.cause instanceof Error && "code" in error.cause &&
    ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(String(error.cause.code))) {
    return backoff;
  }
}

export function isProviderAdmissionError(error: unknown): boolean {
  if (!(error instanceof NovelUpstreamError)) return false;
  const { httpStatus, providerErrorCode, providerErrorStatus } = error.diagnostics;
  return httpStatus === 401 || ([403, 429].includes(httpStatus) && (isProviderQuotaError(error) ||
    [providerErrorCode, providerErrorStatus].some(code => typeof code === "string" &&
      ["rate_limit_exceeded", "rate_limit_error", "resource_exhausted"].includes(code.toLowerCase()))));
}
