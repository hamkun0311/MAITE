"use client";
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import {useCheckinInbox} from "./CheckinInbox";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "./AccountProvider";
import { useStudioSession } from "./CharacterStudio";
import { jsonApi, invalidateApiReads } from "@/lib/platform/commerce";
import { accountEnabled } from "@/lib/account/client";
import { libraryNovels, novelChapters, novelComplete } from "@/lib/account/library";
import { snapshotSchema, type StudioSnapshot } from "@/lib/platform/snapshot";
import { STORE_PRICE } from "@/lib/account/policy";
import { UserRound, Heart, ChevronLeft, ChevronRight, MessageCircle, BookOpen, LogOut, Pencil, Trash2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionConfirm } from "./ActionConfirm";
import NotificationSettings from "./NotificationSettings";
import CachedImage from "./CachedImage";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { novelIllustration } from "@/lib/characters/gallery";
import { readChapter, saveChapter } from "@/lib/account/reading-progress";
import {useScreenLoading} from "./ScreenLoading";

const errorText = (error: unknown) => error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
function DemoNotice() { return <p className="library-notice">로그인·저장 기능을 사용하려면 계정 모드를 설정해주세요.</p>; }

export function MyPageScreen() {
  const { user, account, refresh, logout, editProfile } = useAccount(); const { flushSave } = useStudioSession();
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  useScreenLoading(busy);
  useEffect(() => { if (user) void flushSave().catch(error => setNotice(errorText(error))); }, []);
  async function run(work: () => Promise<unknown>) { if (busy) return; setBusy(true); setNotice(""); try { await work(); } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); } }
  return <main className="native-page account-page"><div className="native-page-title"><h1>마이페이지</h1></div><section className="native-profile-card"><div className="native-avatar large">{account?.avatarUrl ? <CachedImage src={account.avatarUrl} cacheKey={`profile:${account.avatarUrl.split("?")[0]}`} alt=""/> : <UserRound size={36}/>}</div><h2>{account?.profile?.display_name || "당신"}</h2><p>{account?.email ?? user?.email ?? "나만의 이야기를 만들어보세요"}</p><button className="native-outline" disabled={!account} onClick={editProfile}><Pencil size={14}/>프로필 수정</button></section>
    <Link className="native-reward-entry" href="/ideal/rewards">출석보상 <ChevronRight size={18}/></Link>
    <section className="native-wallet"><span>보유 하트</span><strong className="heart-total"><Heart size={28} fill="currentColor"/>{account ? (account.wallet.transferable + account.wallet.bonus).toLocaleString() : "0"}</strong><small>구매·판매 {account?.wallet.transferable ?? 0} · 보상 {account?.wallet.bonus ?? 0}</small><Link href="/ideal/store">하트 충전 <ChevronRight size={16}/></Link></section>
    <section className="native-settings-list"><h2>내 계정정보</h2><dl><div><dt>닉네임</dt><dd>{account?.profile?.display_name || "당신"}</dd></div><div><dt>성별</dt><dd>{account?.profile?.gender || "선택 안 함"}</dd></div><div><dt>무료 대화</dt><dd>{account?.wallet.free_chats ?? 0}회</dd></div></dl><p>대화와 소설은 캐릭터를 선택하면 볼 수 있어요.</p></section>
    <NotificationSettings/>
    {!accountEnabled() && <DemoNotice/>}<div className="native-account-actions"><button disabled={busy || !account} onClick={() => void run(refresh)}>계정 새로고침</button><button disabled={busy || !account} onClick={() => void run(logout)}><LogOut size={16}/>로그아웃</button></div>{notice && <p role="alert">{notice}</p>}</main>;
}

