"use client";
import { apiFetch } from "@/lib/platform/api";
import { timelineSchema, type Timeline } from "@/lib/chat/timeline";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUp, LoaderCircle, MessageCircle, Square } from "lucide-react";
import { readEvents } from "@/lib/chat/stream";
import type { CharacterContext } from "@/lib/chat/character";
import { createChatSession, type ChatSession } from "@/lib/chat/session";
import { illustrationContext, changedCharacterLocation, mentionsClothing, plainDialogue, outfitContext } from "@/lib/chat/presentation";
import type { CharacterImageJob, VisualKind } from "@/lib/characters/gallery";
import { storyStateSchema, type StoryState } from "@/lib/novel/state";
import { speechStyleSchema, type SpeechStyle } from "@/lib/chat/speech";
import { STORY_CHAPTER_LIMIT, storyComplete, storyProgress } from "@/lib/novel/series";
import { chatMemorySchema, type ChatMemory } from "@/lib/chat/memory";
import { startUsageTask, addUsageRecord, readUsageHeaders, finishUsageTask } from "@/lib/usage-store";

const storyPhases: Record<string, string> = { planning: "다음 전개 구상 중…", writing: "이야기 작성중", reviewing: "이야기 흐름 확인 중…", rewriting: "이야기 다듬는 중…", remembering: "이야기 마무리 중…" };

