"use client";
import {useCheckinInbox} from "./CheckinInbox";
import CharacterThumbnail from "./CharacterThumbnail";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { cachedCharacterPreviews, characterPreviews } from "@/lib/platform/character-previews";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Gift, Heart, Plus, Sparkles, UserRound, UsersRound } from "lucide-react";
import { useAccount } from "./AccountProvider";
import { useStudioSession, CharacterCreationScreen } from "./CharacterStudio";
import { useActionConfirm } from "./ActionConfirm";
import { accountEnabled } from "@/lib/account/client";
import { PRODUCTS } from "@/lib/account/policy";
import { buyHearts, jsonApi, rewardedAdConfig, waitForAdReward, watchReward } from "@/lib/platform/commerce";
import { trackAnalyticsEvent } from "@/lib/platform/analytics";
import { isNative } from "@/lib/platform/native";
import { useScreenLoading } from "./ScreenLoading";
import WalletBalance from "./WalletBalance";

type TestRewardStatus = { enabled: false } | { enabled: true; remaining: number };
type StoreResult = { title: string; description: string; success?: boolean; refreshWallet?: boolean };

export function StudioHomeScreen() { return accountEnabled() ? <CharactersScreen/> : <CharacterCreationScreen/>; }

export function CharactersScreen() {
  const { account, user, refresh } = useAccount(); const { art, openMenu, flushSave, startNewCharacter } = useStudioSession();
  const unread=useCheckinInbox();
  const [previewState, setPreviews] = useState(() => ({ owner: user?.id, images: cachedCharacterPreviews(user?.id || "demo") })), [error, setError] = useState("");
  const previews = previewState.owner === user?.id ? previewState.images : cachedCharacterPreviews(user?.id || "demo");
  useEffect(() => { if (!user) return; let active = true; const owner = user.id; void flushSave().catch(() => { if (active) setError("저장된 캐릭터 목록을 새로고침하지 못했습니다."); }); void characterPreviews(owner).then(images => { if (active) setPreviews({ owner, images }); }).catch(() => {}); return () => { active = false; }; }, [user?.id]);
  const characters = account?.documents.filter(doc => doc.kind === "studio" || doc.kind === "character") ?? [];
  return <main className="native-page characters-page"><div className="native-page-title"><div><h1>나의 캐릭터</h1><p>오늘은 누구와 이야기를 나눌까요?</p></div><Link href="/ideal/new" aria-label="새 캐릭터 만들기" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); startNewCharacter(); }}><Plus size={23}/></Link></div>
    <div className="native-section-title"><h2>함께하는 캐릭터 <span>{characters.length || (art ? 1 : 0)}</span></h2></div>
    <div className="native-character-grid">{art && !characters.some(doc => doc.character_name === art.profile.name) && <button className="native-character-card" type="button" onClick={() => openMenu("image")}><CharacterThumbnail src={art.url} alt={art.profile.name}/><div><h3>{art.profile.name}</h3><p>우리의 이야기를 이어가요</p><span><Heart size={12}/> 함께하는 중</span></div></button>}
      {characters.map(doc => <Link className="native-character-card" href={`/ideal/characters/${doc.id}`} key={doc.id}>{doc.job_id || (art && art.profile.name === doc.character_name && art.url) ? <CharacterThumbnail src={(doc.job_id && previews[doc.job_id]) || (art?.profile.name === doc.character_name ? art?.url || "" : "")} cacheKey={imageAssetKey({ jobId: doc.job_id, id: doc.id }, "thumbnail")} alt={doc.character_name || doc.title}/> : <div className="character-placeholder"><UserRound size={56}/></div>}<div><div className="character-name-row"><h3>{doc.character_name || doc.title}</h3>{unread[doc.id]>0&&<small className="checkin-arrival-badge">안부 도착</small>}</div><p>대화와 소설을 이어가세요</p><span><BookOpen size={12}/> {Number(doc.chapter) > 0 ? `이야기 ${doc.chapter}편` : "새로운 이야기를 기다려요"}</span></div></Link>)}
      <Link className="new-character-card" href="/ideal/new" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); startNewCharacter(); }}><div><Plus size={32}/></div><h3>새로운 인연</h3><p>나만의 캐릭터 만들기</p></Link>
    </div>{!characters.length && !art && <div className="native-empty"><UsersRound size={35}/><h2>첫 번째 인연을 만나보세요</h2><p>뉴페이스에서 원하는 캐릭터를 만들 수 있어요.</p></div>}{error && <p role="status">{error}</p>}
  </main>;
}

