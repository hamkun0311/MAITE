"use client";
import { isNative } from "./native";
import { apiFetch } from "./api";
import { accountClient } from "../account/client";
import { ReadCache } from "./read-cache";
const reads = new ReadCache();
export const invalidateApiReads = () => reads.clear();
export async function jsonApi(path: string, body?: object) {
  const request = async () => {
    const response = await apiFetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { signal: AbortSignal.timeout(30000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "요청을 완료하지 못했습니다."); return data;
  };
  if (body) { reads.clear(); try { return await request(); } finally { reads.clear(); } }
  const auth = accountClient(); const session = auth ? (await auth.auth.getSession()).data.session : null;
  const ttl = /[?&](document|job|previews)=/.test(path) ? 15000 : path === "/api/store" || path.startsWith("/api/rewards?month=") ? 5000 : 0;
  return reads.get(session?.access_token || "demo", path, request, ttl);
}
export async function buyHearts(productId?: string, onVerifying?: () => void) {
  if (!isNative()) throw new Error("하트 충전은 Android 앱에서 사용할 수 있습니다.");
  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
  await NativePurchases.configure({ autoFinishTransactions: false });
  const { accountId } = await jsonApi("/api/billing");
  if (productId) {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [productId], productType: PURCHASE_TYPE.INAPP });
    if (!products.length) throw new Error("Google Play에 등록된 상품을 찾지 못했습니다.");
    const transaction = await NativePurchases.purchaseProduct({ productIdentifier: productId, productType: PURCHASE_TYPE.INAPP, appAccountToken: accountId, isConsumable: true, autoAcknowledgePurchases: false, offerToken: products[0].offerToken });
    if (transaction.purchaseState !== "1") return { state: "pending" as const };
    onVerifying?.();
    await jsonApi("/api/billing", { productId, token: transaction.purchaseToken ?? transaction.transactionId });
    return { state: "purchased" as const };
  } else {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP, appAccountToken: accountId });
    let restored = 0;
    for (const transaction of purchases) {
      if (transaction.purchaseState === "1") {
        await jsonApi("/api/billing", { productId: transaction.productIdentifier, token: transaction.purchaseToken ?? transaction.transactionId });
        restored++;
      }
    }
    return { state: "restored" as const, restored };
  }
}
export function rewardedAdConfig() {
  const mode = process.env.NEXT_PUBLIC_ADMOB_MODE?.trim();
  if (mode && mode !== "test" && mode !== "production") return undefined;
  const testing = mode ? mode === "test" : process.env.NEXT_PUBLIC_ADMOB_TESTING !== "false";
  const configuredId = testing ? process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID_TEST : process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID_PRODUCTION;
  const adId = configuredId?.trim() || (!mode ? process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID?.trim() : "") ||
    (testing ? "ca-app-pub-3940256099942544/5224354917" : "");
  return { testing, adId };
}
export async function watchReward(userId: string, attemptId?: string) {
  if (!isNative()) throw new Error("보상 광고는 Android 앱에서 사용할 수 있습니다.");
  const auth = await accountClient()?.auth.getSession();
  const user = auth?.data.session?.user;
  if (!user || user.id !== userId) throw new Error("광고를 보려는 계정으로 다시 로그인해주세요.");
  const config = rewardedAdConfig();
  if (!config?.adId) throw new Error("광고 모드와 광고 단위 설정을 확인해주세요.");
  const { AdMob, AdmobConsentStatus } = await import("@capacitor-community/admob");
  let consent = await AdMob.requestConsentInfo();
  if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) consent = await AdMob.showConsentForm();
  if (!consent.canRequestAds) throw new Error("광고 개인정보 설정을 확인해주세요.");
  const { testing, adId } = config;
  await AdMob.initialize({ initializeForTesting: testing });
  await AdMob.prepareRewardVideoAd({ adId, isTesting: testing, ...(testing ? {} : { ssv: { userId, customData: attemptId } }) });
  await AdMob.showRewardVideoAd();
  // The SDK result is only used by the explicitly enabled QA reward flow.
}

export async function waitForAdReward(attemptId: string) {
  for (const delay of [0, 1000, 2000, 3000, 4000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const response = await apiFetch(`/api/ads/reward?attempt=${encodeURIComponent(attemptId)}`, { signal: AbortSignal.timeout(3500), cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "광고 보상 정보를 확인하지 못했습니다.");
    if (result.confirmed === true) return true;
  }
  return false;
}