type Message = { role: "user" | "assistant"; content: string };
export default function LiveChat({ character, active = true, headingContent, session, onGenerateVisual, imageJob, imageError, onCancelImage }: {
  character?: CharacterContext; active?: boolean; headingContent?: ReactNode; session?: ChatSession;
  onGenerateVisual?: (kind: VisualKind, context: string) => Promise<void>;
  imageJob?: CharacterImageJob; imageError?: string; onCancelImage?: () => void;
}) {
  const localSession = useRef(createChatSession());
  const saved = session ?? localSession.current;
  const storyFinished = character?.mode === "story" && storyComplete(saved.storyState);
  const autoStarted = useRef(saved.started);
  const [messages, setMessages] = useState<Message[]>(saved.messages);
  const [input, setInput] = useState(saved.input);
  const [busy, setBusy] = useState(false);
  const [storyPhase, setStoryPhase] = useState("이야기 작성중");
  const [notice, setNotice] = useState(saved.notice);
  const committed = useRef<Message[]>(saved.committed);
  // Only the latest completed user/character exchange may enable an outfit job.
  const imageAvailable = saved.latestVisualChange ?? saved.latestClothingMentioned ?? mentionsClothing(committed.current.slice(-2));
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
    saved.messages = messages; saved.input = input; saved.notice = notice;
  }, [saved, messages, input, notice]);
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
    Object.assign(saved, { messages: [], committed: [], archive: [], input: "", notice: "", storyState: undefined, speechStyle: undefined, chatMemory: undefined, clothingDetected: undefined, latestClothingMentioned: undefined, visualDetected: undefined, latestVisualChange: undefined });
    followOutput.current = true;
    previousTurnLength.current = 0;
    setMessages([]); setInput(""); setNotice(""); setBusy(false);
  }
  async function submit(initialText?: string) {
    const text = (initialText ?? input).trim();
    const isStory = character?.mode === "story";
    const additionalConcept = isStory ? input.trim() : "";
    if (controller.current || !text || (isStory && storyComplete(saved.storyState) && !additionalConcept)) return;
    const storyState = saved.storyState;
    const timeline = saved.timeline?.state;
    pendingStoryConcept.current = additionalConcept;
    const history: Message[] = [...committed.current.slice(isStory ? -2 : -20).map(message => message.role === "assistant" ? { ...message, content: isStory ? plainDialogue(message.content).slice(-2000) : plainDialogue(message.content, "chat") } : message), { role: "user", content: text }];
    while (history.length > 1 && history.reduce((n, m) => n + m.content.length, 0) > 24000)
      history.splice(0, 2);
    const displayed = [...messages, { role: "user" as const, content: text }];
    const abort = new AbortController(), id = ++sequence.current;
    controller.current = abort; stopped.current = false;
    followOutput.current = true;
    setMessages([...displayed, { role: "assistant", content: "" }]);
    setInput(""); setNotice(""); setBusy(true);
    setStoryPhase("다음 전개 구상 중…");
    let answer = "", completed = false;
    let nextChapter: { text: string; state: StoryState } | undefined;
    let nextSpeech: SpeechStyle | undefined;
    let nextMemory: ChatMemory | undefined;
    let clothingDetected: boolean | undefined;
    let locationChanged = false;
    let nextTimeline: Timeline | undefined;
    const usageTask = startUsageTask(isStory ? `이야기 ${(storyState?.chapter ?? 0) + 1}회차` : "대화");
    let usageCompleted = false;
    const timeout = setTimeout(() => abort.abort(), 160000);
    try {
      const requestBody = { messages: history, character, ...(timeline ? { timeline } : {}), ...(isStory && storyState ? { storyState } : {}),
        ...(additionalConcept ? { additionalConcept } : {}),
        ...(!isStory && character && saved.chatMemory ? { chatMemory: saved.chatMemory } : {}),
        ...(!isStory && character && saved.speechStyle ? { speechStyle: saved.speechStyle } : {}) };
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
        setMessages([...displayed, { role: "assistant", content: prose }]);
      }
      committed.current = [...history, { role: "assistant", content: prose }];
      saved.archive = [...(saved.archive ?? saved.committed), { role: "user", content: text }, { role: "assistant", content: prose }];
      saved.committed = committed.current;
      if (!isStory && nextSpeech) saved.speechStyle = nextSpeech;
      locationChanged ||= changedCharacterLocation(saved.chatMemory, nextMemory);
      if (!isStory && nextMemory) saved.chatMemory = nextMemory;
      if (!isStory) {
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
      abort.abort();
      if (id === sequence.current) { controller.current = null; setBusy(false); }
    }
  }
  return (
    <section className="live-chat" aria-label="AI 실시간 대화">
      <div className="live-chat-heading">
        {headingContent ?? <div><h2><MessageCircle size={18} /> {character ? character.mode === "story" ? "함께 쓰는 이야기" : `${character.name}와 대화하기` : "AI와 대화하기"}</h2>{character?.mode !== "story" && <p>{character ? "그림 속 캐릭터와 나만의 장면을 이어가세요." : "궁금한 점이나 떠오르는 이야기를 나눠보세요."}</p>}</div>}
        <button type="button" onClick={reset} aria-label="AI 대화 초기화" title={saved.timeline ? "이 화면의 기록을 초기화합니다. 공통 시간선은 유지됩니다." : undefined}>{character?.mode === "story" ? "새 이야기" : "새 대화"}</button>
      </div>
      <div className="live-chat-log" ref={log} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions text" onScroll={event => {
        const element = event.currentTarget;
        followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      }}>
        {!messages.length && character?.mode !== "story" && <div className="live-chat-empty"><p>첫마디로 둘만의 이야기를 시작해보세요.</p><button className="character-start" type="button" onClick={() => setInput("안녕. 우리 처음 만난 순간부터 시작해볼까?")}>첫인사 준비하기</button></div>}
        {messages.map((m, i) => character?.mode === "story" && m.role === "user" ? null : <article className={`chat-message ${m.role}`} key={i}><span>{m.role === "user" ? "나" : character?.mode === "story" ? "이야기" : character?.name || "AI"}</span><p>{(m.role === "assistant" ? plainDialogue(m.content, character?.mode === "story" ? "prose" : "chat") : m.content) || (character?.mode === "story" ? storyPhase : "대화 작성중")}</p></article>)}
      </div>
      {notice && <p className="chat-error" role="status">{notice}</p>}
      {imageJob && <div className="character-visual-status" role="status"><span><LoaderCircle className="spin" size={15} />{imageJob.kind === "illustration" ? "삽화 생성 중…" : "이미지 생성 중…"}</span><button type="button" onClick={onCancelImage} aria-label="이미지 생성 취소">취소</button></div>}
      {imageError && <p className="character-visual-error" role="alert">{imageError}</p>}
      {onGenerateVisual && character && (character.mode === "story" || saved.visualDetected || saved.clothingDetected || mentionsClothing(committed.current)) && <button className="character-visual-button" type="button" disabled={busy || !!imageJob || (character.mode === "chat" && !imageAvailable) || !committed.current.some(message => message.role === "assistant" && message.content.trim())} onClick={() => {
        if (busy || imageJob || (character.mode === "chat" && !imageAvailable)) return;
        void onGenerateVisual(character.mode === "story" ? "illustration" : "outfit", character.mode === "story" ? illustrationContext(committed.current, saved.storyState) : outfitContext(committed.current, saved.chatMemory));
      }}>{character.mode === "story" ? "삽화 생성" : "이미지 생성"}</button>}
      {character?.mode === "story" && <label className="story-concept-input"><span>다음 이야기 컨셉</span><input aria-label="다음 이야기 컨셉" placeholder="추가하고 싶은 사건이나 설정 (선택)" maxLength={1000} value={input} disabled={busy || !!imageJob} onChange={event => setInput(event.target.value)} /><small>{input.trim() ? "추가 컨셉을 반영해 다음 회차부터 10편으로 다시 구성합니다." : ""}</small></label>}
      {character?.mode === "story" ? <button className="story-next-button" type="button" disabled={busy || !!imageJob || (storyFinished && !input.trim())} aria-busy={busy} onClick={() => {
        void submit(committed.current.length
          ? "앞선 이야기의 사건과 인물 관계를 이어서 다음 장면을 써줘. 이전 내용을 반복하지 말고 자연스럽게 이어줘."
          : "설정에 맞춰 첫 장면부터 이야기를 시작해줘.");
      }}>{storyFinished && !input.trim() && !busy ? "이야기 완결" : "다음 이야기"} {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button> : <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="AI에게 보낼 메시지" placeholder="캐릭터에게 이야기해보세요…" maxLength={2000} value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
        }} />
        <div><span>{input.length}/2000</span>{busy ? <button type="button" aria-label="AI 응답 중지" onClick={(event) => { event.preventDefault(); stopped.current = true; controller.current?.abort(); }}><Square size={14} /></button> : <button type="submit" aria-label="AI 메시지 보내기" disabled={!input.trim()}><ArrowUp size={18} /></button>}</div>
      </form>}
      <p className="live-chat-status" role="status">{busy ? <><LoaderCircle size={13} className="spin" /> {character?.mode === "story" ? `${pendingStoryConcept.current ? 1 : Math.min(storyProgress(saved.storyState) + 1, STORY_CHAPTER_LIMIT)}/${STORY_CHAPTER_LIMIT}편 · ${storyPhase}` : "대화 작성중"}</> : character?.mode === "story" ? `${Math.min(storyProgress(saved.storyState), STORY_CHAPTER_LIMIT)}/${STORY_CHAPTER_LIMIT}편 · ${storyFinished ? "완결" : "AI가 만드는 이야기"}` : "AI 캐릭터의 허구의 대화·이야기"}</p>
    </section>
  );
}