export function HeartStoreScreen() {
  const { account, user, refresh } = useAccount(); const confirm = useActionConfirm();
  const [loadingMessage, setLoadingMessage] = useState("");
  const operation = useRef(false);
  const busy = Boolean(loadingMessage);
  useScreenLoading(busy, loadingMessage);
  const [testReward, setTestReward] = useState<{ userId: string; status: TestRewardStatus }>();
  const [pendingTestReward, setPendingTestReward] = useState<{ userId: string; attemptId: string }>();
  const [pendingAdReward, setPendingAdReward] = useState<{ userId: string; attemptId: string }>();
  const balance = account ? account.wallet.transferable + account.wallet.bonus : 0;
  const native = isNative();
  const rewardAd = rewardedAdConfig();
  const testing = native && Boolean(rewardAd?.testing);
  const adsBlocked = account?.adPlaybackBlocked === true;
  const userId = account?.userId;
  const testStatus = testReward?.userId === userId ? testReward?.status : undefined;
  const pendingAttempt = pendingTestReward?.userId === userId ? pendingTestReward?.attemptId : undefined;
  const pendingAdAttempt = pendingAdReward?.userId === userId ? pendingAdReward?.attemptId : undefined;
  const canWatchReward = Boolean(account && user?.id === userId && account.adPlaybackBlocked === false && native && rewardAd?.adId && (testing
    ? testStatus && (!testStatus.enabled || testStatus.remaining > 0 || pendingAttempt)
    : account.adsEnabled));
  useEffect(() => {
    if (!testing || !userId || account?.adPlaybackBlocked !== false) return;
    let active = true;
    void jsonApi("/api/ads/test-reward").then((status: TestRewardStatus) => {
      if (active) setTestReward({ userId, status });
    }).catch(() => {
      if (active) setTestReward({ userId, status: { enabled: false } });
    });
    return () => { active = false; };
  }, [testing, userId, account?.adPlaybackBlocked]);
  async function run(progress: string, failure: string, work: () => Promise<StoreResult>) {
    if (operation.current) return;
    operation.current = true;
    setLoadingMessage(progress);
    let result: StoreResult;
    try {
      result = await work();
      if (result.refreshWallet) {
        await refresh(true).catch(() => {
          result.description += " 스토어를 다시 열면 최신 잔액을 확인할 수 있어요.";
        });
      }
    } catch (error) {
      result = { title: failure, description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요." };
    } finally {
      setLoadingMessage("");
    }
    try {
      await confirm({ ...result, acknowledgeOnly: true });
    } finally {
      operation.current = false;
    }
  }
  function watchAd(recheck = false) {
    if (!userId || !canWatchReward) return;
    void run(recheck ? "광고 보상을 확인하고 있어요…" : "광고를 준비하고 있어요…", "광고 시청을 완료하지 못했어요", async () => {
      if (testing && !testStatus?.enabled) {
        await watchReward(userId);
        return { title: "테스트 광고 시청 완료", description: "이 계정은 광고 재생만 테스트할 수 있어요.", success: true };
      }
      if (testing) {
        const attemptId = pendingAttempt ?? crypto.randomUUID();
        if (!pendingAttempt) {
          await watchReward(userId);
          setPendingTestReward({ userId, attemptId });
        }
        setLoadingMessage("광고 보상을 확인하고 있어요…");
        const status: TestRewardStatus = await jsonApi("/api/ads/test-reward", { userId, attemptId });
        if (!status.enabled) throw new Error("테스트 광고 보상을 받을 수 없어요.");
        setTestReward({ userId, status });
        setPendingTestReward(undefined);
      } else {
        const attemptId = recheck && pendingAdAttempt ? pendingAdAttempt : crypto.randomUUID();
        if (!recheck) {
          await watchReward(userId, attemptId);
          setPendingAdReward({ userId, attemptId });
        }
        setLoadingMessage("광고 보상을 확인하고 있어요…");
        if (!await waitForAdReward(attemptId)) return { title: "광고 보상 확인 중", description: "서버 확인이 늦어지고 있어요. 잠시 후 ‘보상 재확인’을 눌러주세요." };
        setPendingAdReward(undefined);
        trackAnalyticsEvent("rewarded_ad_granted");
      }
      return { title: "광고 시청 성공", description: "파란 하트 5개를 받았어요.", success: true, refreshWallet: true };
    });
  }
  async function purchase(product: typeof PRODUCTS[number]) {
    if (!await confirm({ title: "하트를 충전할까요?", description: product.label, lines: [{ label: "결제 금액", value: `${product.won.toLocaleString()}원` }, { label: "즉시 지급", value: `${product.hearts}하트` }, ...("dailyHearts" in product ? [{label:"일일 지급",value:`${product.days}일간 날짜별 ${product.dailyHearts}하트 (최대 ${product.dailyHearts*product.days}하트)`},{label:"최대 총 지급",value:`${product.totalHearts}하트`}] : []), { label: "충전 후 보유 하트", value: `${(balance + product.hearts).toLocaleString()}하트` }], confirmLabel: "구매하기" })) return;
    await run("Google Play에 연결하고 있어요…", "하트 구매를 완료하지 못했어요", async () => {
      const result = await buyHearts(product.id, () => setLoadingMessage("구매를 확인하고 있어요…"));
      if (result.state === "pending") return { title: "결제 승인 대기 중", description: "Google Play에서 결제가 완료되면 ‘구매 복구’를 눌러주세요." };
      trackAnalyticsEvent("heart_purchase_completed");
      return { title: "하트 구매 성공", description: `빨간 하트 ${product.hearts.toLocaleString()}개가 충전됐어요.`, success: true, refreshWallet: true };
    });
  }
  function restorePurchase() {
    void run("미완료 구매를 확인하고 있어요…", "구매 복구를 완료하지 못했어요", async () => {
      const result = await buyHearts();
      if (result.state === "restored" && result.restored) return { title: "구매 복구 완료", description: "구매 내역을 확인하고 하트 잔액을 갱신했어요.", success: true, refreshWallet: true };
      return { title: "구매 내역 확인", description: "복구할 완료 구매가 없어요." };
    });
  }
  return <main className="native-page heart-store-page"><div className="native-page-title"><div><h1>하트 스토어</h1></div><Heart size={25}/></div>
    <section className="native-wallet"><span>내가 가진 하트</span><WalletBalance wallet={account?.wallet}/></section>
    <div className="native-section-title"><h2>하트 충전</h2><span>Google Play</span></div><div className="heart-product-list">{PRODUCTS.map((product, index) => <article className={`heart-product ${index === 2 ? "recommended" : ""}`} key={product.id}><div className="product-icon">{index === 3 ? <Sparkles size={26}/> : <Heart size={27} fill="currentColor"/>}</div><div><h3>{product.label}</h3>{index === 2 && <span className="native-badge">추천 상품</span>}{"description" in product && <small>{product.description}</small>}{index === 3 && <small>자동 갱신 없는 30일 이용권</small>}</div><button type="button" disabled={busy || !account?.billingEnabled || !isNative()} onClick={() => void purchase(product)}>{product.won.toLocaleString()}원</button></article>)}</div>
    {!isNative() && <p className="native-help">하트 구매는 Android 앱에서 이용할 수 있어요.</p>}{isNative() && !account?.billingEnabled && <p className="native-help">하트 충전 서비스 준비 중이에요.</p>}
    <section className="native-reward-card"><Gift size={26}/><div><h3>광고 보고 파란 하트 받기</h3>
      <p>{adsBlocked ? "이 계정에서는 광고 시청이 비활성화되어 있어요." : testing ? testStatus?.enabled ? `테스트 보상 5개 · 오늘 ${testStatus.remaining}회 남음` : "테스트 광고 재생 확인" : "한 번에 5개 · 하루 최대 5회 · 정산 제외"}</p>
      {native && <p>{rewardAd ? (testing ? "광고 모드 · 테스트" : "광고 모드 · 운영") : "광고 모드 설정 오류"}</p>}</div>
      <button disabled={busy || !canWatchReward} onClick={() => watchAd()}>{pendingAttempt ? "보상 재확인" : testing && !testStatus?.enabled ? "테스트 재생" : "받기"}</button>
      {!testing && pendingAdAttempt && <button disabled={busy || !canWatchReward} onClick={() => watchAd(true)}>보상 재확인</button>}
    </section>
    <p className="native-help">하트 패스는 즉시 200하트와 30일간 날짜별 20하트로 최대 800하트를 드려요. 내 정보의 출석보상 달력에서 직접 받으며, 놓친 패스 보상도 나중에 받을 수 있어요. 자동으로 갱신되지 않아요.</p>
    <button className="native-text-button" disabled={busy || !account?.billingEnabled || !isNative()} onClick={restorePurchase}>구매 복구 <ChevronRight size={16}/></button>
  </main>;
}
