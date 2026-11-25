import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

const lifetime = 60 * 60 * 1000;
const maxTokenLength = 6500;
const demoSecret = randomBytes(32);
const claims = z.object({ expires: z.number(), approved: z.literal(true).optional(), brief: z.unknown().optional(), rejection: z.string().max(300).optional() });
export type ImageRetryProgress = Pick<z.infer<typeof claims>, "approved" | "brief" | "rejection">;

export function imageRetryToken(owner: string | undefined, attempt: string, scope: string, fingerprint: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || (owner ? undefined : demoSecret);
  if (!secret) return undefined;
  const key = Buffer.from(hkdfSync("sha256", secret, "maite", "image-retry-token", 32));
  const binding = Buffer.from(JSON.stringify(["image-description-v1", owner ?? "demo", attempt, scope, fingerprint]));
  return {
    read(token: string | null): ImageRetryProgress | undefined {
      if (!token || token.length > maxTokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) return;
      try {
        const bytes = Buffer.from(token, "base64url");
        if (bytes.length < 29) return;
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAAD(binding);
        decipher.setAuthTag(bytes.subarray(12, 28));
        const decoded = claims.safeParse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
        if (!decoded.success || decoded.data.expires <= Date.now()) return;
        const { approved, brief, rejection } = decoded.data;
        return { approved, brief, rejection };
      } catch { return; }
    },
    issue(progress: ImageRetryProgress) {
      if (!progress.approved && !progress.rejection) return;
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(binding);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...progress, expires: Date.now() + lifetime })), cipher.final()]);
      const token = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
      return token.length <= maxTokenLength ? token : undefined;
    },
  };
}
