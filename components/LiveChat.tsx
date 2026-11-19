"use client";
import type { ImageSceneSelection } from "@/lib/characters/visual";
import { jsonApi } from "@/lib/platform/commerce";
import { mergeCheckins, type Checkin } from "@/lib/notifications/checkins";
import { agreedVisualDestination, updateVisualScene, rebuildVisualScene, visualSceneSchema, type VisualScene } from "@/lib/chat/visual-scene";
import { apiFetch } from "@/lib/platform/api";
import { timelineSchema, type Timeline } from "@/lib/chat/timeline";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, LoaderCircle, MessageCircle, Square } from "lucide-react";
import { readEvents } from "@/lib/chat/stream";
import type { CharacterContext } from "@/lib/chat/character";
import { createChatSession, type ChatSession } from "@/lib/chat/session";
import { illustrationContext, changedCharacterLocation, mentionsClothing, plainDialogue, outfitContext } from "@/lib/chat/presentation";
import type { CharacterImageJob, VisualKind, IllustrationScene } from "@/lib/characters/gallery";
import { storyStateSchema, type StoryState } from "@/lib/novel/state";
import { speechStyleSchema, type SpeechStyle } from "@/lib/chat/speech";
import { STORY_CHAPTER_LIMIT, storyComplete } from "@/lib/novel/series";
import { chatMemorySchema, type ChatMemory } from "@/lib/chat/memory";
import { startUsageTask, addUsageRecord, readUsageHeaders, finishUsageTask } from "@/lib/usage-store";

import { useActionConfirm } from "./ActionConfirm";
import { accountEnabled } from "@/lib/account/client";
import { useAccount } from "./AccountProvider";
import { userDisplayName } from "@/lib/chat/identity";
import { HEART_COST } from "@/lib/account/policy";
import { saveChapter } from "@/lib/account/reading-progress";

const storyPhases: Record<string, string> = { planning: "다음 전개 구상 중…", writing: "이야기 작성중", reviewing: "이야기 흐름 확인 중…", rewriting: "이야기 다듬는 중…", remembering: "이야기 마무리 중…" };

