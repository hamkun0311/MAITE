"use client";
import CheckinInbox from "./CheckinInbox";
import {useScreenLoading} from "./ScreenLoading";
import PushBridge from "./PushBridge";
import TokenUsage from "./TokenUsage";
import CachedImage from "./CachedImage";
import { NO_BACKGROUND } from "@/lib/characters/gallery";
import AccountMenu from "./AccountMenu";
import AppFooter from "./AppFooter";
import { useActionConfirm, useGenerationPolicyNotice } from "./ActionConfirm";
import GenerationFeedback from "./GenerationFeedback";
import HeartText from "./HeartText";
import { blocksImageGeneration, GENERATION_POLICY_MESSAGE } from "@/lib/generation-policy";
import { HEART_COST } from "@/lib/account/policy";
import { useAccount } from "./AccountProvider";
import { jsonApi } from "@/lib/platform/commerce";
import { apiFetch } from "@/lib/platform/api";
import { trackAnalyticsEvent } from "@/lib/platform/analytics";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { loadAccountImage } from "@/lib/platform/image-loader";
import { accountEnabled } from "@/lib/account/client";
import { isNative, saveFile } from "@/lib/platform/native";
import { localSnapshot, snapshotSchema, sessionSnapshot, restoreSessions, type StudioSnapshot } from "@/lib/platform/snapshot";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CharacterImage, { CharacterImageViewer } from "./CharacterImage";
import CharacterGallery from "./CharacterGallery";
import useCharacterGallery from "./useCharacterGallery";
import { createStudioSessions, type ChatSession } from "@/lib/chat/session";
import {
  ArrowDownToLine,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  BookOpen,
  Sparkles,
  X,
} from "lucide-react";
import { usageImageFetch } from "@/lib/usage-store";
import { beginImageAttempt, forgetImageAttempt, hasImageAttempt } from "@/lib/platform/image-attempt";
import CharacterExperience from "./CharacterExperience";
import { CHARACTER_GENDERS, characterProfileSchema, type CharacterProfile } from "@/lib/chat/character";
import {
  MAX_CHARACTER_IMAGE,
  characterStyleProfile,
} from "@/lib/characters/schema";
import { characterRenderStyle, characterStyleHeader, newCharacterRenderStyles, renderStyleLabels, selectableRenderStyle, type CharacterRenderStyle } from "@/lib/characters/render-style";

