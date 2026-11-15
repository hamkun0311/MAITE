"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CharacterImage from "./CharacterImage";
import useCharacterGallery from "./useCharacterGallery";
import { createChatSession, type ChatSession } from "@/lib/chat/session";
import {
  ArrowDownToLine,
  Cuboid,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  BookOpen,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import StudioNav from "./StudioNav";
import CharacterExperience from "./CharacterExperience";
import { CHARACTER_GENDERS, characterProfileSchema, type CharacterProfile } from "@/lib/chat/character";
import {
  MAX_CHARACTER_IMAGE,
  CHARACTER_WIDTH,
  CHARACTER_HEIGHT,
  CHARACTER_STYLES,
  characterStyleProfile,
} from "@/lib/characters/schema";

type Message = { role: "user" | "assistant"; content: string };
type StyleProfile = keyof typeof CHARACTER_STYLES;
type Artwork = { url: string; title: string; summary: string; prompt: string; style: StyleProfile; description: string; profile: CharacterProfile };
type StudioSession = {
  creation: ReactNode;
  art?: Artwork;
  sessions: Record<"chat" | "story", ChatSession>;
  openMenu: (mode: "image" | "chat" | "story") => void;
  editProfile: () => void;
  visuals: ReturnType<typeof useCharacterGallery>;
};
const StudioContext = createContext<StudioSession | null>(null);
function useStudioSession() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Character studio layout is required");
  return value;
}
export function CharacterCreationScreen() {
  return useStudioSession().creation;
}
export function CharacterActivityScreen({ mode }: { mode: "chat" | "story" }) {
  const { art, sessions, editProfile, openMenu, visuals } = useStudioSession();
  if (!art) return <main className="character-missing"><h1>캐릭터를 먼저 만들어주세요.</h1><p>생성한 캐릭터로 대화와 이야기를 시작할 수 있습니다.</p><Link href="/ideal">캐릭터 생성으로 이동</Link></main>;
  const background = visuals.images.find(image => image.id === visuals.backgrounds[mode]);
  return <main className="character-screen"><CharacterExperience key={`${mode}-${art.url}`} mode={mode} imageUrl={background?.url || art.url} imageDescription={art.description} profile={art.profile} session={sessions[mode]} gallery={visuals.images} backgroundId={background?.id} onBackground={id => visuals.selectBackground(mode, id)} onGenerateVisual={(kind, context) => visuals.generate(mode, kind, context)} imageJob={visuals.job} imageError={visuals.error} onCancelImage={visuals.cancel} active onEdit={editProfile} onBack={() => openMenu("image")} /></main>;
}
export default function CharacterStudio({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sessions = useRef({ chat: createChatSession(), story: createChatSession() });
  const pendingFocus = useRef<"result" | "profile" | null>(null);
  const app = useRef<HTMLDivElement>(null);
  const menu = pathname === "/ideal/chat" ? "chat" : pathname === "/ideal/story" ? "story" : "image";
  useEffect(() => {
    if (menu === "image") return;
    const viewport = window.visualViewport;
    const resize = () => app.current?.style.setProperty("--character-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => { viewport?.removeEventListener("resize", resize); window.removeEventListener("resize", resize); };
  }, [menu]);
  const result = useRef<HTMLElement>(null);
  const profileFields = useRef<HTMLFieldSetElement>(null);
  const [draft, setDraft] = useState({ name: "", age: "", gender: "", personality: "", concept: "" });
  function focusCreation(target: "result" | "profile") {
    requestAnimationFrame(() => {
      if (target === "profile") {
        profileFields.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        profileFields.current?.querySelector("input")?.focus({ preventScroll: true });
      } else result.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function openMenu(next: "image" | "chat" | "story") {
    if (next === "image") pendingFocus.current = "result";
    router.push(next === "image" ? "/ideal" : `/ideal/${next}`, { scroll: false });
    if (next === "image" && menu === "image") focusCreation("result");
    else if (next !== "image") window.scrollTo({ top: 0, behavior: "instant" });
  }
  function editProfile() {
    pendingFocus.current = "profile";
    if (menu === "image") focusCreation("profile");
    else router.push("/ideal", { scroll: false });
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
  const [status, setStatus] = useState("캐릭터 특성과 컨셉을 입력하고 생성해주세요.");
  const previousStyle = useRef<StyleProfile | null>(null);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    previous = useRef<Blob | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const pending = useRef<{ messages: Message[] } | null>(null);
  const visuals = useCharacterGallery(art && previous.current ? { blob: previous.current, profile: art.profile, style: art.style, description: art.description } : undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    return () => {
      if (art) URL.revokeObjectURL(art.url);
    };
  }, [art]);
  useEffect(() => {
    if (art) {
      result.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (messages.length)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    else bottom.current?.parentElement?.scrollTo({ top: 0 });
  }, [messages, art]);
  function cancel() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (pending.current) {
      setMessages(pending.current.messages);
      pending.current = null;
    }
    setBusy(false);
    setStatus("생성을 취소했습니다. 설정을 확인하고 다시 생성해주세요.");
  }
  function reset() {
    cancel();
    visuals.clear();
    setMessages([]);
    setArt(undefined);
    sessions.current = { chat: createChatSession(), story: createChatSession() };
    pendingFocus.current = "profile";
    router.replace("/ideal", { scroll: false });
    if (menu === "image") focusCreation("profile");
    setDraft({ name: "", age: "", gender: "", personality: "", concept: "" });
    previous.current = null;
    previousStyle.current = null;
    setError("");
    setStatus("새로운 캐릭터의 분위기를 설명해주세요.");
  }
  async function submit() {
    if (controller.current) return;
    const parsedProfile = characterProfileSchema.safeParse({ ...draft, age: Number(draft.age) });
    if (!parsedProfile.success) { setError("캐릭터 이름·나이·성별·성격·컨셉을 입력해주세요."); return; }
    const profile = parsedProfile.data;
    const user: Message = { role: "user", content: profile.concept },
      history = [...messages, user];
    const id = ++generation.current;
    pending.current = { messages };
    const abort = new AbortController();
    controller.current = abort;
    setMessages(history);
    setError("");
    sessions.current = { chat: createChatSession(), story: createChatSession() };
    setArt(undefined);
    visuals.clear();
    setBusy(true);
    setStatus(
      previous.current
        ? "이전 캐릭터를 참고해 요청한 부분을 수정하는 중…"
        : "취향을 정리하고 2D 캐릭터를 그리는 중…",
    );
    const timeout = setTimeout(() => abort.abort(), 280000);
    try {
      const body = new FormData();
      body.set("messages", JSON.stringify(history.slice(-13)));
      body.set("profile", JSON.stringify(profile));
      if (previous.current)
        body.set("image", previous.current, "previous-character.jpg");
      if (previous.current && previousStyle.current)
        body.set("previousStyle", previousStyle.current);
      const response = await fetch("/api/characters", {
        method: "POST",
        body,
        signal: abort.signal,
      });
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
      previous.current = blob;
      const parsedStyle = characterStyleProfile.safeParse(response.headers.get("X-Character-Style"));
      const style = parsedStyle.success ? parsedStyle.data : "neutral";
      previousStyle.current = style;
      pending.current = null;
      const url = URL.createObjectURL(blob);
      visuals.registerOriginal(blob, url, title);
      setArt({
        url,
        title,
        summary,
        prompt: response.headers.get("X-Character-Prompt") || "",
        style,
        profile,
        description: [history.find(m => m.role === "user")?.content.slice(0, 2000), history.filter(m => m.role === "user").slice(1).map(m => m.content).join("\n").slice(-1400), summary.slice(0, 1000), (response.headers.get("X-Character-Prompt") || "").slice(0, 1500)].filter(Boolean).join("\n").slice(0, 6000),
      });
      setMessages([...history, { role: "assistant", content: summary }]);
      setStatus("이미지 생성 완료 · JPG로 저장할 수 있습니다.");
    } catch (e) {
      if (id !== generation.current) return;
      pending.current = null;
      setError(
        abort.signal.aborted
          ? "생성 시간이 초과되었습니다. 다시 시도해주세요."
          : e instanceof Error
            ? e.message
            : "이미지를 생성하지 못했습니다.",
      );
      setStatus("요청을 완료하지 못했습니다.");
      setMessages(history.slice(0, -1));
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
            <span className="eyebrow">YOUR TYPE, YOUR CHARACTER</span>
            <h1>어떤 이상형을 그릴까요?</h1>
            <p>취향을 이야기하면, 한 장의 애니메이션 일러스트로.</p>
          </div>
          <fieldset ref={profileFields} className="character-profile character-image-profile" disabled={busy}>
            <legend>캐릭터 특성</legend>
            <p>이름과 성격을 먼저 정해주세요. 이미지·대화·이야기에 함께 반영됩니다.</p>
            <div className="character-profile-basics">
              <label>캐릭터 이름<input form="character-generation" name="name" required pattern=".*\S.*" maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="이름" /></label>
              <label>나이<input form="character-generation" name="age" type="number" required min={1} max={120} step={1} value={draft.age} onChange={event => setDraft({ ...draft, age: event.target.value })} placeholder="나이" /></label>
            </div>
            <label>성별<select aria-label="성별" form="character-generation" name="gender" required value={draft.gender} onChange={event => setDraft({ ...draft, gender: event.target.value })}>
              <option value="" disabled>선택해주세요</option>
              {CHARACTER_GENDERS.map(gender => <option key={gender} value={gender}>{gender}</option>)}
            </select></label>
            <label>성격<textarea aria-label="성격" form="character-generation" name="personality" required maxLength={1000} value={draft.personality} onChange={event => { event.target.setCustomValidity(""); setDraft({ ...draft, personality: event.target.value }); }} placeholder="캐릭터의 성격을 적어주세요" /></label>
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
            {error && (
              <p className="chat-error" role="alert">
                {error}
              </p>
            )}
            <form
              className="character-generation-actions"
              id="character-generation"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <button type="submit" disabled={busy}>
                {busy ? <><LoaderCircle className="spin" size={18} /> 캐릭터 생성 중…</> : <><Sparkles size={18} /> 캐릭터 생성</>}
              </button>
              {busy && <button type="button" className="character-generation-cancel" onClick={cancel} aria-label="이미지 생성 취소"><X size={17} /> 생성 취소</button>}
            </form>
            <p>입력한 컨셉으로 캐릭터를 생성합니다.</p>
          </div>
        </section>
        </div>
        <section className="chat-output character-output" ref={result}>
          <div className="character-output-heading"><ImagePlus size={16} aria-hidden="true" /><h2>캐릭터 이미지</h2></div>
          <div className={`character-canvas ${art ? "has-art" : ""}`} aria-busy={busy}>
            {art ? (
                <CharacterImage src={art.url} title={art.title} />
              ) : busy ? (
                <div className="character-loading">
                  <LoaderCircle className="spin" size={32} />
                  <h2>당신의 취향을 그리고 있어요.</h2>
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
          <div className="chat-progress" role="status">
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <span className="status-dot" />
            )}
            {status}
          </div>
          <div className="chat-download">
            <div>
              <strong>{art?.title || "나만의 2D 캐릭터"}</strong>
              <p>
                {art
                  ? `${CHARACTER_WIDTH} × ${CHARACTER_HEIGHT} · 9:16 · JPG`
                  : "헤어스타일 · 의상 · 표정 · 분위기를 자유롭게"}
              </p>
            </div>
            {art && !busy ? (
              <a
                className="character-download"
                href={art.url}
                download={`${art.title.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60) || "maite-character"}.jpg`}
              >
                <ArrowDownToLine size={16} />
                이미지 다운로드
              </a>
            ) : (
              <button disabled>
                <ArrowDownToLine size={16} />
                이미지 다운로드
              </button>
            )}
          </div>
        </section>
      </main>
      </div>
  );
  return (
    <StudioContext.Provider value={{ creation, art, sessions: sessions.current, openMenu, editProfile, visuals }}>
    <div ref={app} className={`chat-app character-app ${menu !== "image" ? "is-character-reading" : ""} ${menu === "chat" ? "is-character-chat" : ""}`}>
      <header className="chat-header">
        <Link href="/ideal" className="chat-brand">
          <Cuboid size={26} />
          maite<span>.</span>
        </Link>
        <StudioNav />
        <div>
          <button onClick={reset} aria-label="새 캐릭터 대화">
            <Plus size={16} />새 대화
          </button>
        </div>
      </header>
      {children}
      <footer className="chat-footer">
        컨셉에서 시작하는 나만의 애니메이션 캐릭터
        <span>결과는 이 탭에서 유지됩니다.</span>
      </footer>
    </div>
    </StudioContext.Provider>
  );
}
