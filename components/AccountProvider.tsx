"use client";
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { accountClient, accountEnabled } from "@/lib/account/client";
import { jsonApi } from "@/lib/platform/commerce";
import { isNative } from "@/lib/platform/native";
import type { AccountData } from "@/lib/account/library";
import ProfileSetup, { ProfileEditModal } from "./ProfileSetup";
import type { UserProfile } from "@/lib/account/profile";
import type { StudioSnapshot } from "@/lib/platform/snapshot";
import type { LibraryDocument } from "@/lib/account/library";

type User = { id: string; email?: string };
type AccountContext = { user?: User; account?: AccountData; refresh: () => Promise<void>; logout: () => Promise<void>; editProfile: () => void };
const Context = createContext<AccountContext>({ refresh: async () => {}, logout: async () => {}, editProfile: () => {} });
export const useAccount = () => useContext(Context);
export default function AccountProvider({ children }: { children: ReactNode }) {
  const enabled = accountEnabled(); const client = accountClient(); const router = useRouter();
  const [ready, setReady] = useState(!enabled); const [user, setUser] = useState<User>();
  const [account, setAccount] = useState<AccountData>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const active = useRef<string | undefined>(undefined); const pending = useRef<Promise<void> | undefined>(undefined);
  const checkedDay = useRef(""); const dailyPending = useRef(false);
  async function refresh() {
    if (!active.current) return;
    if (pending.current) return pending.current;
    const id = active.current;
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
      try { await jsonApi("/api/account", { action: "daily" }); if (active.current === id) checkedDay.current = `${id}:${day}`; await refresh(); }
      catch (error) { if (!disposed) setError(error instanceof Error ? error.message : "계정을 불러오지 못했습니다."); }
      finally { dailyPending.current = false; }
    }
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const next = session?.user;
      if (active.current !== next?.id) {
        active.current = next?.id; pending.current = undefined; setAccount(undefined); setUser(next); checkedDay.current = ""; setEditing(false);
        if (next && event === "SIGNED_IN") router.replace("/ideal");
      }
      setReady(true);
      if (next) setTimeout(() => { if (!disposed) void daily(); }, 0);
    });
    const refreshEvent = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh().catch(() => undefined); }, 200); };
    const librarySaved = (event: Event) => {
      const { owner, snapshot } = (event as CustomEvent<{ owner: string; snapshot: StudioSnapshot }>).detail;
      if (owner !== active.current) return;
      const fields = { updated_at: new Date().toISOString(), character_name: snapshot.art.profile.name, job_id: snapshot.art.jobId, source_id: snapshot.id, chapter: String(snapshot.story.storyState?.chapter || 0), novel_id: snapshot.story.documentId, next_goal: snapshot.story.storyState?.nextChapterGoal, series_start: String(snapshot.story.storyState?.seriesStartChapter || 0) };
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
          if (code) { const { error } = await client.auth.exchangeCodeForSession(code); if (error) throw error; }
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
      const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: native ? "com.oestewdio.maite://auth/callback" : `${location.origin}/ideal`, skipBrowserRedirect: native } });
      if (error) throw error;
      if (native && data.url) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: data.url }); }
    } catch (error) { setError(error instanceof Error ? error.message : "로그인하지 못했습니다."); } finally { setBusy(false); }
  }
  async function logout() { const { error } = await client!.auth.signOut(); if (error) throw error; router.replace("/ideal"); }
  if (enabled && (!ready || !user)) return <main className="login-screen"><div className="login-card"><span className="login-brand">maite.</span><h1>당신의 상상에서 시작되는 이야기</h1><p>캐릭터를 만들고, 대화하고, 당신만의 소설을 완성하세요.</p>{ready ? <button disabled={busy || !client} onClick={() => void login()}>{busy ? "로그인 연결 중…" : "Google로 로그인"}</button> : <p role="status">로그인 확인 중…</p>}{(!client || error) && <p role="alert">{error || "로그인 설정을 확인해주세요."}</p>}</div></main>;
  async function saveProfile(profile: UserProfile) {
    await jsonApi("/api/account", { action: "profile", ...profile });
    setAccount(current => current && ({ ...current, profile: { ...current.profile, display_name: profile.nickname, gender: profile.gender, age: profile.age, onboarded: true } }));
    const first = account?.profile?.onboarded === false; setEditing(false); if (first) router.replace("/ideal/characters");
  }
  if (enabled && user && !account) return <main className="native-standalone account-preparing"><span className="native-wordmark">maite<span>.</span></span><p role="status">{error || "당신의 이야기를 준비하고 있어요"}</p>{error && <button onClick={() => { setError(""); void refresh().catch(() => setError("계정 연결을 확인해주세요.")); }}>다시 시도</button>}</main>;
  if (enabled && user && account?.profile?.onboarded === false) return <ProfileSetup initial={{ nickname: account.profile.display_name }} onSave={saveProfile}/>;
  return <Context.Provider value={{ user, account, refresh, logout, editProfile: () => setEditing(true) }}><Fragment key={user?.id ?? "demo"}>{children}</Fragment>{editing && <ProfileEditModal initial={{ nickname: account?.profile?.display_name, gender: account?.profile?.gender as UserProfile["gender"], age: account?.profile?.age }} onSave={saveProfile} onCancel={() => setEditing(false)}/>}</Context.Provider>;
}
