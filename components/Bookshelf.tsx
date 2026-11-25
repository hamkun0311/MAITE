"use client";
import { formatStoryForReading } from "@/lib/novel/scene-headings";
import {useEffect,useState} from "react";
import Link from "next/link";
import {BookOpen,ChevronLeft,ChevronRight,Images,Library} from "lucide-react";
import {useAccount} from "./AccountProvider";
import {useStudioSession} from "./CharacterStudio";
import {libraryNovels} from "@/lib/account/library";
import {readChapter,saveChapter} from "@/lib/account/reading-progress";
import {jsonApi} from "@/lib/platform/commerce";
import {usePathname,useSearchParams} from "next/navigation";
import {useScreenLoading} from "./ScreenLoading";
import CachedImage from "./CachedImage";
import { CharacterImageViewer } from "./CharacterImage";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { novelIllustration, type IllustrationScene } from "@/lib/characters/gallery";
import { STORE_PRICE } from "@/lib/account/policy";
import { useActionConfirm } from "./ActionConfirm";

type Chapter={id:string;kind:string;title:string;chapter?:number;active?:boolean;novel?:{id:string;title:string;chapters:number}};
type NovelCatalog = { listings: Chapter[]; owned: string[] };
export function BookshelfScreen(){
 const {account,user}=useAccount();const {flushSave}=useStudioSession();
 const [owned,setOwned]=useState<Chapter[]>([]),[error,setError]=useState("");
 const [loading,setLoading]=useState(!!user);useScreenLoading(loading);
 useEffect(()=>{if(!user){setLoading(false);return;}let alive=true;setLoading(true);void flushSave().catch(()=>{});void jsonApi("/api/store").then(data=>{if(alive)setOwned(data.listings.filter((row:Chapter)=>row.kind==="chapter"&&data.owned.includes(row.id)));}).catch(()=>{if(alive)setError("구매한 소설을 불러오지 못했습니다.");}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[user?.id]);
 const groups=new Map<string,Chapter>();for(const row of owned)groups.set(row.novel?.id??row.id,row);
 const novels=libraryNovels(account?.documents??[]);
 return <main className="native-page bookshelf-page"><div className="native-page-title"><div><h1>서고</h1><p>마지막으로 읽던 이야기부터 이어보세요.</p></div><Library size={25}/></div><section className="native-session-list" aria-label="소유한 소설">
 {novels.map(novel=><Link key={novel.id} href={`/ideal/novels/${novel.id}`}><BookOpen size={26}/><div><h3>{novel.title}</h3><p>내가 만든 소설 · {novel.chapter}편</p></div><ChevronRight size={18}/></Link>)}
 {[...groups].map(([id,novel])=><Link key={`purchased-${id}`} href={`/ideal/library/${id}`}><BookOpen size={26}/><div><h3>{novel.novel?.title??novel.title}</h3><p>구매한 소설</p></div><ChevronRight size={18}/></Link>)}
 </section>{!loading&&!novels.length&&!groups.size&&<div className="native-empty"><BookOpen size={38}/><p>아직 소유한 소설이 없어요.</p></div>}{error&&<p role="status">{error}</p>}</main>;
}
type PurchasedImage = { id: string; jobId?: string; kind: "character" | "illustration"; scene?: IllustrationScene; title: string; url: string; thumbnailUrl?: string };
type PurchasedChapter = { content: { text: string }; images?: PurchasedImage[]; imageUrl?: string; thumbnailUrl?: string };

export function PurchasedNovelScreen() {
  const id = usePathname().split("/").at(-1)!;
  const requested = useSearchParams().get("listing");
  const { user, refresh } = useAccount();
  const confirm = useActionConfirm();
  const [catalog, setCatalog] = useState<NovelCatalog>({ listings: [], owned: [] });
  const [buying, setBuying] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState<{ id: string; data: PurchasedChapter }>();
  const [error, setError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [preview, setPreview] = useState<PurchasedImage>();
  useScreenLoading(listLoading || chapterLoading);

  useEffect(() => {
    let active = true;
    setListLoading(true); setCatalog({ listings: [], owned: [] }); setSelectedId(""); setLoaded(undefined); setError(""); setPurchaseError("");
    void jsonApi("/api/store?novel=" + id).then((data: NovelCatalog) => {
      if (!active) return;
      const listings = data.listings.filter(row => row.kind === "chapter" && (row.novel?.id ?? row.id) === id)
        .sort((a, b) => (a.chapter ?? 1) - (b.chapter ?? 1));
      const rows = listings.filter(row => data.owned.includes(row.id));
      if (!rows.length) throw new Error("구매한 회차가 없습니다.");
      const saved = readChapter(user?.id ?? "demo", "purchased:" + id);
      const first = rows.find(row => row.id === requested) ?? rows.find(row => row.chapter === saved) ?? rows[0];
      setCatalog({ listings, owned: data.owned }); setSelectedId(first.id); setChapterLoading(true);
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [id, requested, user?.id]);

  const chapters = catalog.listings.filter(row => catalog.owned.includes(row.id));
  const index = chapters.findIndex(row => row.id === selectedId);
  const row = chapters[index];
  const chapter = row?.chapter ?? 1;
  const next = row && catalog.listings.find(item => item.chapter === chapter + 1);
  const ownsNext = !!next && catalog.owned.includes(next.id);
  const price = STORE_PRICE.chapter;
  useEffect(() => {
    if (!selectedId) { setChapterLoading(false); return; }
    let active = true;
    setChapterLoading(true); setError(""); setGalleryOpen(false); setPreview(undefined);
    void jsonApi("/api/store?id=" + selectedId).then(data => {
      if (!active) return;
      if (typeof data.content?.text !== "string") throw new Error("Invalid chapter");
      setLoaded({ id: selectedId, data });
      saveChapter(user?.id ?? "demo", "purchased:" + id, chapter);
    }).catch(() => { if (active) setError("이 회차를 불러오지 못했습니다."); }).finally(() => { if (active) setChapterLoading(false); });
    return () => { active = false; };
  }, [selectedId, user?.id, id, chapter]);

  const data = loaded?.id === selectedId ? loaded.data : undefined;
  const original: PurchasedImage | undefined = data?.imageUrl
    ? { id: "novel-original-" + id, kind: "character", title: "기본 캐릭터 이미지", url: data.imageUrl, thumbnailUrl: data.thumbnailUrl }
    : undefined;
  const images = [...(original ? [original] : []), ...(data?.images ?? [])];
  const background = novelIllustration(images, row?.novel?.id, chapter) ?? original;

  async function openNext() {
    if (!next || buying || chapterLoading) return;
    setPurchaseError("");
    if (ownsNext) { setSelectedId(next.id); return; }
    if (!next.active) return;
    setBuying(true);
    try {
      if (!await confirm({
        title: "다음화를 구매할까요?",
        description: next.title,
        lines: [
          { label: "구매금액", value: `${price.price}하트` },
          { label: "구매 수수료", value: `+${price.buyerFee}하트` },
          { label: "총 사용 하트", value: `${price.total}하트` },
        ],
        confirmLabel: "구매하기",
      })) return;
      await jsonApi("/api/store", { action: "buy", id: crypto.randomUUID(), listingId: next.id });
      setCatalog(current => ({ ...current, owned: [...new Set([...current.owned, next.id])] }));
      setSelectedId(next.id);
      void refresh().catch(() => undefined);
    } catch (failure) {
      setPurchaseError(failure instanceof Error ? failure.message : "회차를 구매하지 못했습니다.");
    } finally {
      setBuying(false);
    }
  }

  return <main className="native-page account-page novel-detail-page purchased-novel-page">
    <div className="library-detail-toolbar">
      <Link className="native-back native-library-back" href="/ideal/library"><ChevronLeft size={18}/>서고</Link>
      {images.length > 0 && <button type="button" className="novel-sale-trigger" aria-expanded={galleryOpen} onClick={() => setGalleryOpen(open => !open)}><Images size={16} aria-hidden="true"/> 갤러리</button>}
    </div>
    <h1>{row?.novel?.title ?? row?.title ?? "구매한 소설"}</h1>
    {galleryOpen && <div className="purchased-illustrations" role="group" aria-label="소설 갤러리">{images.map((image, index) =>
      <button key={image.id} type="button" aria-label={image.kind === "character" ? "기본 캐릭터 이미지 전체화면" : "삽화 " + (index + 1 - Number(!!original)) + " 전체화면"} onClick={() => setPreview(image)}>
        <CachedImage src={image.thumbnailUrl ?? image.url} cacheKey={imageAssetKey(image, image.thumbnailUrl ? "thumbnail" : "original")} fallbackSrc={image.url} alt={image.title}/>
      </button>)}</div>}
    <div className="novel-reader-shell">
      <div className="story-page-navigation novel-side-navigation">
        <button type="button" aria-label="이전 이야기 보기" disabled={buying || index <= 0} onClick={() => setSelectedId(chapters[index - 1].id)}><ChevronLeft/></button>
        <button type="button" aria-label="다음 이야기 보기" disabled={buying || index < 0 || index >= chapters.length - 1} onClick={() => setSelectedId(chapters[index + 1].id)}><ChevronRight/></button>
      </div>
      <article className="novel-reader story-pages saved-novel-reader">
        {background && <CachedImage className="saved-novel-background" src={background.url} cacheKey={imageAssetKey(background)} alt=""/>}
        {data && <div key={selectedId} className="story-page novel-text-scroll" tabIndex={0} aria-label="소설 본문"><h3>이야기 #{chapter}</h3><p>{formatStoryForReading(data.content.text)}</p></div>}
      </article>
    </div>
    {data && next && (ownsNext || next.active) && <div className="purchased-reader-actions">
      {purchaseError && <p role="status">{purchaseError}</p>}
      <button type="button" className="native-primary" disabled={buying || chapterLoading} onClick={() => void openNext()}>
        {buying ? "구매 진행 중…" : ownsNext ? "다음화 보기" : `다음화 구매 · ${price.total}하트`}
        <ChevronRight size={17} aria-hidden="true"/>
      </button>
    </div>}
    {preview && <CharacterImageViewer src={preview.url} title={preview.title} cacheKey={imageAssetKey(preview)} open onClose={() => setPreview(undefined)}/>}
    {error && <p role="status">{error}</p>}
  </main>;
}
