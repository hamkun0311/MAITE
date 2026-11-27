"use client";
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { accountClient, accountEnabled } from "@/lib/account/client";
import { koreaDay } from "@/lib/account/policy";
import { hasUnclaimedRewardsToday, rewardsCalendarPath, type RewardCalendar } from "@/lib/account/rewards";
import { jsonApi, invalidateApiReads } from "@/lib/platform/commerce";
import { isNative } from "@/lib/platform/native";
import type { AccountData } from "@/lib/account/library";
import ProfileSetup, { ProfileEditModal } from "./ProfileSetup";
import {useScreenLoading} from "./ScreenLoading";
import type { UserProfile } from "@/lib/account/profile";
import type { StudioSnapshot } from "@/lib/platform/snapshot";
import type { LibraryDocument } from "@/lib/account/library";
import { unregisterPush } from "@/lib/platform/push";
import { apiFetch } from "@/lib/platform/api";
import { imageBlobs } from "@/lib/platform/image-cache";
import { imageViews } from "@/lib/platform/image-views";
import { persistentImages } from "@/lib/platform/persistent-images";
import { clearCharacterPreviews, invalidateCharacterPreviews } from "@/lib/platform/character-previews";
import { preloadCharacterPreviews } from "@/lib/platform/preload-images";

type User = { id: string; email?: string };
type AccountContext = { user?: User; account?: AccountData; refresh: (fresh?: boolean) => Promise<void>; logout: () => Promise<void>; editProfile: () => void };
const Context = createContext<AccountContext>({ refresh: async () => {}, logout: async () => {}, editProfile: () => {} });
export const useAccount = () => useContext(Context);
const loginKey = "maite-web-login-started";
const rewardLandingKey = (owner: string) => `maite-reward-landing:${owner}`;

function checkedRewardLandingToday(owner: string) {
  try { return sessionStorage.getItem(rewardLandingKey(owner)) === koreaDay(); }
  catch { return false; }
}

function rememberRewardLanding(owner: string, today: string) {
  try { sessionStorage.setItem(rewardLandingKey(owner), today); } catch { /* Session storage is optional. */ }
}

function consumeWebLogin() {
  try {
    const started = Number(sessionStorage.getItem(loginKey));
    sessionStorage.removeItem(loginKey);
    return started > 0 && Date.now() - started < 15 * 60_000;
  } catch { return false; }
}

