function diagnosticCode(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,79}$/.test(value)) return value;
  return null;
}

export class NovelUpstreamError extends Error {
  readonly diagnostics;

  constructor(provider: "gemini" | "openai", httpStatus: number, body: unknown) {
    super("Novel upstream failed");
    const error = (body as { error?: { code?: unknown; status?: unknown; type?: unknown } } | null)?.error;
    this.diagnostics = {
      provider,
      httpStatus,
      providerErrorCode: diagnosticCode(error?.code) ?? diagnosticCode(error?.status) ?? diagnosticCode(error?.type),
      providerErrorStatus: diagnosticCode(error?.status),
    };
  }
}
