import { verify } from "node:crypto";
import { AccountError, rpc, serviceDb } from "./account.ts";
import { koreaDay } from "../account/policy.ts";
import { z } from "zod";
let keys: { until: number; values: { keyId: number; pem: string }[] } | undefined;
const rewardAttempt = z.uuid();
const rewardPrefix = (attempt: string) => `reward:${attempt.toLowerCase()}:`;

export async function adRewardConfirmed(userId: string, attempt: string) {
  const { data, error } = await serviceDb().from("ad_reward_claims")
    .select("transaction_id").eq("user_id", userId).like("transaction_id", `${rewardPrefix(attempt)}%`).limit(1);
  if (error) throw new AccountError("광고 보상 기록을 확인하지 못했습니다.", 503);
  return Boolean(data?.length);
}

export function canTestAdReward(userId: string) {
  return process.env.NEXT_PUBLIC_ADMOB_MODE === "test" &&
    process.env.ADMOB_TEST_REWARDS_ENABLED === "true" &&
    (process.env.ADMOB_TEST_REWARD_USER_IDS ?? "").split(",").some(id => id.trim().toLowerCase() === userId.toLowerCase());
}

export async function testAdRewardStatus(userId: string) {
  if (!canTestAdReward(userId)) return { enabled: false as const };
  const { count, error } = await serviceDb().from("ad_reward_claims")
    .select("day", { count: "exact", head: true }).eq("user_id", userId).eq("day", koreaDay());
  if (error || count === null) throw new AccountError("오늘의 광고 보상 횟수를 확인하지 못했습니다.", 503);
  return { enabled: true as const, remaining: Math.max(0, 5 - count) };
}

export async function grantTestAdReward(userId: string, attemptId: string) {
  if (!canTestAdReward(userId)) throw new AccountError("테스트 광고 보상을 사용할 수 없는 계정입니다.", 403);
  return rpc<boolean>("grant_ad_reward", { p_user: userId, p_transaction: `test-ad:${userId}:${attemptId.toLowerCase()}` });
}

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
  if (!key || !verify("SHA256", Buffer.from(raw.slice(0, marker)), key.pem, Buffer.from(url.searchParams.get("signature") ?? "", "base64url"))) {
    console.warn("admob-ssv-rejected", { reason: key ? "invalid_signature" : "unknown_signing_key" });
    throw new AccountError("서명 검증 실패", 403);
  }
  // The AdMob console probe verifies the endpoint without granting an ad reward.
  if (url.searchParams.get("custom_data") === "maite-verify-ssv") return;
  const userId = url.searchParams.get("user_id") ?? ""; const transaction = url.searchParams.get("transaction_id") ?? "";
  const units = [process.env.ADMOB_REWARDED_UNIT_ID_TEST, process.env.ADMOB_REWARDED_UNIT_ID_PRODUCTION?.trim() || process.env.ADMOB_REWARDED_UNIT_ID]
    .map(unit => unit?.trim()).filter(Boolean);
  const unitMatches = units.includes(url.searchParams.get("ad_unit") ?? "");
  const amountMatches = url.searchParams.get("reward_amount") === "5";
  const userValid = /^[0-9a-f-]{36}$/i.test(userId);
  const transactionValid = Boolean(transaction) && transaction.length <= 500;
  if (!unitMatches || !amountMatches || !userValid || !transactionValid) {
    console.warn("admob-ssv-rejected", { reason: "reward_fields", unitMatches, amountMatches, userValid, transactionValid });
    throw new AccountError("보상 정보가 일치하지 않습니다.", 403);
  }
  const timestamp = Number(url.searchParams.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 86400000) {
    console.warn("admob-ssv-rejected", { reason: "invalid_timestamp" });
    throw new AccountError("만료된 보상입니다.", 403);
  }
  const attempt = rewardAttempt.safeParse(url.searchParams.get("custom_data"));
  // Retries of a signed event retain both its Google transaction ID and its client attempt ID.
  return rpc("grant_ad_reward", { p_user: userId, p_transaction: attempt.success ? rewardPrefix(attempt.data) + transaction : transaction });
}