export function LibraryDetailScreen({ kind }: { kind: "character" | "novel" }) {
  const unread=useCheckinInbox();
  const path = usePathname(); const id = path.split("/").at(-1)!;
  const { loadDocument, deleteCharacter } = useStudioSession(); const { refresh, account, user } = useAccount(); const router = useRouter(); const confirm = useActionConfirm();
  const [saleOpen, setSaleOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "novel">("chat");
  const [snapshot, setSnapshot] = useState<StudioSnapshot>(); const [image, setImage] = useState("");
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [selected, setSelected] = useState(1); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [loading,setLoading]=useState(accountEnabled);
  useScreenLoading(loading);
  useEffect(() => {
    let active = true; setSnapshot(undefined); setSaleOpen(false); setImage(""); setNotice(""); setSelected(kind === "novel" ? readChapter(user?.id ?? "demo", id) : 1);
    if (!accountEnabled()) return;
    setLoading(true);
    void (async () => {
      const doc = await jsonApi(`/api/account?document=${id}${kind === "character" ? "&media=1" : ""}`); const parsed = snapshotSchema.safeParse(doc.payload);
      if (!parsed.success) throw new Error("저장된 작품을 열 수 없습니다. 캐릭터 목록에서 다시 선택해주세요.");
      const saved = parsed.data;
      if (!active) return;
      const available = novelChapters(saved);
      if (kind === "novel" && available.length) { const stored=readChapter(user?.id ?? "demo",id); setSelected(available.some(chapter=>chapter.chapter===stored)?stored:1); }
      setSnapshot(saved); setTitle((kind === "character" ? saved.art.profile.name : doc.title).slice(0, 100)); setDescription(saved.art.summary);
      if (kind === "character") {
        const art = doc.media?.original ? { imageUrl: doc.media.original } : await jsonApi(saved.art.jobId ? `/api/account?job=${saved.art.jobId}` : `/api/store?id=${saved.art.listingId}`);
        if (active) setImage(art.imageUrl ?? "");
      }
    })().catch(error => { if (active) setNotice(errorText(error)); }).finally(()=>{if(active)setLoading(false);});
    return () => { active = false; };
  }, [id, kind, user?.id]);
  async function run(work: () => Promise<unknown>, success: string) { if (busy) return; setBusy(true); setNotice(""); try { await work(); setNotice(success); return true; } catch (error) { setNotice(errorText(error)); return false; } finally { setBusy(false); } }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (busy || !canPublish || !title.trim()) return;
    if (kind === "character" && !await confirm({ title: "캐릭터를 서점에 등록할까요?", description: title.trim(), lines: [{ label: "판매금액", value: `${price.price}하트` }, { label: "판매 수수료", value: `-${price.sellerFee}하트` }, { label: "판매 후 수령", value: `${price.proceeds}하트` }], confirmLabel: "판매 등록" })) return;
    const success = await run(async () => { await jsonApi("/api/store", { action: kind === "novel" ? "publishNovel" : "publishCharacter", documentId: id, title: title.trim(), description: description.trim() }); await refresh(); }, "서점에 판매 등록했습니다.");
    if (success) setSaleOpen(false);
  }
  const chapters = snapshot ? novelChapters(snapshot) : [];
  const complete = !!snapshot && novelComplete(snapshot);
  const canPublish = kind === "character" ? !!snapshot?.art.jobId : chapters.length > 0;
  const price = STORE_PRICE[kind === "character" ? "character" : "chapter"];
  const novels = libraryNovels(account?.documents ?? []).filter(doc => doc.source_id === snapshot?.id || (!!snapshot?.story.documentId && (doc.id === snapshot.story.documentId || doc.novel_id === snapshot.story.documentId)));
  return <main className={`account-page native-page${kind === "novel" ? " novel-detail-page" : ""}`}><div className="library-detail-toolbar"><Link className="native-back native-library-back" href={kind === "novel" ? "/ideal/library" : "/ideal/characters"}><ChevronLeft size={18} aria-hidden="true" /><span>{kind === "novel" ? "서고" : "나의 캐릭터"}</span></Link>{kind === "novel" && <button type="button" className="novel-sale-trigger" aria-label="서점에 판매 등록" disabled={busy || !canPublish} onClick={() => setSaleOpen(true)}>판매 등록</button>}</div>
    {!accountEnabled() ? <DemoNotice/> : !snapshot ? notice&&<p role="alert">{notice}</p> : <>
      {kind === "character" ? <><section className="account-panel character-detail">{image && <CachedImage src={image} cacheKey={imageAssetKey(snapshot.art)} alt={snapshot.art.profile.name}/>}<div><div className="character-name-row"><h2>{snapshot.art.profile.name}</h2>{unread[id]>0&&<small className="checkin-arrival-badge">안부 도착</small>}</div><p>{snapshot.art.profile.age}세 · {snapshot.art.profile.gender}</p><p>{snapshot.art.profile.personality}</p><p>{snapshot.art.profile.concept}</p></div></section>
      <div className="native-tabs" role="tablist" aria-label="캐릭터의 이야기"><button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>대화</button><button role="tab" aria-selected={tab === "novel"} onClick={() => setTab("novel")}>소설</button></div>
      {tab === "chat" ? <section className="native-session-list" role="tabpanel" aria-label="대화 목록"><button disabled={busy} onClick={() => void run(async () => { await loadDocument(id); router.push("/ideal/chat"); }, "대화를 열었습니다.")}><MessageCircle size={26}/><div><h3>{snapshot.art.profile.name}와의 대화</h3><p>{snapshot.chat.archive?.filter(message => message.role === "assistant").at(-1)?.content.slice(0, 70) || "첫마디로 둘만의 이야기를 시작해보세요."}</p></div><ChevronRight size={18}/></button></section>
      : <section className="native-session-list" role="tabpanel" aria-label="소설 목록">{novels.map(doc => <Link href={`/ideal/novels/${doc.id}`} key={doc.id}><BookOpen size={28}/><div><h3>{doc.title}</h3><p>{doc.chapter}편 · {doc.next_goal === "" ? "완결" : "연재 중"}</p></div><ChevronRight size={18}/></Link>)}<button disabled={busy} onClick={() => void run(async () => { await loadDocument(id); router.push("/ideal/story"); }, "이야기를 열었습니다.")}><BookOpen size={24}/><div><h3>{snapshot.story.storyState?.chapter ? "이야기 이어 쓰기" : "새 이야기 시작하기"}</h3><p>다음 이야기의 컨셉을 추가할 수 있어요.</p></div><ChevronRight size={18}/></button></section>}</>
      : <section className="account-panel novel-reading-panel"><h2>{title || "나의 소설"}</h2><p>{snapshot.art.profile.name}의 이야기 · {snapshot.story.storyState?.chapter ?? 0}편 · {complete ? "완결" : "연재 중"}</p>
        {chapters.length > 0 && <SavedNovelPages chapters={chapters} selected={selected} onSelect={chapter => { setSelected(chapter); saveChapter(user?.id ?? "demo",id,chapter); }} snapshot={snapshot} />}
        {!chapters.length && <p>이야기를 한 회차 이상 생성하고 저장하면 판매할 수 있어요.</p>}
      </section>}
      {kind === "novel" ? saleOpen && <NovelSaleDialog busy={busy} onClose={() => setSaleOpen(false)}>
        <h2 id="novel-sale-title">소설 판매 등록</h2><p>작품 제목과 소개를 정해 생성된 회차를 서점에 등록해요. 연재 중인 소설도 판매할 수 있어요.</p>
        <dl className="novel-sale-prices"><div><dt>회차별 판매금액</dt><dd>{price.price}하트</dd></div><div><dt>판매 수수료</dt><dd>−{price.sellerFee}하트</dd></div><div><dt>판매 후 수령</dt><dd>{price.proceeds}하트 / 회차</dd></div></dl>
        <form className="publish-form" onSubmit={event => void publish(event)}><label>{kind === "novel" ? "소설 제목" : "판매 제목"}<input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} disabled={busy}/></label><label>작품 소개<textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} disabled={busy}/></label><button disabled={busy || !canPublish || !title.trim()}>{busy ? "등록 중…" : kind === "novel" ? "판매 등록하기" : "서점에 판매 등록"}</button></form>
        {notice && <p role="status">{notice}</p>}
      </NovelSaleDialog> : <section className="account-panel"><h2>캐릭터 판매 등록</h2>{!canPublish && <p>직접 생성한 캐릭터만 판매할 수 있습니다.</p>}
        <form className="publish-form" onSubmit={event => void publish(event)}><label>판매 제목<input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} disabled={busy}/></label><label>작품 소개<textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} disabled={busy}/></label><button disabled={busy || !canPublish || !title.trim()}>{busy ? "등록 중…" : "서점에 판매 등록"}</button></form>
      </section>}
      {kind === "character" && <button className="native-delete-character" disabled={busy} onClick={() => void (async () => {
        if (!await confirm({ title: "캐릭터를 삭제할까요?", description: "내 보관함의 캐릭터와 연결된 대화·소설이 삭제되고, 해당 작품의 판매가 중지됩니다. 기존 구매자의 작품과 결제·생성 작업 내역은 보존됩니다.", confirmLabel: "캐릭터 삭제", danger: true })) return;
        await run(() => deleteCharacter(id), "캐릭터를 삭제했습니다.");
      })()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Trash2 size={16}/>}캐릭터 삭제</button>}
    </>}{snapshot && notice && !saleOpen && <p role="status">{notice}</p>}</main>;
}