export default function AccountProvider({ children }: { children: ReactNode }) {
  const enabled = accountEnabled(); const client = accountClient(); const router = useRouter(); const pathname = usePathname();
  const [ready, setReady] = useState(!enabled); const [user, setUser] = useState<User>();
  const [account, setAccount] = useState<AccountData>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [imagePreparation,setImagePreparation]=useState<{owner:string;ready:boolean;loaded:number;total:number}>();
  const active = useRef<string | undefined>(undefined); const pending = useRef<Promise<void> | undefined>(undefined);
  const checkedDay = useRef(""); const dailyPending = useRef(false);
  const nativeLogin = useRef(false);
  const [loginLanding, setLoginLanding] = useState<{ owner: string; fallback: string; destination?: string; checkedOn?: string }>();
  const hasAccount=!!account,profileReady=account?.profile?.onboarded!==false;
  const checkingLanding = !!loginLanding && loginLanding.owner === user?.id && profileReady && !error;
  const preparingImages=!!(enabled&&user&&account&&profileReady&&pathname!=="/ideal/rewards"&&account.documents.some(doc=>(doc.kind==="studio"||doc.kind==="character")&&doc.job_id)&&(imagePreparation?.owner!==user.id||!imagePreparation.ready));
  useScreenLoading(enabled&&(!ready||(busy&&!user)||(!!user&&((!account&&!error)||preparingImages||checkingLanding))));

  useEffect(() => {
    if (!loginLanding?.destination || loginLanding.owner !== user?.id || !hasAccount || !profileReady) return;
    if (pathname === loginLanding.destination) {
      if (loginLanding.checkedOn) rememberRewardLanding(loginLanding.owner, loginLanding.checkedOn);
      setLoginLanding(undefined);
    } else router.replace(loginLanding.destination);
  }, [loginLanding, user?.id, hasAccount, profileReady, pathname, router]);

  useEffect(() => {
    if (!loginLanding || loginLanding.destination || loginLanding.owner !== user?.id || !hasAccount || !profileReady) return;
    let active = true;
    const land = (destination: string, checkedOn?: string) => {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      setLoginLanding({ ...loginLanding, destination, checkedOn });
    };
    const timeout = setTimeout(() => land(loginLanding.fallback), 3500);
    const month = koreaDay().slice(0, 7) + "-01";
    void jsonApi(rewardsCalendarPath(month)).then((calendar: RewardCalendar) => {
      const currentMonth = calendar.today.slice(0, 7) + "-01";
      return currentMonth === calendar.month ? calendar : jsonApi(rewardsCalendarPath(currentMonth)) as Promise<RewardCalendar>;
    }).then(calendar => land(hasUnclaimedRewardsToday(calendar) ? "/ideal/rewards" : loginLanding.fallback, calendar.today))
      .catch(() => land(loginLanding.fallback));
    return () => { active = false; clearTimeout(timeout); };
  }, [loginLanding, user?.id, hasAccount, profileReady]);
  useEffect(()=>{
    if(!enabled||!user||!hasAccount||!profileReady)return;
    const owner=user.id;let alive=true;
    const ids=(account?.documents??[]).filter(doc=>doc.kind==="studio"||doc.kind==="character").flatMap(doc=>doc.job_id?[doc.job_id]:[]);
    setImagePreparation({owner,ready:!ids.length,loaded:0,total:Math.min(new Set(ids).size,60)});
    const reveal=()=>{if(alive)setImagePreparation(current=>current?.owner===owner?{...current,ready:true}:current);};
    // Slow/offline storage must never prevent access to text or account settings.
    const timeout=setTimeout(reveal,1200);
    void preloadCharacterPreviews(owner,ids,()=>alive,(loaded,total)=>{if(alive)setImagePreparation(current=>current?.owner===owner?{...current,loaded,total}:current);}).catch(()=>undefined).finally(()=>{clearTimeout(timeout);reveal();});
    return()=>{alive=false;clearTimeout(timeout);};
  },[enabled,user?.id,hasAccount,profileReady]);
  async function refresh(fresh = false) {
    const id = active.current;
    if (!id) return;
    if (fresh && pending.current) await pending.current.catch(() => undefined);
    if (active.current !== id) return;
    if (pending.current) return pending.current;
    const work = (async () => { const data = await jsonApi("/api/account"); if (active.current === id) setAccount(data); })();
    pending.current = work;
    try { await work; } finally { if (pending.current === work) pending.current = undefined; }
  }
  useEffect(() => {
    if (!enabled || !client) { setReady(true); return; }
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    async function daily() {
      const id = active.current; const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
      if (!id || dailyPending.current || checkedDay.current === `${id}:${day}`) return;
      dailyPending.current = true;
      try { /* Rewards are claimed explicitly on the calendar screen. */ if (active.current === id) checkedDay.current = `${id}:${day}`; await refresh(); }
      catch (error) { if (!disposed) setError(error instanceof Error ? error.message : "계정을 불러오지 못했습니다."); }
      finally { dailyPending.current = false; }
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (disposed) return;
      const next = session?.user;
      if (active.current !== next?.id) {
        invalidateApiReads();
        if (active.current) void persistentImages.clear();
        imageBlobs.clear(); imageViews.clear(); clearCharacterPreviews();
        active.current = next?.id; pending.current = undefined; setAccount(undefined); setUser(next); checkedDay.current = ""; setEditing(false);
        const freshLogin = next && (nativeLogin.current || consumeWebLogin());
        setLoginLanding(next && (freshLogin || !checkedRewardLandingToday(next.id))
          ? { owner: next.id, fallback: freshLogin ? "/ideal" : window.location.pathname }
          : undefined);
      }
      setReady(true);
      if (next) setTimeout(() => { if (!disposed) void daily(); }, 0);
    });
    const refreshEvent = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh().catch(() => undefined); }, 200); };
    const librarySaved = (event: Event) => {
      const { owner, snapshot } = (event as CustomEvent<{ owner: string; snapshot: StudioSnapshot }>).detail;
      if (owner !== active.current) return;
      invalidateCharacterPreviews(owner, snapshot.art.jobId);
      const fields = { updated_at: new Date().toISOString(), character_name: snapshot.art.profile.name, job_id: snapshot.art.jobId, source_id: snapshot.id, chapter: String(snapshot.story.storyState?.chapter || 0), novel_id: snapshot.story.documentId, next_goal: snapshot.story.storyState?.nextChapterGoal, series_start: String(snapshot.story.storyState?.seriesStartChapter || 0), series_ending: snapshot.story.storyState?.seriesArc?.endingMode };
      const documents: LibraryDocument[] = [{ ...fields, id: snapshot.id, title: snapshot.art.title, kind: "studio" }];
      if (snapshot.story.documentId && snapshot.story.storyState?.chapter) documents.push({ ...fields, id: snapshot.story.documentId, title: `${snapshot.art.title.slice(0, 100)}의 이야기`, kind: "chapter" });
      setAccount(current => current && ({ ...current, documents: [...documents.map(doc => ({ ...doc, title: current.documents.find(old => old.id === doc.id)?.title || doc.title })), ...current.documents.filter(doc => !documents.some(saved => saved.id === doc.id))] }));
    };
    const libraryDeleted = (event: Event) => {
      const { owner, documentIds } = (event as CustomEvent<{ owner: string; documentIds: string[] }>).detail;
      if (owner === active.current) setAccount(current => current && ({ ...current, documents: current.documents.filter(doc => !documentIds.includes(doc.id)) }));
    };
    const foreground = () => { if (document.visibilityState === "visible") void daily(); };
    window.addEventListener("maite-account-refresh", refreshEvent); window.addEventListener("maite-library-saved", librarySaved); window.addEventListener("maite-library-deleted", libraryDeleted); window.addEventListener("focus", foreground); window.addEventListener("maite-foreground", foreground);
    let removeLink: (() => Promise<void>) | undefined;
    if (isNative()) void import("@capacitor/app").then(async ({ App }) => {
      const callback = async ({ url }: { url: string }) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "com.oestewdio.maite:" || parsed.hostname !== "auth" || parsed.pathname !== "/callback") return;
          const code = parsed.searchParams.get("code");
          if (code) {
            nativeLogin.current = true;
            try { const { error } = await client.auth.exchangeCodeForSession(code); if (error) throw error; }
            finally { nativeLogin.current = false; }
          }
          const { Browser } = await import("@capacitor/browser"); await Browser.close().catch(() => undefined);
        } catch { if (!disposed) setError("로그인을 완료하지 못했습니다. 다시 시도해주세요."); }
      };
      const link = await App.addListener("appUrlOpen", callback); removeLink = () => link.remove();
      if (disposed) await link.remove(); else { const launch = await App.getLaunchUrl(); if (launch?.url) await callback(launch); }
    }).catch(() => setError("로그인 연결을 준비하지 못했습니다."));
    return () => { disposed = true; clearTimeout(timer); data.subscription.unsubscribe(); window.removeEventListener("maite-account-refresh", refreshEvent); window.removeEventListener("maite-library-saved", librarySaved); window.removeEventListener("maite-library-deleted", libraryDeleted); window.removeEventListener("focus", foreground); window.removeEventListener("maite-foreground", foreground); void removeLink?.(); };
  }, [enabled, client]);
  async function login() {
    setBusy(true); setError("");
    try {
      if (!client) throw new Error("Google 로그인을 위한 Supabase 설정이 필요합니다.");
      const native = isNative();
      if (!native) { try { sessionStorage.setItem(loginKey, String(Date.now())); } catch { /* Login still works without storage. */ } }
      const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: native ? "com.oestewdio.maite://auth/callback" : `${location.origin}/ideal`, skipBrowserRedirect: native } });
      if (error) throw error;
      if (native && data.url) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: data.url }); }
    } catch (error) { consumeWebLogin(); setError(error instanceof Error ? error.message : "로그인하지 못했습니다."); } finally { setBusy(false); }
  }
  async function logout() { await unregisterPush().catch(() => undefined); const { error } = await client!.auth.signOut(); if (error) throw error; router.replace("/ideal"); }
  if (enabled && (!ready || !user)) return <main className="login-screen"><div className="login-card"><span className="login-brand">maite.</span><h1>당신의 상상, <br/> 시작되는 이야기</h1><p>캐릭터를 만들고, 대화하고, 당신만의 소설을 완성하세요.</p>{ready ? <button disabled={busy || !client} onClick={() => void login()}>Google로 로그인</button> : null}{(!client || error) && <p role="alert">{error || "로그인 설정을 확인해주세요."}</p>}</div></main>;
  async function saveProfile(profile: UserProfile, photo?: File | null) {
    const owner = active.current;
    let avatar: { avatarUrl?: string | null } = {};
    if (photo !== undefined) {
      const body = new FormData(); body.set("profile", JSON.stringify(profile));
      if (photo) body.set("photo", photo); else body.set("removePhoto", "true");
      invalidateApiReads();
      const response = await apiFetch("/api/account/profile", { method: "POST", body });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "사진을 저장하지 못했습니다.");
      avatar = { avatarUrl: data.avatarUrl }; invalidateApiReads();
    } else await jsonApi("/api/account", { action: "profile", ...profile });
    if (active.current !== owner) return;
    setAccount(current => current && ({ ...current, ...avatar, profile: { ...current.profile, display_name: profile.nickname, gender: profile.gender, age: profile.age, onboarded: true } }));
    const first = account?.profile?.onboarded === false;
    setEditing(false);
    if (first) {
      if (loginLanding?.owner === owner && loginLanding) setLoginLanding({ ...loginLanding, fallback: "/ideal/characters" });
      else router.replace("/ideal/characters");
    }
  }
  if (enabled && user && !account) return <main className="native-standalone account-preparing"><span className="native-wordmark">maite<span>.</span></span>{error && <p role="alert">{error}</p>}{error && <button onClick={() => { setError(""); void refresh().catch(() => setError("계정 연결을 확인해주세요.")); }}>다시 시도</button>}</main>;
  if (enabled && user && account?.profile?.onboarded === false) return <ProfileSetup initial={{ nickname: account.profile.display_name }} onSave={saveProfile}/>;
  if(checkingLanding||preparingImages)return <main className="native-standalone account-preparing" aria-busy="true"/>;
  return <Context.Provider value={{ user, account, refresh, logout, editProfile: () => setEditing(true) }}><Fragment key={user?.id ?? "demo"}>{children}</Fragment>{editing && <ProfileEditModal avatarUrl={account?.avatarUrl} initial={{ nickname: account?.profile?.display_name, gender: account?.profile?.gender as UserProfile["gender"] }} onSave={saveProfile} onCancel={() => setEditing(false)}/>}</Context.Provider>;
}
