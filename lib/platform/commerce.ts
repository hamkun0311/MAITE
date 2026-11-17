"use client";
import { isNative } from "./native";
import { apiFetch } from "./api";
export async function jsonApi(path: string, body?: object) {
  const response = await apiFetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "요청을 완료하지 못했습니다."); return data;
}
export async function buyHearts(productId?: string) {
  if (!isNative()) throw new Error("하트 충전은 Android 앱에서 사용할 수 있습니다.");
  const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
  await NativePurchases.configure({ autoFinishTransactions: false });
  const { accountId } = await jsonApi("/api/billing");
  if (productId) {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [productId], productType: PURCHASE_TYPE.INAPP });
    if (!products.length) throw new Error("Google Play에 등록된 상품을 찾지 못했습니다.");
    const transaction = await NativePurchases.purchaseProduct({ productIdentifier: productId, productType: PURCHASE_TYPE.INAPP, appAccountToken: accountId, isConsumable: true, autoAcknowledgePurchases: false, offerToken: products[0].offerToken });
    if (transaction.purchaseState !== "1") throw new Error("결제 승인 대기 중입니다. 완료 후 구매 복구를 눌러주세요.");
    await jsonApi("/api/billing", { productId, token: transaction.purchaseToken ?? transaction.transactionId });
  } else {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP, appAccountToken: accountId });
    for (const transaction of purchases) {
      if (transaction.purchaseState === "1") await jsonApi("/api/billing", { productId: transaction.productIdentifier, token: transaction.purchaseToken ?? transaction.transactionId });
    }
  }
}
export async function watchReward(userId: string) {
  if (!isNative()) throw new Error("보상 광고는 Android 앱에서 사용할 수 있습니다.");
  const { AdMob, AdmobConsentStatus } = await import("@capacitor-community/admob");
  let consent = await AdMob.requestConsentInfo();
  if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) consent = await AdMob.showConsentForm();
  if (!consent.canRequestAds) throw new Error("광고 개인정보 설정을 확인해주세요.");
  const testing = process.env.NEXT_PUBLIC_ADMOB_TESTING !== "false";
  const adId = process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID;
  if (!adId) throw new Error("광고 단위 설정이 필요합니다.");
  await AdMob.initialize({ initializeForTesting: testing });
  await AdMob.prepareRewardVideoAd({ adId, isTesting: testing, ssv: { userId } });
  await AdMob.showRewardVideoAd();
  // Only the Google-signed server callback grants hearts. The SDK result never does.
}