type Message = { role: "user" | "assistant"; content: string; checkinId?: string };
const timelineRequests = new WeakMap<object, AbortController>();
export default function LiveChat({ character, characterDocumentId, active = true, headingContent, imageOptions, session, onGenerateVisual, imageJob, imageError, onCancelImage }: {
  characterDocumentId?: string; character?: CharacterContext; active?: boolean; headingContent?: ReactNode; imageOptions?:ReactNode; session?: ChatSession;
  onGenerateVisual?: (kind: VisualKind, context: string, scene?: IllustrationScene, selection?: ImageSceneSelection) => Promise<void>;
  imageJob?: CharacterImageJob; imageError?: string; onCancelImage?: () => void;
}) {
  const localSession = useRef(createChatSession());
  const confirm = useActionConfirm(); const { account, user } = useAccount();
  const saved = session ?? localSession.current;
  const sceneStorageKey = characterDocumentId ? `maite-visual-scene:${user?.id || "demo"}:${characterDocumentId}` : undefined;
  const [sceneMemory, setSceneMemory] = useState<VisualScene>(() => {
    let local: VisualScene | undefined;
    try { const parsed = visualSceneSchema.safeParse(JSON.parse(sceneStorageKey ? localStorage.getItem(sceneStorageKey) || "null" : "null")); if (parsed.success) local = parsed.data; } catch { /* Device storage can be unavailable. */ }
    const remote = saved.visualScene;
    return local && (!remote || local.turn > remote.turn) ? local : remote ?? rebuildVisualScene(saved.archive ?? saved.committed, saved.chatMemory);
  });
  useEffect(() => {
    if (character?.mode !== "chat") return;
    if (!sceneMemory.location && !sceneMemory.destination && !sceneMemory.outfit) return;
    saved.visualScene = sceneMemory;
    try { if (sceneStorageKey) localStorage.setItem(sceneStorageKey, JSON.stringify(sceneMemory)); } catch { /* Session/cloud snapshots still retain this state. */ }
  }, [sceneMemory, sceneStorageKey, saved, character?.mode]);
  const storyFinished = character?.mode === "story" && storyComplete(saved.storyState);
  const autoStarted = useRef(saved.started);
  const [messages, setMessages] = useState<Message[]>(saved.messages);
  const [storyPage, setStoryPage] = useState(saved.storyPage ?? Math.max(0, saved.messages.filter(m => m.role === "assistant" && m.content.trim()).length - 1));
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [input, setInput] = useState(saved.input);
  const [busy, setBusy] = useState(false);
  const [unreadGreetingIds,setUnreadGreetingIds]=useState<string[]>([]);
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    if (!accountEnabled() || !characterDocumentId || character?.mode !== "chat" || !active || busyRef.current) return;
    let alive = true;
    const refresh = () => {
      if (busyRef.current) return;
      void jsonApi(`/api/notifications?document=${characterDocumentId}`).then(data => {
        if (!alive || busyRef.current || !Array.isArray(data.messages)) return;
        const rows = data.messages as Checkin[];
        saved.archive = mergeCheckins(saved.archive ?? saved.committed, rows);
        const turns = saved.archive.filter(message => message.role === "user").length;
        const pendingGreeting = rows.filter(row => row.user_turns === turns).slice(-1);
        committed.current = mergeCheckins(committed.current, pendingGreeting);
        saved.committed = committed.current;
        setMessages(current => mergeCheckins(current, rows));
        setUnreadGreetingIds(rows.filter(row=>row.read_at===null).map(row=>row.id));
      }).catch(() => undefined);
    };
    refresh(); const timer = setInterval(refresh, 60000);
    const visible=()=>{if(!document.hidden)refresh();};
    window.addEventListener("maite-checkins-refresh", refresh); window.addEventListener("maite-foreground", refresh);document.addEventListener("visibilitychange",visible);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("maite-checkins-refresh", refresh); window.removeEventListener("maite-foreground", refresh);document.removeEventListener("visibilitychange",visible); };
  }, [characterDocumentId, active, character?.mode, busy]);
  useEffect(()=>{
    if(!characterDocumentId||!active||busy||character?.mode!=="chat"||document.hidden)return;
    const ids=unreadGreetingIds.filter(id=>messages.some(message=>message.checkinId===id)).slice(0,200);
    if(!ids.length)return;
    // Acknowledge only greetings rendered in this visible character chat. New arrivals
    // are excluded from the receipt, so a concurrent arrival retains its marker.
    let cancelled=false;
    const frame=requestAnimationFrame(()=>{
      if(cancelled||document.hidden)return;
      void jsonApi("/api/notifications",{action:"read",documentId:characterDocumentId,ids}).then(()=>{
        setUnreadGreetingIds(current=>current.filter(id=>!ids.includes(id)));
        window.dispatchEvent(new Event("maite-checkins-read"));
      }).catch(()=>undefined);
    });
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[unreadGreetingIds,messages,active,busy,characterDocumentId,character?.mode]);
  const [storyPhase, setStoryPhase] = useState("이야기 작성중");
  const [notice, setNotice] = useState(saved.notice);
  const committed = useRef<Message[]>(saved.committed);
  // Scene detection supplies defaults only; it never gates manual image creation.
  const latestExchange = committed.current.slice(-2);
  const destination = latestExchange[0]?.role === "user" && latestExchange[1]?.role === "assistant" && !latestExchange[1].checkinId ? agreedVisualDestination(latestExchange[0].content, latestExchange[1].content) : undefined;
  const controller = useRef<AbortController | null>(null);
  const pendingStoryConcept = useRef("");
  const sequence = useRef(0), stopped = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const previousTurnLength = useRef(0);
  useEffect(() => {
    const stop = () => { stopped.current = true; controller.current?.abort(); };
    window.addEventListener("maite-stop-chat", stop); return () => window.removeEventListener("maite-stop-chat", stop);
  }, []);
  useEffect(() => {
    saved.messages = messages; saved.input = input; saved.notice = notice; saved.storyPage = storyPage;
  }, [saved, messages, input, notice, storyPage]);
  useEffect(() => () => {
    sequence.current++;
    if (controller.current) {
      if (!saved.messages.at(-1)?.content.trim()) {
        saved.input = character?.mode === "story" ? pendingStoryConcept.current : saved.messages.at(-2)?.content || "";
        saved.messages = saved.messages.slice(0, -2);
      }
      saved.notice = "화면을 이동해 응답을 중지했습니다.";
      controller.current.abort();
    }
  }, [saved]);
  useEffect(() => {
    if (character?.mode !== "story" || !active || autoStarted.current) return;
    // Defer until mount settles so development Strict Mode does not send two requests.
    const timer = setTimeout(() => { autoStarted.current = true; saved.started = true; void submit("설정에 맞춰 첫 장면부터 이야기를 시작해줘."); }, 0);
    return () => clearTimeout(timer);
  }, [character, active]);
  useEffect(() => {
    const element = log.current;
    if (!element) return;
    if (character?.mode === "story") {
      // Start each installment at its first line instead of chasing streamed tokens.
      if (messages.length !== previousTurnLength.current) {
        const last = element.lastElementChild;
        if (last) element.scrollTop += last.getBoundingClientRect().top - element.getBoundingClientRect().top;
      }
    } else if (followOutput.current) element.scrollTop = element.scrollHeight;
    previousTurnLength.current = messages.length;
  }, [messages, character?.mode]);
  function reset() {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    committed.current = [];
    Object.assign(saved, { messages: [], committed: [], archive: [], input: "", notice: "", storyState: undefined, documentId: undefined, lastJobId: undefined, speechStyle: undefined, speechPreference: undefined, chatMemory: undefined, clothingDetected: undefined, latestClothingMentioned: undefined, visualDetected: undefined, latestVisualChange: undefined });
    setSceneMemory({ turn: 0 }); saved.visualScene = undefined;
    setStoryPage(0); saved.storyPage = 0;
    followOutput.current = true;
    previousTurnLength.current = 0;
    setMessages([]); setInput(""); setNotice(""); setBusy(false);
  }
  async function submit(initialText?: string) {
    const text = (initialText ?? input).trim();
    const isStory = character?.mode === "story";
    const additionalConcept = isStory ? input.trim() : "";
    if (controller.current || !text || (isStory && storyComplete(saved.storyState) && !additionalConcept)) return;
    if (isStory && accountEnabled() && (account?.wallet.transferable ?? 0) + (account?.wallet.bonus ?? 0) < HEART_COST.story) { setNotice("하트가 부족해요. 스토어에서 충전한 뒤 다시 시도해주세요."); return; }
    if (isStory && accountEnabled() && !await confirm({ title: "다음 이야기를 만들까요?", description: additionalConcept ? "추가한 컨셉을 반영해 이야기를 이어가요." : "최신 회차의 사건과 관계를 이어가요.", lines: [{ label: "이야기 생성", value: `${HEART_COST.story}하트` }, { label: "생성 후 보유 하트", value: `${(account?.wallet.transferable ?? 0) + (account?.wallet.bonus ?? 0) - HEART_COST.story}하트` }], confirmLabel: "이야기 만들기" })) return;
    if (controller.current) return;
    if (saved.timeline && timelineRequests.has(saved.timeline)) { setNotice("진행 중인 대화나 이야기 생성이 끝나면 이어서 요청해주세요."); return; }
    const storyState = saved.storyState;
    const timeline = saved.timeline?.state;
    pendingStoryConcept.current = additionalConcept;
    const history: Message[] = [...committed.current.slice(isStory ? -2 : -20).map(message => ({ role: message.role, content: message.role === "assistant" ? isStory ? plainDialogue(message.content).slice(-2000) : plainDialogue(message.content, "chat") : message.content })), { role: "user", content: text }];
    while (history.length > 1 && history.reduce((n, m) => n + m.content.length, 0) > 24000)
      history.splice(0, 2);
    const displayed = [...messages, { role: "user" as const, content: text }];
    const abort = new AbortController(), id = ++sequence.current;
    controller.current = abort; stopped.current = false;
    if (saved.timeline) timelineRequests.set(saved.timeline, abort);
    followOutput.current = true;
    setMessages([...displayed, { role: "assistant", content: "" }]);
    setInput(""); setNotice(""); setBusy(true);
    setStoryPhase("다음 전개 구상 중…");
    let answer = "", completed = false;
    let nextChapter: { text: string; state: StoryState } | undefined;
    let nextSpeech: SpeechStyle | undefined;
    let nextPreference: SpeechStyle | undefined;
    let nextMemory: ChatMemory | undefined;
    let clothingDetected: boolean | undefined;
    let locationChanged = false;
    let nextTimeline: Timeline | undefined;
    const usageTask = startUsageTask(isStory ? `이야기 ${(storyState?.chapter ?? 0) + 1}회차` : "대화");
    let usageCompleted = false;
    const timeout = setTimeout(() => abort.abort(), isStory ? 280000 : 160000);
    try {
      const requestBody = { messages: history, character, ...(timeline ? { timeline } : {}), ...(isStory && storyState ? { storyState } : {}),
        ...(additionalConcept ? { additionalConcept } : {}),
        ...(!isStory && character && saved.chatMemory ? { chatMemory: saved.chatMemory } : {}),
        ...(!isStory && character && saved.speechStyle ? { speechStyle: saved.speechStyle } : {}),
        ...(!isStory && character && saved.speechPreference ? { speechPreference: saved.speechPreference } : {}) };
      while (history.length > 1 && new TextEncoder().encode(JSON.stringify(requestBody)).length > 100000) history.splice(0, 2);
      const response = await apiFetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Track-Usage": "1" },
        body: JSON.stringify(requestBody), signal: abort.signal,
      });
      readUsageHeaders(usageTask, response);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "AI에 연결하지 못했습니다.");
      }
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream"))
        throw new Error("응답 형식이 올바르지 않습니다.");
      for await (const event of readEvents(response.body)) {
        if (event.type === "usage") { addUsageRecord(usageTask, event.record); continue; }
        if (id !== sequence.current) return;
        if (event.type === "timeline") {
          if (!timeline || nextTimeline || event.expectedRevision !== timeline.revision) throw new Error("Invalid shared timeline");
          nextTimeline = timelineSchema.parse(event.state);
          if (nextTimeline.revision !== timeline.revision + 1) throw new Error("Invalid shared timeline revision");
        } else if (isStory && event.type === "phase" && typeof event.phase === "string") {
          setStoryPhase(storyPhases[event.phase] || "이야기 작성중");
        } else if (isStory && event.type === "chapter") {
          if (nextChapter || typeof event.text !== "string" || !event.text.trim() || event.text.length > 8000)
            throw new Error("이야기 응답 형식이 올바르지 않습니다.");
          const state = storyStateSchema.parse(event.state);
          if (event.expectedChapter !== (storyState?.chapter ?? 0) || state.chapter !== (storyState?.chapter ?? 0) + 1 || state.previousProse !== event.text)
            throw new Error("이야기 회차가 일치하지 않습니다. 다시 시도해주세요.");
          if ((state.seriesStartChapter ?? 0) !== (additionalConcept ? storyState?.chapter ?? 0 : storyState?.seriesStartChapter ?? 0))
            throw new Error("이야기 계획이 일치하지 않습니다. 다시 시도해주세요.");
          nextChapter = { text: event.text, state };
        } else if (!isStory && event.type === "location" && typeof event.changed === "boolean") {
          locationChanged = event.changed;
        } else if (!isStory && event.type === "clothing" && typeof event.mentioned === "boolean") {
          clothingDetected = event.mentioned;
        } else if (!isStory && event.type === "memory") {
          const state = chatMemorySchema.parse(event.state);
          if (nextMemory || event.expectedTurn !== (saved.chatMemory?.turn ?? 0) || state.turn !== (saved.chatMemory?.turn ?? 0) + 1)
            throw new Error("대화 기억이 일치하지 않습니다. 다시 시도해주세요.");
          nextMemory = state;
        } else if (!isStory && event.type === "speech") {
          const parsed = speechStyleSchema.safeParse(event.speechStyle);
          if (!parsed.success) throw new Error("대화 응답 형식이 올바르지 않습니다.");
          nextSpeech = parsed.data;
          if (event.preference !== undefined) nextPreference = speechStyleSchema.parse(event.preference);
        } else if (!isStory && event.type === "delta" && typeof event.text === "string") {
          answer += event.text;
          if (answer.length > 8000) throw new Error("응답이 너무 길어 중단했습니다.");
          setMessages([...displayed, { role: "assistant", content: plainDialogue(answer, "chat") }]);
        } else if (event.type === "done") { completed = true; break; }
        else if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "응답이 중단되었습니다.");
      }
      const prose = plainDialogue(isStory ? nextChapter?.text ?? "" : answer, isStory ? "prose" : "chat").trim();
      if (!completed || !prose) throw new Error("응답이 중단되었습니다. 다시 시도해주세요.");
      if (timeline && saved.timeline?.state.revision !== timeline.revision) throw new Error("공통 시간선이 변경되었습니다. 다시 시도해주세요.");
      if (nextTimeline && saved.timeline) saved.timeline.state = nextTimeline;
      if (isStory && nextChapter) {
        saved.storyState = nextChapter.state;
        const latestPage = displayed.filter(m => m.role === "assistant" && m.content.trim()).length;
        saved.storyPage = latestPage; setStoryPage(latestPage);
        saved.documentId ??= crypto.randomUUID();
        saved.lastJobId = response.headers.get("X-Job-Id") ?? undefined;
        setMessages([...displayed, { role: "assistant", content: prose }]);
      }
      committed.current = [...history, { role: "assistant", content: prose }];
      saved.archive = [...(saved.archive ?? saved.committed), { role: "user", content: text }, { role: "assistant", content: prose }];
      saved.committed = committed.current;
      if (!isStory && nextSpeech) saved.speechStyle = nextSpeech;
      if (!isStory && nextPreference) saved.speechPreference = nextPreference;
      locationChanged ||= changedCharacterLocation(saved.chatMemory, nextMemory);
      if (!isStory && nextMemory) saved.chatMemory = nextMemory;
      if (!isStory) {
        const scene = updateVisualScene(saved.visualScene ?? sceneMemory, text, prose, nextMemory);
        const sceneChanged = scene.location !== (saved.visualScene ?? sceneMemory).location || scene.outfit !== (saved.visualScene ?? sceneMemory).outfit;
        saved.visualScene = scene; setSceneMemory(scene);
        try { if (sceneStorageKey) localStorage.setItem(sceneStorageKey, JSON.stringify(scene)); } catch { /* Keep the session state if device storage is full. */ }
        locationChanged ||= sceneChanged || !!scene.destination;
        saved.latestClothingMentioned = clothingDetected ?? mentionsClothing(committed.current.slice(-2));
        saved.latestVisualChange = saved.latestClothingMentioned || locationChanged;
        if (saved.latestVisualChange) saved.visualDetected = true;
        if (saved.latestClothingMentioned) saved.clothingDetected = true;
      }
      usageCompleted = true;
      window.dispatchEvent(new Event("maite-session-committed"));
      window.dispatchEvent(new Event("maite-account-refresh"));
    } catch (error) {
      if (id !== sequence.current) return;
      setNotice(stopped.current ? "응답을 중지했습니다." : abort.signal.aborted ? "응답 시간이 초과되었습니다. 다시 시도해주세요." : error instanceof Error ? error.message : "대화 중 오류가 발생했습니다.");
      if (!answer) { setMessages(messages); setInput(isStory ? additionalConcept : text); }
      // Partial replies remain visible, but incomplete turns are not sent as history.
    } finally {
      finishUsageTask(usageTask, usageCompleted ? "completed" : abort.signal.aborted ? "cancelled" : "failed");
      clearTimeout(timeout);
      if (saved.timeline && timelineRequests.get(saved.timeline) === abort) timelineRequests.delete(saved.timeline);
      abort.abort();
      if (id === sequence.current) { controller.current = null; setBusy(false); }
    }
  }
  const isStory = character?.mode === "story";
  const chapters = messages.filter(m => m.role === "assistant" && m.content.trim());
  const pageIndex = Math.min(storyPage, Math.max(0, chapters.length - 1));
  const firstEpisode = Math.max(0, (saved.storyState?.chapter ?? 0) - chapters.length);
  useEffect(() => {
    if (isStory && active && chapters.length && saved.documentId && !busy) saveChapter(account?.userId ?? "demo", saved.documentId, firstEpisode + pageIndex + 1);
  }, [isStory, active, chapters.length, saved.documentId, firstEpisode, pageIndex, busy, account?.userId]);
  const imageContext = isStory ? illustrationContext(chapters.slice(0, pageIndex + 1), pageIndex === chapters.length - 1 ? saved.storyState : undefined) : outfitContext(committed.current, saved.chatMemory, { ...sceneMemory, destination });

  const visibleMessages = isStory ? chapters.length ? [chapters[pageIndex]] : messages.filter(m => m.role === "assistant") : messages;
  function turnPage(delta: number) {
    if (!isStory) return;
    setStoryPage(Math.max(0, Math.min(chapters.length - 1, pageIndex + delta)));
  }
  useEffect(() => {
    if (isStory && log.current) log.current.scrollTop = 0;
  }, [isStory, pageIndex]);
  return (
    <section className="live-chat" aria-label="AI 실시간 대화">
      <div className="live-chat-heading">
        {headingContent ?? <div><h2><MessageCircle size={18} /> {character ? character.mode === "story" ? "함께 쓰는 이야기" : `${character.name}와 대화하기` : "AI와 대화하기"}</h2>{character?.mode !== "story" && <p>{character ? "그림 속 캐릭터와 나만의 장면을 이어가세요." : "궁금한 점이나 떠오르는 이야기를 나눠보세요."}</p>}</div>}
        
      </div>
      {isStory && chapters.length > 1 && <div className="story-page-navigation" role="group" aria-label="이야기 페이지 이동">
        <button type="button" aria-label="이전 이야기 보기" disabled={pageIndex === 0} onClick={() => turnPage(-1)}><ChevronLeft size={18} /></button>
        <button type="button" aria-label="다음 이야기 보기" disabled={pageIndex === chapters.length - 1} onClick={() => turnPage(1)}><ChevronRight size={18} /></button>
      </div>}
      <div className={`live-chat-log ${isStory ? "story-pages" : ""}`} ref={log} tabIndex={isStory ? 0 : undefined}
        onKeyDown={event => { if (isStory && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); turnPage(event.key === "ArrowLeft" ? -1 : 1); } }}
        onTouchStart={event => { swipeStart.current = isStory && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }}
        onTouchCancel={() => { swipeStart.current = null; }}
        onTouchEnd={event => {
          const start = swipeStart.current; swipeStart.current = null;
          if (!start || !event.changedTouches.length || event.touches.length) return;
          const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turnPage(dx < 0 ? 1 : -1);
        }} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions text" onScroll={event => {
        const element = event.currentTarget;
        followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      }}>
        {visibleMessages.map((m, i) => {
          if (character?.mode === "story" && m.role === "user") return null;
          const label = m.role === "user" ? character ? userDisplayName(character, saved.storyState?.seriesConcept) : account?.profile?.display_name || "당신" : character?.mode === "story" ? `이야기 #${firstEpisode + pageIndex + 1}` : character?.name || "AI";
          const text = m.role === "assistant" ? plainDialogue(m.content, isStory ? "prose" : "chat") : m.content;
          return <article className={`chat-message ${m.role} ${isStory ? "story-page" : ""}`} key={isStory ? pageIndex : i}><span>{label}</span><p>{text || (isStory ? storyPhase : busy && m.role === "assistant" ? <span className="chat-typing-dots" role="status" aria-label="응답을 작성하고 있어요"><i aria-hidden="true"/><i aria-hidden="true"/><i aria-hidden="true"/></span> : "")}</p></article>;
        })}
      </div>
      {notice && <p className="chat-error" role="status">{notice}</p>}
      {onGenerateVisual&&imageOptions}
      {imageJob && <div className="character-visual-status" role="status"><span>{imageJob.kind === "illustration" ? "삽화를 그리고 있어요" : "그림을 그리고 있어요"}</span><button type="button" onClick={onCancelImage} aria-label="이미지 생성 취소">취소</button></div>}
      {imageError && <p className="character-visual-error" role="alert">{imageError}</p>}
      {onGenerateVisual && character && (character.mode === "chat" || committed.current.some(message => message.role === "assistant" && message.content.trim())) && <button className="character-visual-button" type="button" aria-busy={!!imageJob} aria-label={character.mode === "story" ? "삽화 생성" : "이미지 생성"} disabled={busy || !!imageJob} onClick={() => {
        if (busy || imageJob) return;
        void onGenerateVisual(character.mode === "story" ? "illustration" : "outfit", imageContext, character.mode === "story" && saved.documentId ? { novelId: saved.documentId, chapter: firstEpisode + pageIndex + 1 } : undefined);
      }}><span className="visual-button-label">{imageJob && <LoaderCircle className="spin" size={16} aria-hidden="true"/>}{imageJob ? "그림을 그리고 있어요" : character.mode === "story" ? "삽화 생성" : "이미지 생성"}{accountEnabled() && !imageJob && <span> · {character.mode === "story" ? 50 : 30} ♥</span>}</span></button>}
      {character?.mode === "story" && <label className="story-concept-input"><span>다음 이야기 컨셉</span><input aria-label="다음 이야기 컨셉" placeholder="추가하고 싶은 사건이나 설정 (선택)" maxLength={1000} value={input} disabled={busy || !!imageJob} onChange={event => setInput(event.target.value)} /><small>{input.trim() ? `추가 컨셉을 반영해 이야기 #${(saved.storyState?.chapter ?? 0) + 1}부터 ${STORY_CHAPTER_LIMIT}편으로 다시 구성합니다. 번호는 이어집니다.` : ""}</small></label>}
      {character?.mode === "story" ? <button className="story-next-button" type="button" disabled={busy || !!imageJob || (storyFinished && !input.trim())} aria-busy={busy} onClick={() => {
        void submit(committed.current.length
          ? "앞선 이야기의 사건과 인물 관계를 이어서 다음 장면을 써줘. 이전 내용을 반복하지 말고 자연스럽게 이어줘."
          : "설정에 맞춰 첫 장면부터 이야기를 시작해줘.");
      }}>{busy ? "이야기를 쓰고 있어요" : storyFinished && !input.trim() ? "이야기 완결" : "다음 이야기"} {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button> : <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="AI에게 보낼 메시지" placeholder="캐릭터에게 이야기해보세요…" maxLength={2000} value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
        }} />
        <div><span>{input.length}/2000</span>{busy ? <button type="button" aria-label="AI 응답 중지" onClick={(event) => { event.preventDefault(); stopped.current = true; controller.current?.abort(); }}><Square size={14} /></button> : <button type="submit" aria-label="AI 메시지 보내기" disabled={!input.trim()}><ArrowUp size={18} /></button>}</div>
      </form>}
      {isStory && busy && <div className="story-generation-status" role="status"><span>{storyPhase}</span><button type="button" aria-label="이야기 생성 취소" onClick={() => { stopped.current = true; controller.current?.abort(); }}>취소</button></div>}
    </section>
  );
}
