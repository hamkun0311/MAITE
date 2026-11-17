"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart } from "lucide-react";
import { accountClient, accountEnabled } from "@/lib/account/client";
import { buyHearts, jsonApi, watchReward } from "@/lib/platform/commerce";
import { isNative } from "@/lib/platform/native";
import { PRODUCTS, STORE_PRICE } from "@/lib/account/policy";

type Account = { userId: string; email: string; wallet: { transferable: number; bonus: number; free_chats: number }; documents: { id: string; title: string; kind: string }[]; jobs: { id: string; kind: string; status: string }[]; billingEnabled: boolean; adsEnabled: boolean };
type Listing = { id: string; seller_id: string; kind: "character" | "chapter"; title: string; description: string };
export default function AccountMenu({ onSave, onLoad, onPublish, onImport }: {
  onSave: () => Promise<void>; onLoad: (id: string) => Promise<void>;
  onPublish: (kind: "character" | "chapter") => Promise<void>; onImport: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false); const [loggedIn, setLoggedIn] = useState(false);
  const [account, setAccount] = useState<Account>(); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<{ listings: Listing[]; owned: string[] }>();
  const [result, setResult] = useState<{ id: string; text?: string; imageUrl?: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const client = accountClient(); const activeUser = useRef<string | undefined>("uninitialized");
  async function refresh() {
    if (!client || !accountEnabled()) return;
    const { data } = await client.auth.getSession();
    if (data.session) { const id = data.session.user.id; const account = await jsonApi("/api/account"); if (activeUser.current === id) setAccount(account); }
  }
  async function run(work: () => Promise<unknown>, success = "완료했습니다.") {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await work(); await refresh(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : "작업을 완료하지 못했습니다."); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!client || !accountEnabled()) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id; setLoggedIn(!!id);
      if (activeUser.current !== id) {
        activeUser.current = id; setAccount(undefined); setStore(undefined); setResult(undefined);
        window.dispatchEvent(new CustomEvent("maite-account-change", { detail: id ?? "anonymous" }));
      }
      // Supabase warns against awaiting another auth call inside this callback.
      if (session) setTimeout(() => { void jsonApi("/api/account", { action: "daily" }).then(refresh).catch(error => setNotice(error.message)); }, 0);
    });
    const refreshEvent = () => { void refresh().catch(() => undefined); };
    window.addEventListener("maite-account-refresh", refreshEvent);
    const daily = () => { if (document.visibilityState === "visible" && activeUser.current && activeUser.current !== "uninitialized") void jsonApi("/api/account", { action: "daily" }).then(refresh).catch(error => setNotice(error.message)); };
    window.addEventListener("focus", daily); window.addEventListener("maite-foreground", daily);
    let link: { remove: () => Promise<void> } | undefined; let disposed = false;
    if (isNative()) void import("@capacitor/app").then(async ({ App }) => {
      const callbackUrl = async ({ url }: { url: string }) => {
        const callback = new URL(url);
        if (callback.protocol !== "com.oestewdio.maite:" || callback.hostname !== "auth" || callback.pathname !== "/callback") return;
        const code = callback.searchParams.get("code");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) setNotice("로그인을 완료하지 못했습니다. 다시 시도해주세요.");
          const { Browser } = await import("@capacitor/browser"); await Browser.close().catch(() => undefined);
        }
      };
      const listener = await App.addListener("appUrlOpen", callbackUrl);
      const launch = await App.getLaunchUrl(); if (launch?.url) await callbackUrl(launch);
      if (disposed) await listener.remove(); else link = listener;
    });
    return () => { disposed = true; data.subscription.unsubscribe(); window.removeEventListener("maite-account-refresh", refreshEvent); window.removeEventListener("focus", daily); window.removeEventListener("maite-foreground", daily); void link?.remove(); };
  }, [client]);
  // Limit refresh to the visible menu. apiFetch emits refresh for every request, including account reads.
  useEffect(() => { if (open && loggedIn) void refresh().catch(error => setNotice(error.message)); }, [open, loggedIn]);
  async function login() {
    if (!client || !accountEnabled()) throw new Error("계정 기능을 사용하려면 Supabase 설정이 필요합니다.");
    const native = isNative();
    const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: native ? "com.oestewdio.maite://auth/callback" : `${location.origin}/ideal`, skipBrowserRedirect: native } });
    if (error) throw error;
    if (native && data.url) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: data.url }); }
  }
  async function loadStore() { setStore(await jsonApi("/api/store")); }
  return <>
    <button type="button" className="account-trigger" onClick={() => setOpen(true)} aria-label="계정 및 하트"><Heart size={16}/><span>{account ? `${account.wallet.transferable + account.wallet.bonus}` : "계정 · 하트"}</span></button>
    {open && createPortal(<dialog ref={dialog} className="account-overlay" aria-label="계정 및 하트" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}><section className="account-dialog">
      <header><h2>계정 · 하트</h2><button aria-label="계정 닫기" onClick={() => setOpen(false)}>닫기</button></header>
      {!accountEnabled() || !client ? <p>계정 기능을 아직 설정하지 않았습니다. Supabase 연결 후 로그인·저장·충전을 사용할 수 있습니다.</p> : !loggedIn ? <button disabled={busy} onClick={() => void run(login, "로그인을 진행해주세요.")}>Google로 로그인</button> : <>
        <p>{account?.email}</p>
        <p>하트 {account ? account.wallet.transferable + account.wallet.bonus : "…"} · 무료 대화 {account?.wallet.free_chats ?? "…"}회</p>
        {account && <p>구매·판매 하트 {account.wallet.transferable} / 보상 하트 {account.wallet.bonus}<br/>스토어 구매에는 구매·판매 하트를 사용합니다.</p>}
        <p>대화 2 ♥ · 이야기 15 ♥ · 캐릭터 생성 50 ♥ · 삽화 50 ♥ · 대화 이미지 30 ♥</p>
        <button disabled={busy} onClick={() => void run(async () => { const data = await jsonApi("/api/account", { action: "daily" }); setNotice(`오늘 수령: ${data.claimed}하트`); }, "오늘의 출석·기간권 보상을 확인했습니다.")}>오늘 보상 확인</button>
        <h3>하트 충전</h3>
        {PRODUCTS.map(product => <button key={product.id} disabled={busy || !account?.billingEnabled || !isNative()} onClick={() => void run(() => buyHearts(product.id), "하트를 충전했습니다.")}>{product.label} · {product.won.toLocaleString()}원</button>)}
        <p>기간권은 자동 갱신 없이 한국시간 구매일부터 30일간 유효합니다. 출석한 날만 하루 10개를 받습니다.</p>
        <button disabled={busy || !account?.billingEnabled || !isNative()} onClick={() => void run(() => buyHearts(), "미완료 구매를 확인했습니다.")}>구매 복구</button>
        <button disabled={busy || !account?.adsEnabled || !isNative()} onClick={() => void run(() => watchReward(account!.userId), "광고가 종료되었습니다. 서버 검증 후 5하트가 반영됩니다. 잠시 후 새로고침해주세요.")}>광고 보고 5하트 · 하루 최대 5회</button>
        <button disabled={busy} onClick={() => void run(refresh, "잔액을 갱신했습니다.")}>잔액 새로고침</button>
        <h3>내 보관함</h3>
        <button disabled={busy} onClick={() => void run(onSave, "현재 캐릭터·대화·이야기를 저장했습니다.")}>현재 작업 저장</button>
        {account?.documents.map(doc => <div key={doc.id}><button disabled={busy} onClick={() => void run(() => onLoad(doc.id), "저장 내용을 불러왔습니다.")}>{doc.title}</button><button disabled={busy} onClick={() => void run(() => jsonApi("/api/account", { action: "delete", id: doc.id }), "보관함에서 삭제했습니다.")}>삭제</button></div>)}
        <h3>스토어</h3>
        <p>캐릭터 판매금액 30 / 수수료 -5 / 총 수령 25 ♥<br/>소설 회차 판매금액 10 / 수수료 -2 / 총 수령 8 ♥</p>
        <button disabled={busy} onClick={() => void run(() => onPublish("character"), "캐릭터를 등록했습니다.")}>현재 캐릭터 등록</button>
        <button disabled={busy} onClick={() => void run(() => onPublish("chapter"), "현재 회차를 등록했습니다.")}>현재 소설 회차 등록</button>
        <button disabled={busy} onClick={() => void run(loadStore, "스토어를 불러왔습니다.")}>상품 목록</button>
        {store?.listings.map(listing => { const price = STORE_PRICE[listing.kind]; const own = listing.seller_id === account?.userId; const purchased = store.owned.includes(listing.id);
          return <article key={listing.id}><h4>{listing.title}</h4><p>{listing.description}</p><p>구매금액 {price.price} / 수수료 +{price.buyerFee} / 총 {price.total} ♥</p>
            {own ? <button disabled={busy} onClick={() => void run(async () => { await jsonApi("/api/store", { action: "unpublish", listingId: listing.id }); await loadStore(); }, "판매를 중지했습니다.")}>판매 중지</button> : purchased ? <button disabled={busy} onClick={() => void run(async () => { const data = await jsonApi(`/api/store?id=${listing.id}`); if (data.kind === "character") await onImport(data); else setResult({ id: listing.id, text: data.content.text }); }, "구매한 콘텐츠를 열었습니다.")}>{listing.kind === "character" ? "내 캐릭터로 사용" : "회차 읽기"}</button> : <button disabled={busy} onClick={() => void run(async () => { await jsonApi("/api/store", { action: "buy", id: crypto.randomUUID(), listingId: listing.id }); await loadStore(); }, "구매했습니다.")}>총 {price.total}하트로 구매</button>}
            <button disabled={busy} onClick={() => { const reason = window.prompt("신고 사유를 입력해주세요."); if (reason?.trim()) void run(() => jsonApi("/api/account", { action: "report", listingId: listing.id, reason }), "신고를 접수했습니다."); }}>신고</button>
          </article>; })}
        <h3>최근 생성 작업</h3>
        {account?.jobs.map(job => <div key={job.id}><span>{job.kind} · {job.status === "completed" ? "완료" : job.status === "failed" ? "실패 · 예약 반환" : "처리 중"}</span>
          {job.status === "completed" && <button disabled={busy} onClick={() => void run(async () => { const data = await jsonApi(`/api/account?job=${job.id}`); const events = data.result?.events ?? []; setResult({ id: job.id, imageUrl: data.imageUrl, text: events.filter((event: { type: string }) => event.type === "delta" || event.type === "chapter").map((event: { text?: string }) => event.text ?? "").join("") }); }, "저장된 결과를 열었습니다.")}>결과 보기</button>}
          <button disabled={busy} onClick={() => { const reason = window.prompt("AI 콘텐츠 신고 사유를 입력해주세요."); if (reason?.trim()) void run(() => jsonApi("/api/account", { action: "report", jobId: job.id, reason }), "신고를 접수했습니다."); }}>AI 콘텐츠 신고</button>
        </div>)}
        {result && <article><button onClick={() => setResult(undefined)}>결과 닫기</button>{result.imageUrl && <img src={result.imageUrl} alt="저장된 생성 이미지"/>}<p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p></article>}
        <button disabled={busy} onClick={() => void run(async () => { const { error } = await client.auth.signOut(); if (error) throw error; setAccount(undefined); }, "로그아웃했습니다.")}>로그아웃</button>
      </>}
      <p role="status">{busy ? "처리 중…" : notice}</p>
    </section></dialog>, document.body)}
  </>;
}
