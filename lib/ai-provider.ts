const vnaiBase = "https://apikey.vnaipro.app/v1";

export function gatewayBase(provider: string | undefined, base: string | undefined) {
  const configured = base?.trim() || undefined;
  switch (provider?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "auto":
      return configured;
    case "direct":
      return undefined;
    case "vnai":
      return configured || vnaiBase;
    default:
      throw new Error("Invalid AI provider. Use auto, direct or vnai.");
  }
}
