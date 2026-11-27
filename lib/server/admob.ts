import { verify } from "node:crypto";
import { AccountError, rpc } from "./account.ts";
let keys: { until: number; values: { keyId: number; pem: string }[] } | undefined;
export async function verifyAdmob(url: URL) {
  if (process.env.ADMOB_REWARDS_ENABLED !== "true") throw new AccountError("광고 보상을 아직 사용할 수 없습니다.", 503);
  const raw = url.search.slice(1);
  if (raw.length > 10000 || new Set([...url.searchParams.keys()]).size !== [...url.searchParams.keys()].length) throw new AccountError("잘못된 콜백입니다.");
  const marker = raw.indexOf("&signature=");
  if (marker < 0 || !/^signature=[^&]+&key_id=\d+$/.test(raw.slice(marker + 1))) throw new AccountError("서명이 없습니다.");
  if (!keys || keys.until <= Date.now() || !keys.values.some(key => String(key.keyId) === url.searchParams.get("key_id"))) {
    const response = await fetch("https://www.gstatic.com/admob/reward/verifier-keys.json", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new AccountError("서명 키를 조회하지 못했습니다.", 503);
    const data = await response.json(); keys = { until: Date.now() + 3600000, values: data.keys };
  }
  const key = keys.values.find(key => String(key.keyId) === url.searchParams.get("key_id"));
  if (!key || !verify("SHA256", Buffer.from(raw.slice(0, marker)), key.pem, Buffer.from(url.searchParams.get("signature") ?? "", "base64url"))) throw new AccountError("서명 검증 실패", 403);
  const userId = url.searchParams.get("user_id") ?? ""; const transaction = url.searchParams.get("transaction_id") ?? "";
  const units = [process.env.ADMOB_REWARDED_UNIT_ID_TEST, process.env.ADMOB_REWARDED_UNIT_ID_PRODUCTION?.trim() || process.env.ADMOB_REWARDED_UNIT_ID]
    .map(unit => unit?.trim()).filter(Boolean);
  if (!units.includes(url.searchParams.get("ad_unit") ?? "") || url.searchParams.get("reward_amount") !== "5" || !/^[0-9a-f-]{36}$/i.test(userId) || !transaction || transaction.length > 500) throw new AccountError("보상 정보가 일치하지 않습니다.", 403);
  const timestamp = Number(url.searchParams.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 86400000) throw new AccountError("만료된 보상입니다.", 403);
  return rpc("grant_ad_reward", { p_user: userId, p_transaction: transaction });
}
