"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  Cuboid,
  ImagePlus,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import StudioNav from "./StudioNav";
import LiveChat from "./LiveChat";
import {
  MAX_CHARACTER_IMAGE,
  CHARACTER_WIDTH,
  CHARACTER_HEIGHT,
  CHARACTER_STYLES,
  CHARACTER_STYLE_LABELS,
  characterStyleProfile,
} from "@/lib/characters/schema";

type Message = { role: "user" | "assistant"; content: string };
type StyleProfile = keyof typeof CHARACTER_STYLES;
type Artwork = { url: string; title: string; summary: string; prompt: string; style: StyleProfile };
export default function CharacterStudio() {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState("");
  const [art, setArt] = useState<Artwork>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useState<"result" | "reference" | "prompt">("result"),
    [status, setStatus] = useState("키워드를 보내면 나만의 캐릭터를 그립니다.");
  const [referenceStyle, setReferenceStyle] = useState<"female" | "male">("female");
  const previousStyle = useRef<StyleProfile | null>(null);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    previous = useRef<Blob | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const pending = useRef<{ messages: Message[]; input: string } | null>(null);
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
    if (messages.length)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    else bottom.current?.parentElement?.scrollTo({ top: 0 });
  }, [messages]);
  function cancel() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (pending.current) {
      setMessages(pending.current.messages);
      setInput(pending.current.input);
      pending.current = null;
    }
    setBusy(false);
    setStatus("생성을 취소했습니다. 설명을 다시 보내주세요.");
  }
  function reset() {
    cancel();
    setMessages([]);
    setInput("");
    setArt(undefined);
    previous.current = null;
    previousStyle.current = null;
    setError("");
    setView("result");
    setStatus("새로운 캐릭터의 분위기를 설명해주세요.");
  }
  async function submit() {
    if (busy || !input.trim()) return;
    const user: Message = { role: "user", content: input.trim() },
      history = [...messages, user];
    const id = ++generation.current;
    pending.current = { messages, input: user.content };
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setMessages(history);
    setInput("");
    setError("");
    setArt(undefined);
    setBusy(true);
    setView("result");
    setStatus(
      previous.current
        ? "이전 캐릭터를 참고해 요청한 부분을 수정하는 중…"
        : "취향을 정리하고 2D 캐릭터를 그리는 중…",
    );
    const timeout = setTimeout(() => abort.abort(), 280000);
    try {
      const body = new FormData();
      body.set("messages", JSON.stringify(history.slice(-13)));
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
      setArt({
        url: URL.createObjectURL(blob),
        title,
        summary,
        prompt: response.headers.get("X-Character-Prompt") || "",
        style,
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
      setInput(user.content);
    } finally {
      clearTimeout(timeout);
      if (id === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <div className="chat-app character-app">
      <header className="chat-header">
        <a href="/" className="chat-brand">
          <Cuboid size={26} />
          maite<span>.</span>
        </a>
        <StudioNav />
        <div>
          <button onClick={reset} aria-label="새 캐릭터 대화">
            <Plus size={16} />새 대화
          </button>
        </div>
      </header>
      <main className="chat-layout">
        <div className="character-conversations">
        <section className="conversation">
          <div className="conversation-title">
            <span className="eyebrow">YOUR TYPE, YOUR CHARACTER</span>
            <h1>어떤 이상형을 그릴까요?</h1>
            <p>취향을 이야기하면, 한 장의 애니메이션 일러스트로.</p>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <span className="welcome-icon">
                  <Sparkles size={25} />
                </span>
                <h2>단어 몇 개로 시작하는 나만의 캐릭터.</h2>
                <p>
                  헤어스타일, 의상, 표정, 분위기를 자유롭게 적어주세요.
                  <br />
                  선명한 선화와 풍부한 채색으로 그려드려요.
                </p>
                <div className="chat-examples">
                  {[
                    "긴 검은 머리와 푸른 눈, 흰 원피스를 입은 차분한 여성",
                    "작은 드래곤을 안고 웃는 모험가, 초록 눈과 판타지 의상",
                    "책을 읽는 학생 마법사, 마법학교 교복과 호기심 어린 표정",
                  ].map((text) => (
                    <button key={text} onClick={() => setInput(text)}>
                      {text}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
                <small>
                  2D 애니메이션 · 세로형 9:16 · {CHARACTER_WIDTH} ×{" "}
                  {CHARACTER_HEIGHT} 저장
                  <br />
                  샘플은 그림체만 참고하며, 캐릭터는 채팅 내용을 따릅니다.
                </small>
              </div>
            ) : (
              messages.map((m, i) => (
                <article key={i} className={`chat-message ${m.role}`}>
                  <span>{m.role === "user" ? "나" : "MAITE"}</span>
                  <p>{m.content}</p>
                </article>
              ))
            )}
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
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <textarea
                aria-label="만들고 싶은 캐릭터"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={2000}
                disabled={busy}
                placeholder={
                  previous.current
                    ? "머리는 은발로, 표정은 조금 더 다정하게 바꿔줘…"
                    : "취향에 맞는 캐릭터의 키워드를 입력해주세요…"
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div>
                <span>{input.length}/2000</span>
                {busy ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      cancel();
                    }}
                    aria-label="이미지 생성 취소"
                  >
                    <X size={17} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="캐릭터 생성"
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </form>
            <p>Enter로 보내기 · Shift + Enter로 줄바꿈 · 로그인 없이 시작</p>
          </div>
        </section>
        <LiveChat />
        </div>
        <section className="chat-output character-output">
          <div className="chat-output-tabs">
            <button
              onClick={() => setView("result")}
              className={view === "result" ? "active" : ""}
            >
              <ImagePlus size={15} />
              캐릭터 이미지
            </button>
            <button
              onClick={() => setView("reference")}
              className={view === "reference" ? "active" : ""}
            >
              <Sparkles size={15} />
              그림체 참고
            </button>
            <button
              onClick={() => setView("prompt")}
              className={view === "prompt" ? "active" : ""}
            >
              생성 프롬프트
            </button>
          </div>
          {view === "prompt" ? (
            <div className="chat-code">
              <h3>
                {art?.prompt
                  ? "실제 생성에 사용한 프롬프트"
                  : "첨부 샘플에서 분석한 공통 그림체"}
              </h3>
              {art?.prompt ? <><p>{CHARACTER_STYLE_LABELS[art.style]}</p><p>{art.prompt}</p></> : <>
                <h4>여자 캐릭터 스타일</h4><p>{CHARACTER_STYLES.female}</p>
                <h4>남자 캐릭터 스타일</h4><p>{CHARACTER_STYLES.male}</p>
                <p>채팅에 요청한 캐릭터에 맞춰 스타일을 선택합니다. 성별이 불분명하면 공통 스타일을 사용합니다.</p>
              </>}
            </div>
          ) : (
            <div
              className={`character-canvas ${art || view === "reference" ? "has-art" : ""}`}
              aria-busy={busy}
            >
              {view === "reference" ? (
                <>
                  <div className="reference-style-picker" role="group" aria-label="캐릭터 참고 스타일">
                    <button type="button" aria-pressed={referenceStyle === "female"} onClick={() => setReferenceStyle("female")}>여자 스타일</button>
                    <button type="button" aria-pressed={referenceStyle === "male"} onClick={() => setReferenceStyle("male")}>남자 스타일</button>
                  </div>
                  {referenceStyle === "female" ? <>
                  <img
                    src="/references/anime-style.png"
                    alt="그림체 참고 샘플: 작은 드래곤을 안고 웃는 주황색 머리의 모험가"
                  />
                  <span className="art-label">
                    여자 캐릭터 샘플 · 선화와 채색 참고
                  </span>
                  </> : <div className="reference-style-description">
                    <h3>남자 캐릭터 톤앤매너</h3>
                    <p>섬세하고 가는 선화, 정제된 얼굴 묘사, 차분한 저채도 색감과 회색·보랏빛 명암, 부드러운 셀 채색.</p>
                    <p>{CHARACTER_STYLES.male}</p>
                    <small>첨부 샘플을 분석해 저장한 스타일 프롬프트입니다. 머리색·눈색·장신구·표정은 채팅 내용을 따릅니다.</small>
                  </div>}
                </>
              ) : art ? (
                <img
                  src={art.url}
                  alt={`${art.title} — 생성된 2D 캐릭터 일러스트`}
                />
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
                  <div className="reference-thumbnail">
                    <img
                      src="/references/anime-style.png"
                      alt="애니메이션 캐릭터 그림체 샘플"
                    />
                    <span>STYLE REFERENCE</span>
                  </div>
                  <h2>상상 속 캐릭터를, 눈앞에.</h2>
                  <p>
                    원하는 키워드를 채팅으로 보내보세요.
                    <br />
                    이런 감도의 2D 일러스트로 완성해드릴게요.
                  </p>
                </div>
              )}
            </div>
          )}
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
      <footer className="chat-footer">
        키워드에서 시작하는 나만의 애니메이션 캐릭터
        <span>결과는 이 탭에서 유지됩니다.</span>
      </footer>
    </div>
  );
}