function NovelSaleDialog({children,busy,onClose}:{children:ReactNode;busy:boolean;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";element?.showModal();return()=>{element?.close();document.body.style.overflow=overflow;};},[]);
 return <dialog ref={dialog} className="novel-sale-dialog" aria-labelledby="novel-sale-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClose={event=>{if(!event.currentTarget.open&&!busy)onClose();}}><button type="button" className="sheet-close" aria-label="판매 등록 닫기" disabled={busy} onClick={onClose}><X size={20}/></button>{children}</dialog>;
}

function SavedNovelPages({ chapters, selected, onSelect, snapshot }: { chapters: { chapter: number; text: string }[]; selected: number; onSelect: (chapter: number) => void; snapshot: StudioSnapshot }) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [background, setBackground] = useState<{ key: string; url: string }>();
  const illustration = novelIllustration(snapshot.gallery, snapshot.story.documentId, selected, snapshot.backgrounds.story);
  const backgroundAsset = illustration ?? snapshot.art;
  const backgroundJob = backgroundAsset.jobId;
  const backgroundListing = "listingId" in backgroundAsset ? backgroundAsset.listingId : undefined;
  const backgroundKey = imageAssetKey(backgroundAsset);
  useEffect(() => {
    let active = true;
    const endpoint = backgroundJob ? `/api/account?job=${backgroundJob}` : backgroundListing ? `/api/store?id=${backgroundListing}` : undefined;
    if (endpoint) void jsonApi(endpoint).then(data => { if (active && data.imageUrl) setBackground({ key: backgroundKey, url: data.imageUrl }); }).catch(() => { /* The manuscript stays readable if an image cannot be loaded. */ });
    return () => { active = false; };
  }, [backgroundJob, backgroundListing, backgroundKey]);
  const index = Math.max(0, chapters.findIndex(chapter => chapter.chapter === selected));
  const move = (delta: number) => onSelect(chapters[Math.max(0, Math.min(chapters.length - 1, index + delta))].chapter);
  return <div className="novel-reader-shell">
    <div className="story-page-navigation novel-side-navigation" role="group" aria-label="이야기 페이지 이동">
      <button type="button" aria-label="이전 이야기 보기" disabled={index === 0} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" aria-label="다음 이야기 보기" disabled={index === chapters.length - 1} onClick={() => move(1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <article className="novel-reader story-pages saved-novel-reader" tabIndex={0}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); } }}
      onTouchStart={event => setStart(event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null)}
      onTouchCancel={() => setStart(null)}
      onTouchEnd={event => {
        setStart(null); if (!start || !event.changedTouches.length || event.touches.length) return;
        const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
      }}>{background?.key === backgroundKey && <CachedImage className="saved-novel-background" src={background.url} cacheKey={backgroundKey} alt=""/>}<div key={selected} className="story-page novel-text-scroll" tabIndex={0} aria-label="소설 본문"><h3>이야기 #{chapters[index].chapter}</h3><p>{chapters[index].text}</p></div></article>
  </div>;
}