type Message = { role: "user" | "assistant"; content: string };
type StyleProfile = (typeof characterStyleProfile.options)[number];
type Artwork = { url: string; title: string; summary: string; prompt: string; style: StyleProfile; renderStyle?: CharacterRenderStyle; description: string; profile: CharacterProfile; width: number; height: number; jobId?: string; listingId?: string };
type StudioSession = {
  creation: ReactNode;
  activityRestoring: boolean;
  activityRestoreError: string;
  art?: Artwork;
  characterDocumentId: string;
  sessions: Record<"chat" | "story", ChatSession>;
  openMenu: (mode: "image" | "chat" | "story") => void;
  startNewCharacter: () => void;
  editProfile: () => void;
  visuals: ReturnType<typeof useCharacterGallery>;
  loadDocument: (id: string) => Promise<void>;
  importCharacter: (value: Record<string, unknown>) => Promise<void>;
  flushSave: () => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  rewindToken?: string;
  rewindStory: (chapter: number) => Promise<void>;
};
const StudioContext = createContext<StudioSession | null>(null);
export function useStudioSession() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Character studio layout is required");
  return value;
}
export function CharacterCreationScreen() {
  return useStudioSession().creation;
}
export function CharacterGalleryScreen() {
  const { visuals } = useStudioSession();
  const router = useRouter();
  const [from, setFrom] = useState<"chat" | "story">();
  useEffect(() => { const value = new URLSearchParams(location.search).get("from"); if (value === "chat" || value === "story") setFrom(value); }, []);
  return <CharacterGallery images={from ? visuals.images : visuals.archive} mode={from} onOriginalLoaded={visuals.originalLoaded} onApply={from ? id => { visuals.selectBackground(from, id); router.push(`/ideal/${from}`); } : undefined} />;
}
export function CharacterActivityScreen({ mode }: { mode: "chat" | "story" }) {
  const { art, activityRestoring, activityRestoreError } = useStudioSession();
  useScreenLoading(activityRestoring);
  if (art) return null; // The layout owns the mounted activity so navigation keeps generation alive.
  if(activityRestoring)return <main className="character-missing" aria-busy="true"/>;
  if(activityRestoreError)return <main className="character-missing"><p role="alert">{activityRestoreError}</p><Link href="/ideal/characters">나의 캐릭터에서 다시 선택</Link></main>;
  return <main className="character-missing"><h1>캐릭터를 먼저 만들어주세요.</h1><p>생성한 캐릭터로 대화와 이야기를 시작할 수 있습니다.</p><Link href="/ideal">캐릭터 생성으로 이동</Link></main>;
}
function PersistentCharacterActivity({ mode, active }: { mode: "chat" | "story"; active: boolean }) {
  const { art, sessions, editProfile, openMenu, visuals, characterDocumentId, rewindToken, rewindStory } = useStudioSession();
  if (!art) return <main className="character-missing"><h1>캐릭터를 먼저 만들어주세요.</h1><p>생성한 캐릭터로 대화와 이야기를 시작할 수 있습니다.</p><Link href="/ideal">캐릭터 생성으로 이동</Link></main>;
  const background = visuals.images.find(image => image.id === visuals.backgrounds[mode]);
  return <main className="character-screen" hidden={!active}><CharacterExperience key={`${mode}-${art.url}-${rewindToken ?? "initial"}`} rewindToken={rewindToken} onRewindStory={mode === "story" ? rewindStory : undefined} mode={mode} characterDocumentId={characterDocumentId} imageUrl={background?.url || art.url} backgroundHidden={visuals.backgrounds[mode] === NO_BACKGROUND} imageDescription={art.description} avatarUrl={art.url} profile={art.profile} session={sessions[mode]} gallery={visuals.images} backgroundId={visuals.backgrounds[mode]} onBackground={id => visuals.selectBackground(mode, id)} onGenerateVisual={(kind, context, scene, selection) => visuals.generate(mode, kind, context, scene, selection)} imageJob={visuals.job} imageError={visuals.error} onCancelImage={visuals.cancel} onDismissImageError={visuals.dismissError} active={active} onEdit={editProfile} onBack={() => openMenu("image")} /></main>;
}
export default function CharacterStudio({ children }: { children: ReactNode }) {
  const { user, account } = useAccount();
  const confirm = useActionConfirm();
  const showPolicyNotice = useGenerationPolicyNotice();
  const router = useRouter();
  const pathname = usePathname();
  const currentPath=useRef(pathname);currentPath.current=pathname;
  const restoreAttempt=useRef("");
  const [activityRestore,setActivityRestore]=useState<{path:string;loading:boolean;error:string}>();
  const [documentLoad,setDocumentLoad]=useState<{path:string;loading:boolean}>();
  useScreenLoading(!!documentLoad?.loading&&documentLoad.path===pathname);
  const sessions = useRef(createStudioSessions());
  const documentId = useRef<string>(crypto.randomUUID());
  const [rewindToken, setRewindToken] = useState<string>();
  const suppressedDocuments = useRef(new Set<string>());
  const lastSaved = useRef(new Map<string, string>());
  const pendingSnapshots = useRef(new Map<string, { snapshot: StudioSnapshot; owner: string }>());
  const loadSequence = useRef(0);
  const owner = useRef("anonymous");
  const pendingFocus = useRef<"result" | "profile" | null>(null);
  const app = useRef<HTMLDivElement>(null);
  const menu = pathname === "/ideal/chat" ? "chat" : pathname === "/ideal/story" ? "story" : pathname === "/ideal/gallery" ? "gallery" : "image";
  useEffect(() => {
    if (menu !== "chat" && menu !== "story") return;
    const element = app.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const native = isNative();
    let height = window.innerHeight, width = window.innerWidth, frame = 0;
    let composer: HTMLElement | null = null, composerShift = 0;
    const resize = () => {
      const visualHeight = viewport?.height ?? window.innerHeight;
      const visualBottom = visualHeight + (viewport?.offsetTop ?? 0);
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && element.contains(focused) &&
        focused.matches(".chat-composer textarea, .story-concept-input input");
      if (width !== window.innerWidth) { width = window.innerWidth; height = window.innerHeight; }
      const keyboardThreshold = native ? 1 : 80;
      const canShowKeyboard = native || navigator.maxTouchPoints > 0 || window.innerHeight - visualHeight > keyboardThreshold;
      const keyboard = canShowKeyboard && (viewport?.scale ?? 1) === 1 &&
        (editing || element.dataset.keyboardOpen === "true") && height - visualHeight > keyboardThreshold;
      if (!keyboard) height = window.innerHeight;
      const nextComposer = element.querySelector<HTMLElement>(".live-chat > :is(.chat-composer, .story-composer)");
      if (nextComposer !== composer || !keyboard) {
        composer = nextComposer;
        composerShift = 0;
        element.style.removeProperty("--reader-composer-shift");
      }
      element.dataset.keyboardOpen = String(keyboard);
      element.style.setProperty("--character-viewport-height", `${height}px`);
      // Footer padding and controls below the input vary by screen and composer.
      if (keyboard && composer) {
        composerShift += visualBottom - composer.getBoundingClientRect().bottom;
        element.style.setProperty("--reader-composer-shift", `${composerShift}px`);
      }
    };
    const scheduleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    resize();
    viewport?.addEventListener("resize", scheduleResize);
    viewport?.addEventListener("scroll", scheduleResize);
    window.addEventListener("resize", scheduleResize);
    element.addEventListener("focusin", scheduleResize);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", scheduleResize);
      viewport?.removeEventListener("scroll", scheduleResize);
      window.removeEventListener("resize", scheduleResize);
      element.removeEventListener("focusin", scheduleResize);
      delete element.dataset.keyboardOpen;
      element.style.removeProperty("--character-viewport-height");
      element.style.removeProperty("--reader-composer-shift");
    };
  }, [menu]);
  const result = useRef<HTMLElement>(null);
  const resultHeadingId = useId();
  const [confirmingCharacter, setConfirmingCharacter] = useState(false);
  const profileFields = useRef<HTMLFieldSetElement>(null);
  const [draft, setDraft] = useState({ name: "", age: "", gender: "", appearance: "", personality: "", funElement: "", concept: "" });
  const [selectedRenderStyle, setSelectedRenderStyle] = useState("");
  function focusCreation(target: "result" | "profile") {
    requestAnimationFrame(() => {
      if (target === "profile") {
        profileFields.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        profileFields.current?.querySelector("input")?.focus({ preventScroll: true });
      } else {
        result.current?.focus({ preventScroll: true });
        result.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
  function openMenu(next: "image" | "chat" | "story") {
    if (next === "image") pendingFocus.current = "result";
    router.push(next === "image" ? (accountEnabled() ? "/ideal/new" : "/ideal") : `/ideal/${next}`, { scroll: false });
    if (next === "image" && menu === "image") focusCreation("result");
    else if (next !== "image") window.scrollTo({ top: 0, behavior: "instant" });
  }
  function editProfile() {
    pendingFocus.current = "profile";
    if (menu === "image") focusCreation("profile");
    else router.push(accountEnabled() ? "/ideal/new" : "/ideal", { scroll: false });
  }
  useEffect(() => {
    if (menu !== "image") return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target) focusCreation(target);
  }, [pathname]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [art, setArt] = useState<Artwork>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [createdPreview, setCreatedPreview] = useState<{url:string;title:string}>();
  useEffect(() => { if (!art || createdPreview?.url !== art.url) setCreatedPreview(undefined); }, [art?.url]);
  const [visitedActivities, setVisitedActivities] = useState<{ art: string; modes: string[] }>({ art: "", modes: [] });
  useEffect(() => {
    if (!art || (menu !== "chat" && menu !== "story")) return;
    setVisitedActivities(previous => previous.art === art.url && previous.modes.includes(menu) ? previous : { art: art.url, modes: [...(previous.art === art.url ? previous.modes : []), menu] });
  }, [art?.url, menu]);
  const [status, setStatus] = useState("캐릭터 특성과 컨셉을 입력하고 생성해주세요.");
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    previous = useRef<Blob | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const pending = useRef<{ messages: Message[] } | null>(null);
  const visuals = useCharacterGallery(art && previous.current ? { blob: previous.current, profile: art.profile, renderStyle: art.renderStyle, documentId: documentId.current } : undefined);
  function currentSnapshot(): StudioSnapshot {
    if (!art || !previous.current) throw new Error("캐릭터를 먼저 선택해주세요.");
    if (sessions.current.story.storyState?.chapter) sessions.current.story.documentId ??= crypto.randomUUID();
    const { url: _url, ...savedArt } = art;
    return snapshotSchema.parse({ version: 1, id: documentId.current, rewindToken, art: savedArt, chat: sessionSnapshot(sessions.current.chat), story: sessionSnapshot(sessions.current.story), timeline: sessions.current.chat.timeline.state, gallery: visuals.images.map(({ url: _url, blob: _blob, ...image }) => image), backgrounds: visuals.backgrounds });
  }
  function restore(data: StudioSnapshot, blob: Blob, gallery: { id: string; blob: Blob }[] = [], navigate=true) {
    cancel(); visuals.clear(); documentId.current = data.id;
    setRewindToken(data.rewindToken);
    sessions.current = restoreSessions(data); previous.current = blob;
    const url = URL.createObjectURL(blob); visuals.registerOriginal(blob, url, data.art.title, data.art);
    const metadataRows = gallery.length === data.gallery.length ? data.gallery : data.gallery.filter(image => image.id !== "original");
    visuals.restoreImages(gallery.flatMap((image, index) => { const metadata = data.gallery.find(meta => meta.id === image.id) ?? metadataRows[index]; return metadata ? [{ ...metadata, blob: image.blob }] : []; }), data.backgrounds);
    setDraft({ ...data.art.profile, age: String(data.art.profile.age), gender: data.art.profile.gender ?? "", appearance: data.art.profile.appearance ?? "", funElement: data.art.profile.funElement ?? "" });
    setSelectedRenderStyle(selectableRenderStyle.safeParse(data.art.renderStyle).data ?? "");
    setArt({ ...data.art, url }); setMessages([]); if(navigate)router.push(accountEnabled() ? "/ideal/new" : "/ideal");
  }
  async function persistSnapshot(snapshot: StudioSnapshot, currentOwner: string) {
    if (owner.current !== currentOwner || suppressedDocuments.current.has(snapshot.id)) return;
    const fingerprint = JSON.stringify(snapshot);
    const key = `${currentOwner}:${snapshot.id}`;
    let changed = false;
    if (lastSaved.current.get(key) !== fingerprint) {
      await jsonApi("/api/account", { action: "save", id: snapshot.id, ownerId: currentOwner, title: snapshot.art.title, kind: "studio", payload: snapshot });
      lastSaved.current.set(key, fingerprint); changed = true;
    }
    if (snapshot.story.documentId && snapshot.story.storyState?.chapter) {
      const chapterKey = `${currentOwner}:${snapshot.story.documentId}`;
      if (lastSaved.current.get(chapterKey) !== fingerprint) {
        await jsonApi("/api/account", { action: "save", id: snapshot.story.documentId, ownerId: currentOwner, title: `${snapshot.art.title.slice(0, 100)}의 이야기`, kind: "chapter", payload: snapshot });
        lastSaved.current.set(chapterKey, fingerprint); changed = true;
      }
    }
    if (changed) window.dispatchEvent(new CustomEvent("maite-library-saved", { detail: { owner: currentOwner, snapshot } }));
  }
  async function saveCloud() {
    await cloudQueue.current.catch(() => undefined);
    const snapshot = currentSnapshot();
    if (!snapshot.art.jobId && !snapshot.art.listingId) throw new Error("로그인 후 생성하거나 구매한 캐릭터를 저장할 수 있습니다.");
    const currentOwner = owner.current;
    await persistSnapshot(snapshot, currentOwner);
  }
  async function rewindStory(chapter: number) {
    const studioId = documentId.current, currentOwner = owner.current;
    const { documentId: novelId, lastJobId } = sessions.current.story;
    if (!novelId || !lastJobId) throw new Error("이전 회차의 이어쓰기 기록이 없습니다.");
    await cloudQueue.current.catch(() => undefined);
    if (documentId.current !== studioId || owner.current !== currentOwner) throw new Error("이야기가 바뀌었습니다.");
    const restored = snapshotSchema.parse(await jsonApi("/api/account", { action: "rewindStory", studioId, novelId, from: chapter, lastJobId }));
    if (documentId.current !== studioId || owner.current !== currentOwner) return;
    const known = new Set(visuals.images.map(image => image.id));
    const missing = restored.gallery.filter(image => image.id !== "original" && !known.has(image.id));
    if (missing.length) {
      const doc = await jsonApi(`/api/account?document=${studioId}&media=1`).catch(() => undefined);
      if (documentId.current !== studioId || owner.current !== currentOwner) return;
      visuals.restoreRemoteImages(missing, doc?.media?.gallery ?? {}, restored.backgrounds, doc?.media?.thumbnails ?? {});
    }
    const fingerprint = JSON.stringify(restored);
    lastSaved.current.set(`${currentOwner}:${studioId}`, fingerprint);
    lastSaved.current.set(`${currentOwner}:${novelId}`, fingerprint);
    sessions.current = restoreSessions(restored);
    sessions.current.story.notice = `다음 이야기에서 ${chapter}화를 다시 쓸 수 있어요.`;
    setRewindToken(restored.rewindToken);
    visuals.retainImages(restored.gallery, restored.backgrounds);
    window.dispatchEvent(new CustomEvent("maite-library-saved", { detail: { owner: currentOwner, snapshot: restored } }));
    window.dispatchEvent(new Event("maite-account-refresh"));
  }
  async function deleteCharacter(id: string) {
    suppressedDocuments.current.add(id);
    if (documentId.current === id) {
      cancel(); visuals.cancel(); window.dispatchEvent(new Event("maite-stop-chat"));
    }
    try {
      await cloudQueue.current.catch(() => undefined);
      const result = await jsonApi("/api/account", { action: "deleteCharacter", id });
      window.dispatchEvent(new CustomEvent("maite-library-deleted", { detail: { owner: owner.current, documentIds: result.documentIds || [id] } }));
      if (documentId.current === id) reset();
      router.replace("/ideal/characters");
    } catch (error) { suppressedDocuments.current.delete(id); throw error; }
  }
  async function loadCloud(id: string, navigate=true, expectedPath?:string) {
    const load = ++loadSequence.current; const currentOwner = owner.current;
    const loadingPath=currentPath.current;setDocumentLoad({path:loadingPath,loading:true});
    try{
    if (documentId.current === id && art) { if(navigate)router.push("/ideal/new"); return; }
    // Persist the outgoing character before replacing the shared session refs.
    if (art && previous.current) await saveCloud();
    else await cloudQueue.current.catch(() => undefined);
    if (load !== loadSequence.current || currentOwner !== owner.current) return;
    const doc = await jsonApi(`/api/account?document=${id}&media=1`); const data = snapshotSchema.parse(doc.payload);
    const job = doc.media?.original ? { imageUrl: doc.media.original } : await jsonApi(data.art.jobId ? `/api/account?job=${data.art.jobId}` : `/api/store?id=${data.art.listingId}`);
    if (!job.imageUrl) throw new Error("캐릭터 이미지를 찾지 못했습니다.");
    const original = await loadAccountImage(currentOwner, imageAssetKey(data.art), job.imageUrl);
    if (doc.media) {
      const blob = original;
      if (load !== loadSequence.current || currentOwner !== owner.current || suppressedDocuments.current.has(id) || (expectedPath&&currentPath.current!==expectedPath)) return;
      restore(data, blob, [], navigate);
      visuals.restoreRemoteImages(data.gallery, doc.media.gallery || {}, data.backgrounds, doc.media.thumbnails || {});
      return;
    }
    const gallery = await Promise.all(data.gallery.filter(image => image.id !== "original" && image.jobId).map(async image => {
      const result = await jsonApi(`/api/account?job=${image.jobId}`); if (!result.imageUrl) throw new Error("갤러리 이미지를 찾지 못했습니다.");
      const response = await fetch(result.imageUrl); if (!response.ok) throw new Error("갤러리 이미지를 불러오지 못했습니다."); return { id: image.id, blob: await response.blob() };
    }));
    const blob = original;
    if (load === loadSequence.current && currentOwner === owner.current && !suppressedDocuments.current.has(id) && (!expectedPath||currentPath.current===expectedPath)) restore(data, blob, gallery, navigate);
    }finally{if(load===loadSequence.current)setDocumentLoad({path:loadingPath,loading:false});}
  }
  async function importCharacter(value: Record<string, unknown>) {
    const content = value.content as { profile?: unknown; description?: string; renderStyle?: unknown };
    const profile = characterProfileSchema.parse(content?.profile);
    if (typeof value.imageUrl !== "string") throw new Error("캐릭터 이미지를 찾지 못했습니다.");
    const currentOwner = owner.current;
    const blob = await loadAccountImage(currentOwner, imageAssetKey({ listingId: String(value.id) }), value.imageUrl);
    if (art && previous.current) await saveCloud();
    if (currentOwner !== owner.current) return;
    cancel(); visuals.clear(); sessions.current = createStudioSessions(); documentId.current = crypto.randomUUID(); setRewindToken(undefined);
    previous.current = blob; const url = URL.createObjectURL(blob);
    visuals.registerOriginal(blob, url, profile.name, { listingId: String(value.id) });
    const images = Array.isArray(value.images) ? value.images : [];
    visuals.restoreRemoteImages(
      images.map(({ url: _source, thumbnailUrl: _thumbnail, ...image }) => image),
      Object.fromEntries(images.map(image => [image.jobId, image.url])),
      {},
      Object.fromEntries(images.filter(image => image.thumbnailUrl).map(image => [image.jobId, image.thumbnailUrl])),
    );
    const renderStyle = characterRenderStyle.safeParse(content.renderStyle).data;
    setSelectedRenderStyle(selectableRenderStyle.safeParse(renderStyle).data ?? "");
    setArt({ url, title: profile.name, summary: "구매한 캐릭터", prompt: "", style: "neutral", renderStyle, description: content.description ?? profile.concept, profile, width: 0, height: 0, listingId: String(value.id) });
    setDraft({ ...profile, age: String(profile.age), gender: profile.gender ?? "", appearance: profile.appearance ?? "", funElement: profile.funElement ?? "" }); router.push(accountEnabled() ? "/ideal/new" : "/ideal");
  }
  const snapshotRef = useRef<() => void>(() => undefined);
  const cloudQueue = useRef<Promise<unknown>>(Promise.resolve());
  snapshotRef.current = () => {
    if (!art || !previous.current || suppressedDocuments.current.has(documentId.current)) return;
    let snapshot: StudioSnapshot;
    try { snapshot = currentSnapshot(); } catch { setError("보관함의 저장 범위를 초과했습니다. 현재 화면의 내용을 먼저 보관해주세요."); return; }
    const currentOwner = owner.current;
    if (isNative()) void localSnapshot(currentOwner, { snapshot, blob: previous.current, gallery: visuals.images.filter(image => image.blob.size > 0).map(image => ({ id: image.id, blob: image.blob })) }).catch(() => setError("기기에 저장하지 못했습니다. 연결을 확인한 뒤 화면을 다시 열어주세요."));
    if (accountEnabled() && currentOwner !== "anonymous" && (art.jobId || art.listingId)) {
      const key = `${currentOwner}:${snapshot.id}`;
      const scheduled = pendingSnapshots.current.has(key);
      pendingSnapshots.current.set(key, { snapshot, owner: currentOwner });
      if (!scheduled) cloudQueue.current = cloudQueue.current.catch(() => undefined).then(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        const latest = pendingSnapshots.current.get(key); pendingSnapshots.current.delete(key);
        if (latest) await persistSnapshot(latest.snapshot, latest.owner);
      }).catch(() => { if (owner.current === currentOwner) setError("자동 저장을 완료하지 못했습니다. 잠시 후 다시 시도해주세요."); });
    }
  };
  useEffect(() => {
    owner.current = user?.id ?? "anonymous";
    const currentOwner = owner.current;
    if (isNative() && user && menu!=="chat" && menu!=="story") void localSnapshot(currentOwner).then(async value => { if (value && owner.current === currentOwner && account?.documents.some(doc => doc.id === value.snapshot.id)) await loadCloud(value.snapshot.id); }).catch(() => setError("저장 내용을 불러오지 못했습니다. 캐릭터 목록에서 다시 선택해주세요."));
  }, [user?.id]);
  const ownedCharacters=account?.documents.filter(doc=>doc.kind==="studio"||doc.kind==="character")??[];
  const activityRestoring=!!(accountEnabled()&&user&&!art&&(menu==="chat"||menu==="story")&&ownedCharacters.length&&(activityRestore?.path!==pathname||activityRestore.loading));
  useEffect(()=>{
    if(menu!=="chat"&&menu!=="story"){restoreAttempt.current="";return;}
    if(!accountEnabled()||!user||art||!ownedCharacters.length)return;
    const attempt=`${user.id}:${pathname}`;if(restoreAttempt.current===attempt)return;restoreAttempt.current=attempt;
    let selected="";try{selected=sessionStorage.getItem(`maite-active-character:${user.id}`)||"";}catch{}
    const id=ownedCharacters.find(doc=>doc.id===selected)?.id??ownedCharacters[0].id;
    const path=pathname;setActivityRestore({path,loading:true,error:""});
    const work=loadCloud(id,false,path),request=loadSequence.current;
    const finish=(error:string)=>{if(request===loadSequence.current&&currentPath.current===path)setActivityRestore({path,loading:false,error});};
    void work.then(()=>finish("")).catch(()=>finish("저장된 캐릭터를 불러오지 못했습니다."));
    return()=>{restoreAttempt.current="";};
  },[user?.id,pathname,account?.documents]);
  useEffect(()=>{if(user&&art){try{sessionStorage.setItem(`maite-active-character:${user.id}`,documentId.current);}catch{}}},[user?.id,art?.url]);
  useEffect(() => {
    const changed = (event: Event) => { owner.current = (event as CustomEvent<string>).detail; reset({ keepImageAttempt: true }); visuals.clearArchive(); if (isNative()) void localSnapshot(owner.current).then(value => { if (value && owner.current === (event as CustomEvent<string>).detail) restore(snapshotSchema.parse(value.snapshot), value.blob, value.gallery); }).catch(() => setError("기기의 저장 내용을 불러오지 못했습니다.")); };
    const background = () => { snapshotRef.current(); };
    const committed = () => snapshotRef.current();
    window.addEventListener("maite-account-change", changed); window.addEventListener("maite-background", background); window.addEventListener("maite-session-committed", committed);
    return () => { window.removeEventListener("maite-account-change", changed); window.removeEventListener("maite-background", background); window.removeEventListener("maite-session-committed", committed); };
  }, []);
  useEffect(() => { snapshotRef.current(); }, [art]);
  useEffect(() => { snapshotRef.current(); }, [visuals.images, visuals.backgrounds]);
  useEffect(() => { if (isNative() && !accountEnabled()) void localSnapshot("anonymous").then(value => { if (value) restore(snapshotSchema.parse(value.snapshot), value.blob, value.gallery); }).catch(() => setError("저장 내용을 불러오지 못했습니다.")); }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      loadSequence.current++;
    },
    [],
  );
  useEffect(() => {
    return () => {
      if (art) URL.revokeObjectURL(art.url);
    };
  }, [art]);
  useEffect(() => {
    if (busy || confirmingCharacter) return;
    if (art) {
      result.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (messages.length)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    else bottom.current?.parentElement?.scrollTo({ top: 0 });
  }, [messages, art, busy, confirmingCharacter]);
  useLayoutEffect(() => {
    if (!busy && !confirmingCharacter) return;
    const image = result.current;
    // The confirmation owns focus until it closes. Bring the image into view behind it.
    if (busy) image?.focus({ preventScroll: true });
    image?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [busy, confirmingCharacter]);
  function cancel() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (pending.current) {
      setMessages(pending.current.messages);
      pending.current = null;
    }
    setBusy(false);
  }
  function reset({ keepImageAttempt = false } = {}) {
    if (!keepImageAttempt) forgetImageAttempt(owner.current, "character");
    setDocumentLoad(undefined);
    cancel();
    visuals.clear();
    setMessages([]);
    setArt(undefined);
    sessions.current = createStudioSessions();
    documentId.current = crypto.randomUUID();
    setRewindToken(undefined);
    pendingFocus.current = "profile";
    router.replace(accountEnabled() ? "/ideal/new" : "/ideal", { scroll: false });
    if (menu === "image") focusCreation("profile");
    setDraft({ name: "", age: "", gender: "", appearance: "", personality: "", funElement: "", concept: "" });
    setSelectedRenderStyle("");
    previous.current = null;
    setError("");
    setStatus("새로운 캐릭터의 분위기를 설명해주세요.");
  }
  function startNewCharacter() {
    // Capture the outgoing character before clearing the shared creation session.
    snapshotRef.current();
    loadSequence.current++;
    setCreatedPreview(undefined);
    reset();
  }
  async function submit() {
    if (controller.current || confirmingCharacter) return;
    const parsedProfile = characterProfileSchema.safeParse({ ...draft, age: Number(draft.age), appearance: draft.appearance.trim() || undefined, funElement: draft.funElement.trim() || undefined });
    if (!parsedProfile.success) { setError("캐릭터 이름·나이·성별·성격·컨셉을 입력해주세요."); return; }
    if (blocksImageGeneration({profile:parsedProfile.data})) { showPolicyNotice(); return; }
    const balance = (account?.wallet.transferable ?? 0) + (account?.wallet.bonus ?? 0);
    const retrying = hasImageAttempt(owner.current, "character");
    if (accountEnabled() && balance < HEART_COST.character && !retrying) { setError("하트가 부족해요. 스토어에서 충전한 뒤 다시 시도해주세요."); return; }
    if (accountEnabled()) {
      setConfirmingCharacter(true);
      const accepted = await confirm({ title: "새로운 캐릭터를 만날까요?", description: "나만의 캐릭터를 만들어보세요!", lines: balance < HEART_COST.character ? [] : [{ label: "캐릭터 생성", value: `${HEART_COST.character}하트` }, { label: "생성 후 보유 하트", value: `${balance - HEART_COST.character}하트` }], confirmLabel: "캐릭터 생성" });
      setConfirmingCharacter(false);
      if (!accepted) return;
    }
    if (controller.current) return;
    const profile = parsedProfile.data;
    const user: Message = { role: "user", content: profile.concept };
    const id = ++generation.current;
    pending.current = { messages };
    const abort = new AbortController();
    controller.current = abort;
    setMessages([user]);
    setError("");
    sessions.current = createStudioSessions();
    setArt(undefined);
    visuals.clear();
    setBusy(true);
    setStatus("입력한 설정으로 캐릭터를 그리는 중…");
    const timeout = setTimeout(() => abort.abort(), 280000);
    try {
      const body = new FormData();
      body.set("messages", JSON.stringify([user]));
      body.set("profile", JSON.stringify(profile));
      if (selectedRenderStyle) body.set("renderStyle", selectedRenderStyle);
      const attempt = await beginImageAttempt(owner.current, "character", body);
      const response = await usageImageFetch("캐릭터 생성", "/api/characters", {
        method: "POST",
        body,
        headers: attempt.headers,
        signal: abort.signal,
      });
      attempt.remember(response);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || "이미지를 생성하지 못했습니다. 다시 시도해주세요.",
        );
      }
      if (!response.headers.get("content-type")?.startsWith("image/jpeg"))
        throw new Error("이미지 응답 형식이 올바르지 않습니다.");
      const blob = await response.blob();
      if (id !== generation.current) return;
      if (blob.size === 0 || blob.size > MAX_CHARACTER_IMAGE)
        throw new Error("이미지 크기를 확인할 수 없습니다. 다시 생성해주세요.");
      const title = decodeURIComponent(
        response.headers.get("X-Character-Title") || "나만의 캐릭터",
      );
      const summary = decodeURIComponent(
        response.headers.get("X-Character-Summary") ||
          "요청한 분위기로 캐릭터를 그렸어요. 변경하고 싶은 부분을 알려주세요.",
      );
      let prompt = response.headers.get("X-Character-Prompt") || "";
      try { prompt = decodeURIComponent(prompt); } catch { /* Older stored responses may contain a raw prompt. */ }
      const parsedStyle = characterStyleProfile.safeParse(response.headers.get("X-Character-Style"));
      const style = parsedStyle.success ? parsedStyle.data : "neutral";
      const renderStyle = characterRenderStyle.safeParse(response.headers.get(characterStyleHeader)).data;
      const url = URL.createObjectURL(blob);
      const decoded = new Image(); decoded.src = url;
      try { await decoded.decode(); } catch { URL.revokeObjectURL(url); throw new Error("생성된 이미지를 열지 못했습니다. 다시 시도해주세요."); }
      if (id !== generation.current) { URL.revokeObjectURL(url); return; }
      attempt.complete();
      previous.current = blob;
      pending.current = null;
      visuals.registerOriginal(blob, url, title, { jobId: response.headers.get("X-Job-Id") ?? undefined });
      setArt({
        url,
        jobId: response.headers.get("X-Job-Id") ?? undefined,
        title,
        summary,
        prompt,
        style,
        renderStyle,
        profile,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
        description: [user.content, summary.slice(0, 1000), prompt.slice(0, 1500)].filter(Boolean).join("\n"),
      });
      setMessages([user, { role: "assistant", content: summary }]);
      setCreatedPreview({url,title});
      trackAnalyticsEvent("character_created");
    } catch (e) {
      if (id !== generation.current) return;
      pending.current = null;
      if (e instanceof Error && e.message === GENERATION_POLICY_MESSAGE) showPolicyNotice();
      else setError(
        abort.signal.aborted
          ? "생성 시간이 초과되었습니다. 다시 시도해주세요."
          : e instanceof Error
            ? e.message
            : "이미지를 생성하지 못했습니다.",
      );
      setStatus("요청을 완료하지 못했습니다.");
      setMessages(messages);
    } finally {
      clearTimeout(timeout);
      if (id === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  const creation = (
      <div className="character-image-panel">
      {art && <img className="character-backdrop" src={art.url} alt="" />}
      <main className="chat-layout">
        <div className="character-conversations">
        <section className="conversation">
          <div className="conversation-title">
            <span className="eyebrow">NEW FACE</span>
            <h1>뉴페이스</h1>
            <div className="character-creation-tools"><Link href="/ideal/gallery" aria-label="갤러리">갤러리</Link><button type="button" className="character-new-action" aria-label="새 캐릭터 대화" onClick={() => reset()}>새로 작성</button></div>
            <p>어떤 캐릭터와 만나고 싶나요?</p>
          </div>
          <fieldset ref={profileFields} className="character-profile character-image-profile" disabled={busy}>
            <legend>캐릭터 만들기</legend>
            <p>이름부터 이야기까지, 당신만의 캐릭터를 완성해보세요.</p>
            <div className="character-profile-basics">
              <label>캐릭터 이름<input form="character-generation" name="name" required pattern=".*\S.*" maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="이름" /></label>
              <label>나이<input form="character-generation" name="age" type="number" required min={1} max={120} step={1} value={draft.age} onChange={event => setDraft({ ...draft, age: event.target.value })} placeholder="나이" /></label>
            </div>
            <label>성별<select aria-label="성별" form="character-generation" name="gender" required value={draft.gender} onChange={event => setDraft({ ...draft, gender: event.target.value })}>
              <option value="" disabled>선택해주세요</option>
              {CHARACTER_GENDERS.map(gender => <option key={gender} value={gender}>{gender}</option>)}
            </select></label>
            <label>화풍<select form="character-generation" name="renderStyle" value={selectedRenderStyle} onChange={event => setSelectedRenderStyle(event.target.value)}>
              <option value="">무작위</option>
              {newCharacterRenderStyles.map(style => <option key={style} value={style}>{renderStyleLabels[style]}</option>)}
            </select></label>
            <label>외모<textarea aria-label="외모" form="character-generation" name="appearance" maxLength={1000} value={draft.appearance} onChange={event => setDraft({ ...draft, appearance: event.target.value })} placeholder="머리색, 눈동자, 얼굴, 체형 등 원하는 외모를 적어주세요 (선택)" /></label>
            <label>성격<textarea aria-label="성격" form="character-generation" name="personality" required maxLength={1000} value={draft.personality} onChange={event => { event.target.setCustomValidity(""); setDraft({ ...draft, personality: event.target.value }); }} placeholder="캐릭터의 성격을 적어주세요" /></label>
            <label>재미요소<textarea aria-label="재미요소" form="character-generation" name="funElement" maxLength={1000} value={draft.funElement} onChange={event => setDraft({ ...draft, funElement: event.target.value })} placeholder="예: 서로 지기 싫어 티격태격하지만 결정적일 때는 편들어 줌 (선택)" /></label>
            <label>컨셉<textarea aria-label="컨셉" form="character-generation" name="concept" required maxLength={1000} value={draft.concept} onChange={event => { event.target.setCustomValidity(""); setDraft({ ...draft, concept: event.target.value }); }} placeholder="관계, 세계관, 배경 등 원하는 설정을 적어주세요" /></label>
            {art && <small>수정한 특성은 이미지를 다시 생성하면 대화·이야기에 적용됩니다.</small>}
          </fieldset>
          <div className="message-list" aria-live="polite" hidden={!messages.length && !busy}>
            {messages.map((m, i) => (
                <article key={i} className={`chat-message ${m.role}`}>
                  <span>{m.role === "user" ? "나" : "MAITE"}</span>
                  <p>{m.content}</p>
                </article>
              ))}
            {busy && (
              <div className="thinking">
                <LoaderCircle className="spin" size={15} />
                캐릭터를 그리는 중 · 잠시 기다려주세요
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div className="composer-area">
            <GenerationFeedback message={error} onDismiss={() => setError("")} className="chat-error" />
            <form
              className="character-generation-actions"
              id="character-generation"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <button type="submit" disabled={busy} aria-busy={busy} aria-label="캐릭터 생성">
                {busy ? <><LoaderCircle className="spin" size={18} /> 그림을 그리고 있어요</> : <><Sparkles size={18} /> 캐릭터 생성 {accountEnabled() && <span className="button-heart-cost"><HeartText text={`· ${HEART_COST.character}하트`}/></span>}</>}
              </button>
              {busy && <button type="button" className="character-generation-cancel" onClick={cancel} aria-label="이미지 생성 취소"><X size={17} /> 생성 취소</button>}
            </form>
            <p role="status">{!art && !busy ? status : "입력한 컨셉으로 캐릭터를 생성합니다."}</p>
          </div>
        </section>
        </div>
        <section className={`chat-output character-output${confirmingCharacter ? " is-awaiting-confirmation" : ""}`} aria-labelledby={resultHeadingId} tabIndex={-1} ref={result}>
          <div className="character-output-heading"><ImagePlus size={16} aria-hidden="true" /><h2 id={resultHeadingId}>캐릭터 이미지</h2></div>
          <div className={`character-canvas ${art ? "has-art" : ""}`} aria-busy={busy}>
            {art ? (
                <CharacterImage src={art.url} title={art.title} width={art.width} height={art.height} />
              ) : busy ? (
                <div className="character-loading">
                  <LoaderCircle className="spin" size={32} />
                  <h2>그림을 그리고 있어요</h2>
                  <p>
                    외형과 의상, 표정의 디테일을 담는 중입니다.
                    <br />
                    잠시 걸릴 수 있어요.
                  </p>
                </div>
              ) : (
                <div className="character-empty">
                  <h2>상상 속 캐릭터를, 눈앞에.</h2>
                  <p>
                    캐릭터의 특성과 컨셉을 입력해보세요.
                    <br />
                    나만의 2D 일러스트로 완성해드릴게요.
                  </p>
                </div>
              )}
            </div>
          {art && !busy && <div className="character-next" role="group" aria-label="캐릭터와 함께하기">
            <button type="button" aria-label="대화하기" title="대화하기" onClick={() => openMenu("chat")}><MessageCircle size={30} aria-hidden="true" /></button>
            <button type="button" aria-label="이야기 만들기" title="이야기 만들기" onClick={() => openMenu("story")}><BookOpen size={30} aria-hidden="true" /></button>
          </div>}
          {(art || busy) && <div className="chat-progress" role="status">
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <span className="status-dot" />
            )}
            {status}
          </div>}

        </section>
      </main>
      </div>
  );
  return (
    <StudioContext.Provider value={{ creation, art, activityRestoring, activityRestoreError:activityRestore?.path===pathname?activityRestore.error:"", characterDocumentId: documentId.current, sessions: sessions.current, openMenu, startNewCharacter, editProfile, visuals, loadDocument: loadCloud, importCharacter, deleteCharacter, rewindToken, rewindStory, flushSave: async () => { if (art && accountEnabled() && user) await saveCloud(); } }}>
    <CheckinInbox key={user?.id ?? "demo"}><div ref={app} className={`chat-app character-app ${menu === "chat" || menu === "story" ? "is-character-reading" : ""} ${menu === "chat" ? "is-character-chat" : ""}`}>
      <header className="chat-header">
        <Link href="/ideal/mypage" className="native-user" aria-label="내 프로필"><span className="native-avatar">{account?.avatarUrl ? <CachedImage src={account.avatarUrl} cacheKey={`profile:${account.avatarUrl.split("?")[0]}`} alt=""/> : (account?.profile?.display_name || "당신").slice(0, 1)}</span><strong>{account?.profile?.display_name || "당신"}</strong></Link>
        <div className="native-header-tools">
          <TokenUsage />
          <AccountMenu />
        </div>
      </header>
      {children}
      {art && (["chat", "story"] as const).map(mode => (menu === mode || (visitedActivities.art === art.url && visitedActivities.modes.includes(mode))) ? <PersistentCharacterActivity key={`${art.url}-${mode}`} mode={mode} active={menu === mode}/> : null)}
      <PushBridge/>
      {createdPreview && <CharacterImageViewer src={createdPreview.url} title={createdPreview.title} open onClose={() => setCreatedPreview(undefined)} />}
      <AppFooter />
    </div></CheckinInbox>
    </StudioContext.Provider>
  );
}
