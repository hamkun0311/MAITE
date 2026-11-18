"use client";
import CachedImage from "./CachedImage";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Gift, Heart, Plus, Sparkles, UserRound, UsersRound } from "lucide-react";
import { useAccount } from "./AccountProvider";
import { useStudioSession, CharacterCreationScreen } from "./CharacterStudio";
import { useActionConfirm } from "./ActionConfirm";
import { accountEnabled } from "@/lib/account/client";
import { PRODUCTS } from "@/lib/account/policy";
import { buyHearts, jsonApi, watchReward } from "@/lib/platform/commerce";
import { isNative } from "@/lib/platform/native";

export function StudioHomeScreen() { return accountEnabled() ? <CharactersScreen/> : <CharacterCreationScreen/>; }

export function CharactersScreen() {
  const { account, user, refresh } = useAccount(); const { art, openMenu, flushSave } = useStudioSession();
  const [previews, setPreviews] = useState<Record<string, string>>({}), [error, setError] = useState("");
  useEffect(() => { if (!user) return; let active = true; void flushSave().catch(() => { if (active) setError("저장된 캐릭터 목록을 새로고침하지 못했습니다."); }); void jsonApi("/api/account?previews=1").then(data => { if (active) setPreviews(data.images ?? {}); }).catch(() => {}); return () => { active = false; }; }, []);
  const characters = account?.documents.filter(doc => doc.kind === "studio" || doc.kind === "character") ?? [];
  return <main className="native-page characters-page"><div className="native-page-title"><div><h1>나의 캐릭터</h1><p>오늘은 누구와 이야기를 나눌까요?</p></div><Link href="/ideal/new" aria-label="새 캐릭터 만들기"><Plus size={23}/></Link></div>
    <div className="native-section-title"><h2>함께하는 캐릭터 <span>{characters.length || (art ? 1 : 0)}</span></h2></div>
    <div className="native-character-grid">{art && !characters.some(doc => doc.character_name === art.profile.name) && <button className="native-character-card" type="button" onClick={() => openMenu("image")}><img src={art.url} alt={art.profile.name}/><div><h3>{art.profile.name}</h3><p>우리의 이야기를 이어가요</p><span><Heart size={12}/> 함께하는 중</span></div></button>}
      {characters.map(doc => <Link className="native-character-card" href={`/ideal/characters/${doc.id}`} key={doc.id}>{(doc.job_id && previews[doc.job_id]) || (art && art.profile.name === doc.character_name && art.url) ? <CachedImage src={(doc.job_id && previews[doc.job_id]) || art?.url || ""} cacheKey={imageAssetKey({ jobId: doc.job_id, id: doc.id }, "thumbnail")} loading="lazy" alt={doc.character_name || doc.title}/> : <div className="character-placeholder"><UserRound size={56}/></div>}<div><h3>{doc.character_name || doc.title}</h3><p>대화와 소설을 이어가세요</p><span><BookOpen size={12}/> {Number(doc.chapter) > 0 ? `이야기 ${doc.chapter}편` : "새로운 이야기를 기다려요"}</span></div></Link>)}
      <Link className="new-character-card" href="/ideal/new"><div><Plus size={32}/></div><h3>새로운 인연</h3><p>나만의 캐릭터 만들기</p></Link>
    </div>{!characters.length && !art && <div className="native-empty"><UsersRound size={35}/><h2>첫 번째 인연을 만나보세요</h2><p>뉴페이스에서 원하는 캐릭터를 만들 수 있어요.</p></div>}{error && <p role="status">{error}</p>}
  </main>;
}

export function HeartStoreScreen() {
  const { account, refresh } = useAccount(); const confirm = useActionConfirm();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const balance = account ? account.wallet.transferable + account.wallet.bonus : 0;
  async function run(work: () => Promise<unknown>, success: string) { if (busy) return; setBusy(true); setNotice(""); try { await work(); await refresh(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : "요청을 완료하지 못했습니다."); } finally { setBusy(false); } }
  async function purchase(product: typeof PRODUCTS[number]) {
    if (!await confirm({ title: "하트를 충전할까요?", description: product.label, lines: [{ label: "결제 금액", value: `${product.won.toLocaleString()}원` }, { label: "즉시 지급", value: `${product.hearts}하트` }, ...("dailyHearts" in product ? [{label:"일일 지급",value:`${product.days}일간 날짜별 ${product.dailyHearts}하트 (최대 ${product.dailyHearts*product.days}하트)`},{label:"최대 총 지급",value:`${product.totalHearts}하트`}] : []), { label: "충전 후 보유 하트", value: `${(balance + product.hearts).toLocaleString()}하트` }], confirmLabel: "구매하기" })) return;
    await run(() => buyHearts(product.id), "하트를 충전했습니다.");
  }
  return <main className="native-page heart-store-page"><div className="native-page-title"><div><h1>하트 스토어</h1></div><Heart size={25}/></div>
    <section className="native-wallet"><span>내가 가진 하트</span><strong><Heart fill="currentColor" size={29}/>{balance.toLocaleString()}</strong><small>구매·판매 {account?.wallet.transferable ?? 0} · 보상 {account?.wallet.bonus ?? 0}</small></section>
    <div className="native-section-title"><h2>하트 충전</h2><span>Google Play</span></div><div className="heart-product-list">{PRODUCTS.map((product, index) => <article className={`heart-product ${index === 2 ? "recommended" : ""}`} key={product.id}><div className="product-icon">{index === 3 ? <Sparkles size={26}/> : <Heart size={27} fill="currentColor"/>}</div><div><h3>{product.label}</h3>{index === 2 && <span className="native-badge">추천 상품</span>}{"description" in product && <small>{product.description}</small>}{index === 3 && <small>자동 갱신 없는 30일 이용권</small>}</div><button type="button" disabled={busy || !account?.billingEnabled || !isNative()} onClick={() => void purchase(product)}>{product.won.toLocaleString()}원</button></article>)}</div>
    {!isNative() && <p className="native-help">하트 구매는 Android 앱에서 이용할 수 있어요.</p>}{isNative() && !account?.billingEnabled && <p className="native-help">하트 충전 서비스 준비 중이에요.</p>}
    <section className="native-reward-card"><Gift size={26}/><div><h3>광고 보고 하트 받기</h3><p>한 번에 5하트 · 하루 최대 5회</p></div><button disabled={busy || !account?.adsEnabled || !isNative()} onClick={() => void run(() => watchReward(account!.userId), "광고 보상 확인 후 하트에 반영됩니다.")}>받기</button></section>
    <p className="native-help">하트 패스는 즉시 200하트와 30일간 날짜별 20하트로 최대 800하트를 드려요. 마이페이지의 출석보상 달력에서 직접 받으며, 놓친 패스 보상도 나중에 받을 수 있어요. 자동으로 갱신되지 않아요.</p>
    <button className="native-text-button" disabled={busy || !account?.billingEnabled || !isNative()} onClick={() => void run(() => buyHearts(), "미완료 구매를 확인했습니다.")}>구매 복구 <ChevronRight size={16}/></button>{notice && <p role="status">{notice}</p>}
  </main>;
}
