import { createHash } from "node:crypto";
import { AccountError, serviceDb } from "./account.ts";

type Identity = { id: string; user_metadata: Record<string, any> };
const verified = new Map<string, { user: Identity; expires: number }>();
const pending = new Map<string, Promise<{ user: Identity; expires: number }>>();

/** Read-only identity; mutations still use the live getUser check. */
export async function requireNotificationAccount(request: Request) {
  if (process.env.ACCOUNT_FEATURES_ENABLED !== "true") throw new AccountError("계정 기능을 아직 설정하지 않았습니다.", 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AccountError("구글 로그인이 필요합니다.", 401);
  const db = serviceDb(), issuer = `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1`;
  const key = createHash("sha256").update(`${issuer}\n${token}`).digest("hex");
  const cached = verified.get(key);
  if (cached && cached.expires > Date.now()) return { db, user: cached.user };
  verified.delete(key);
  let work = pending.get(key);
  if (!work) {
    work = (async () => {
      // SDK verifies signature/expiry using cached JWKS; HS keys fall back to Auth.
      const { data, error } = await db.auth.getClaims(token);
      const claims = data?.claims;
      if (error || !claims || claims.iss !== issuer || claims.role !== "authenticated" ||
          !(Array.isArray(claims.aud) ? claims.aud.includes("authenticated") : claims.aud === "authenticated") ||
          typeof claims.sub !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(claims.sub) ||
          !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() ||
          (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now())) {
        throw new AccountError("로그인 정보를 확인해주세요.", 401);
      }
      const entry = { user: { id: claims.sub, user_metadata: claims.user_metadata ?? {} }, expires: Math.min(claims.exp * 1000, Date.now() + 30000) };
      verified.set(key, entry);
      while (verified.size > 500) verified.delete(verified.keys().next().value!);
      return entry;
    })();
    pending.set(key, work);
  }
  try { const entry = await work; return { db, user: entry.user }; }
  catch { throw new AccountError("로그인 정보를 확인해주세요.", 401); }
  finally { if (pending.get(key) === work) pending.delete(key); }
}
