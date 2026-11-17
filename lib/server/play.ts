import { createHash, createSign } from "node:crypto";
import { AccountError, rpc, serviceDb } from "./account.ts";
import { PRODUCTS } from "../account/policy.ts";
let cached: { value: string; until: number } | undefined;
export const playAccountId = (userId: string) => createHash("sha256").update(`maite:${userId}`).digest("hex");
async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.value;
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PLAY_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!email || !privateKey) throw new AccountError("Google Play 서버 인증 설정이 필요합니다.", 503);
  const iat = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(`${head}.${body}`);
  const assertion = `${head}.${body}.${signer.sign(privateKey, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new AccountError("결제 인증 서비스에 연결하지 못했습니다.", 503);
  cached = { value: data.access_token, until: Date.now() + 3000000 }; return cached.value;
}
export async function verifyPurchase(userId: string, productId: string, token: string) {
  if (process.env.GOOGLE_PLAY_BILLING_ENABLED !== "true") throw new AccountError("결제를 아직 사용할 수 없습니다.", 503);
  const product = PRODUCTS.find(product => product.id === productId || ("legacyPlayIds" in product && product.legacyPlayIds.some(id => id === productId)));
  if (!product) throw new AccountError("등록되지 않은 상품입니다.");
  // Both the original app SKU and the already registered legacy SKU grant
  // the same canonical ledger product; Google still verifies the exact SKU.
  const grantProductId = product.id;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!packageName) throw new AccountError("앱 패키지 설정이 필요합니다.", 503);
  const hash = createHash("sha256").update(token).digest("hex");
  const db = serviceDb();
  const previous = await db.from("payment_purchases").select("user_id,product_id,acknowledged_at").eq("token_hash", hash).maybeSingle();
  if (previous.error) throw new AccountError("결제 기록을 확인하지 못했습니다.", 503);
  if (previous.data && (previous.data.user_id !== userId || previous.data.product_id !== grantProductId)) throw new AccountError("다른 계정의 결제입니다.", 403);
  if (previous.data?.acknowledged_at) return { granted: false, settled: true };
  const auth = await accessToken();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
  const headers = { Authorization: `Bearer ${auth}` };
  const response = await fetch(base, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new AccountError("Google Play 구매를 확인하지 못했습니다.", 409);
  const purchase = await response.json();
  if (purchase.purchaseState !== 0 || (purchase.quantity ?? 1) !== 1 || purchase.obfuscatedExternalAccountId !== playAccountId(userId) || (purchase.productId && purchase.productId !== productId)) throw new AccountError("완료된 본인 구매만 충전할 수 있습니다.", 409);
  const granted = await rpc<boolean>("grant_purchase", { p_user: userId, p_hash: hash, p_product: grantProductId, p_order: purchase.orderId ?? null });
  // Consumption acknowledges consumables and allows another purchase; grant precedes consume.
  if (purchase.consumptionState !== 1) {
    const consumed = await fetch(`${base}:consume`, { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    if (!consumed.ok) throw new AccountError("충전은 반영되었습니다. 구매 복구를 눌러 결제 완료 처리를 재시도해주세요.", 503);
  }
  const updated = await db.from("payment_purchases").update({ acknowledged_at: new Date().toISOString() }).eq("token_hash", hash);
  if (updated.error) throw new AccountError("충전은 반영되었습니다. 구매 복구로 완료 상태를 확인해주세요.", 503);
  return { granted, settled: true };
}