type Listing = { id: string; seller_id: string; kind: "character" | "chapter"; title: string; description: string; active: boolean; thumbnailUrl?: string; chapter?: number; novel?: { id: string; title: string; chapters: number } };
export function StoreScreen() {
  const { user, refresh } = useAccount(); const { importCharacter } = useStudioSession();
  const confirm = useActionConfirm(); const [filter, setFilter] = useState<"character" | "chapter">("character");
  const [data, setData] = useState<{ listings: Listing[]; owned: string[] }>(); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<{ title: string; text: string }>();
  const [loading,setLoading]=useState(accountEnabled);
  const [opening,setOpening]=useState(false);
  useScreenLoading(loading||opening);
  const load = async (fresh = false) => { setLoading(true);try{if (fresh) invalidateApiReads(); setData(await jsonApi("/api/store"));}finally{setLoading(false);} };
  async function openContent(id:string){setOpening(true);try{const result=await jsonApi(`/api/store?id=${id}`);if(result.kind==="character")await importCharacter(result);else setReading({title:result.title,text:result.content.text});}finally{setOpening(false);}}
  useEffect(() => { if (accountEnabled()) void load().catch(error => setNotice(errorText(error))); }, []);
  async function run(work: () => Promise<unknown>, success: string) { if (busy) return; setBusy(true); setNotice(""); try { await work(); await refresh(); setNotice(success); } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); } }
  function listingCard(listing: Listing) {
    const price = STORE_PRICE[listing.kind]; const own = listing.seller_id === user?.id; const purchased = data?.owned.includes(listing.id);
    return <article className="store-listing" key={listing.id}>{listing.kind === "character" && <div className="store-cover">{listing.thumbnailUrl ? <CachedImage src={listing.thumbnailUrl} cacheKey={`listing-preview:${listing.id}:thumbnail`} loading="lazy" alt={`${listing.title} 캐릭터 이미지`}/> : <UserRound size={28} aria-hidden="true"/>}</div>}<h3>{listing.title}</h3><p>{listing.description}</p>
      {own ? <><span>{listing.active ? "판매 중" : "판매 중지"}</span><button disabled={busy || !listing.active} onClick={() => void run(async () => { await jsonApi("/api/store", { action: "unpublish", listingId: listing.id }); await load(); }, "판매를 중지했습니다.")}>판매 중지</button></>
        : purchased ? <button disabled={busy} onClick={() => void run(() => openContent(listing.id), "구매한 콘텐츠를 열었습니다.")}>{listing.kind === "character" ? "내 캐릭터로 사용" : "회차 읽기"}</button>
        : <button disabled={busy || !listing.active} onClick={() => void (async () => { if (!await confirm({ title: "이 작품을 구매할까요?", description: listing.title, lines: [{ label: "구매금액", value: `${price.price}하트` }, { label: "구매 수수료", value: `+${price.buyerFee}하트` }, { label: "총 사용 하트", value: `${price.total}하트` }], confirmLabel: "구매하기" })) return; await run(async () => { await jsonApi("/api/store", { action: "buy", id: crypto.randomUUID(), listingId: listing.id }); await load(); }, "구매했습니다."); })()}>총 {price.total}하트로 구매</button>}
    </article>;
  }
  const groups = new Map<string, Listing[]>();
  for (const listing of data?.listings.filter(item => item.kind === "chapter") ?? []) { const id = listing.novel?.id ?? listing.id; groups.set(id, [...(groups.get(id) ?? []), listing]); }
  return <main className="account-page native-page"><div className="native-page-title"><div><h1>서점</h1><p>새로운 인연, 또 다른 이야기</p></div>{accountEnabled() ? <button type="button" className="native-title-icon" aria-label="서점 새로고침" title="서점 새로고침" disabled={busy} onClick={() => void run(() => load(true), "서점을 새로고침했습니다.")}><RefreshCw size={21} aria-hidden="true"/></button> : <BookOpen size={26}/>}</div><div className="native-tabs" role="tablist" aria-label="서점 분류"><button role="tab" aria-selected={filter === "character"} onClick={() => setFilter("character")}>캐릭터</button><button role="tab" aria-selected={filter === "chapter"} onClick={() => setFilter("chapter")}>소설</button></div>{!accountEnabled() ? <DemoNotice/> : <>
    {filter === "character" ? <section className="account-panel">{data?.listings.filter(item => item.kind === "character").map(listingCard)}{data && !data.listings.some(item => item.kind === "character") && <div className="native-empty"><UserRound size={38}/><p>새로운 캐릭터를 기다리고 있어요.</p></div>}</section>
    : <section className="account-panel">{[...groups].map(([id, chapters]) => <details className="store-novel" key={id}><summary><span className="store-cover">{chapters.find(chapter=>chapter.thumbnailUrl)?.thumbnailUrl ? <CachedImage src={chapters.find(chapter=>chapter.thumbnailUrl)!.thumbnailUrl!} cacheKey={`listing-preview:${chapters.find(chapter=>chapter.thumbnailUrl)!.id}:thumbnail`} loading="lazy" alt={`${chapters[0].novel?.title ?? chapters[0].title} 메인 캐릭터 이미지`}/> : <BookOpen size={28} aria-hidden="true"/>}</span><span>{chapters[0].novel?.title ?? chapters[0].title} · {chapters[0].novel?.chapters ?? chapters.length}편</span></summary>{chapters.sort((a,b) => (a.chapter ?? 0) - (b.chapter ?? 0)).map(listingCard)}</details>)}{data && !groups.size && <div className="native-empty"><BookOpen size={38}/><p>첫 번째 이야기를 기다리고 있어요.</p></div>}</section>}
    {reading && <section className="account-panel novel-reader"><button onClick={() => setReading(undefined)}>읽기 닫기</button><h2>{reading.title}</h2><p>{reading.text}</p></section>}
  </>}{notice && <p role="status">{notice}</p>}</main>;
}
