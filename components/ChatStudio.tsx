"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDownToLine,
  Box,
  Code2,
  Cuboid,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { validateScene, type Scene } from "@/lib/cad/scene";
import type { CadResult, WorkerMessage } from "@/lib/cad/schema";

const Viewer = dynamic(() => import("./CadViewer"), { ssr: false });
type Message = { role: "user" | "assistant"; content: string };
export default function ChatStudio() {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState("");
  const [scene, setScene] = useState<Scene>(),
    [prompt, setPrompt] = useState(""),
    [result, setResult] = useState<CadResult>();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(
      "설명을 입력하면 이곳에 형태가 만들어집니다.",
    ),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"preview" | "spec" | "prompt">("preview"),
    [view, setView] = useState<"3d" | "top" | "front">("3d");
  const worker = useRef<Worker | null>(null),
    abort = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    run = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      worker.current?.terminate();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, status]);
  function cleanup() {
    abort.current?.abort();
    abort.current = null;
    worker.current?.terminate();
    worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function cancel() {
    run.current++;
    cleanup();
    setBusy(false);
    setProgress(0);
    setStatus("취소했습니다. 다시 요청하거나 명세로 재생성할 수 있습니다.");
  }
  function reset() {
    cancel();
    setMessages([]);
    setScene(undefined);
    setResult(undefined);
    setPrompt("");
    setError("");
    setInput("");
    setStatus("새로운 아이디어를 설명해주세요.");
  }
  function build(spec: Scene, id: number) {
    setStatus("브라우저에서 3D 형상을 구성하는 중");
    setProgress(15);
    const w = new Worker(new URL("../workers/cad.worker.ts", import.meta.url));
    worker.current = w;
    timer.current = setTimeout(() => {
      if (run.current === id) {
        cleanup();
        setBusy(false);
        setError(
          "CAD 작업이 120초를 초과했습니다. 더 단순한 형태로 요청해주세요.",
        );
      }
    }, 120000);
    w.onerror = () => {
      if (run.current !== id) return;
      cleanup();
      setBusy(false);
      setError("CAD 엔진을 불러오지 못했습니다. 다시 시도해주세요.");
    };
    w.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (run.current !== id) return;
      const data = event.data;
      if (data.type === "progress") {
        setStatus(data.message);
        setProgress(data.progress);
      } else if (data.type === "error") {
        cleanup();
        setBusy(false);
        setError(data.message);
        setStatus("형상 생성에 실패했습니다.");
      } else {
        setResult(data.result);
        cleanup();
        setBusy(false);
        setProgress(100);
        setStatus("3D 생성 · STEP 유효성 및 치수 재검증 완료");
      }
    };
    w.postMessage(spec);
  }
  async function submit() {
    if (busy || !input.trim()) return;
    const next: Message[] = [
      ...messages,
      { role: "user", content: input.trim() },
    ];
    const id = ++run.current;
    cleanup();
    setMessages(next);
    setInput("");
    setBusy(true);
    setResult(undefined);
    setScene(undefined);
    setPrompt("");
    setError("");
    setTab("preview");
    setProgress(3);
    setStatus("OpenAI가 대화를 정리하고 형상 명세를 설계하는 중…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: next.slice(-15) }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (run.current !== id) return;
      if (!response.ok)
        throw new Error(data.error || "생성 요청에 실패했습니다.");
      const spec = validateScene(data.specification);
      if (
        typeof data.optimizedPrompt !== "string" ||
        typeof data.explanation !== "string"
      )
        throw new Error("응답 형식이 올바르지 않습니다.");
      setPrompt(data.optimizedPrompt);
      setScene(spec);
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.explanation + "\n\n" + spec.summary,
        },
      ]);
      build(spec, id);
    } catch (e) {
      if (run.current !== id) return;
      cleanup();
      setBusy(false);
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      setStatus("요청을 완료하지 못했습니다.");
      setInput(next.at(-1)!.content);
      setMessages(next.slice(0, -1));
    }
  }
  function retry() {
    if (!scene || busy) return;
    const id = ++run.current;
    cleanup();
    setError("");
    setResult(undefined);
    setBusy(true);
    try {
      build(scene, id);
    } catch {
      cleanup();
      setBusy(false);
      setError("Worker를 시작할 수 없습니다.");
    }
  }
  function download(format: "step" | "json") {
    if (!scene || (format === "step" && !result)) return;
    const blob =
      format === "step"
        ? new Blob([result!.step], { type: "application/step" })
        : new Blob([JSON.stringify(scene, null, 2)], {
            type: "application/json",
          });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${scene.title.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60) || "maite-model"}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="chat-app">
      <header className="chat-header">
        <a href="/" className="chat-brand">
          <Cuboid size={26} />
          maite<span>.</span>
        </a>
        <span className="chat-header-label">CHAT TO CAD STUDIO</span>
        <div>
          <button onClick={reset} aria-label="새 대화">
            <Plus size={16} />새 대화
          </button>
        </div>
      </header>
      <main className="chat-layout">
        <section className="conversation">
          <div className="conversation-title">
            <span className="eyebrow">DESCRIBE YOUR IDEA</span>
            <h1>어떤 모양을 만들까요?</h1>
            <p>대화로 구체화하고, 3D로 확인하세요.</p>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <span className="welcome-icon">
                  <Sparkles size={25} />
                </span>
                <h2>한 문장에서 시작하는 작은 형태.</h2>
                <p>
                  대상과 자세, 크기를 편하게 적어주세요.
                  <br />
                  AI가 설명을 정리하고 만들 수 있는 형상으로 설계합니다.
                </p>
                <div className="chat-examples">
                  {[
                    "엎드려 자는 강아지를 길이 100mm로 만들어줘",
                    "광화문 미니어처를 너비 150mm로 만들어줘",
                    "귀가 긴 토끼가 앉아 있는 모습을 만들어줘",
                  ].map((text) => (
                    <button key={text} onClick={() => setInput(text)}>
                      {text}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
                <small>
                  현재는 기본 도형과 곡면을 조합한 단순화 모델을 만듭니다.
                  <br />
                  실사 피규어나 정밀 문화재 복제 품질은 지원하지 않습니다.
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
                {progress < 15
                  ? "설명을 해석하고 설계하는 중"
                  : "설계한 모양을 만드는 중"}
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
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="chat-composer"
            >
              <textarea
                aria-label="만들고 싶은 모양"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={3000}
                disabled={busy}
                placeholder={
                  messages.length
                    ? "귀를 더 길게, 크기는 120mm로 바꿔줘…"
                    : "만들고 싶은 모양을 설명해주세요…"
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
                <span>{input.length}/3000</span>
                {busy ? (
                  <button type="button" onClick={cancel} aria-label="생성 취소">
                    <X size={17} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="보내기"
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </form>
            <p>
              Enter로 보내기 · Shift + Enter로 줄바꿈 · 대화는 이 탭에서
              유지됩니다.
            </p>
          </div>
        </section>
        <section className="chat-output">
          <div className="chat-output-tabs">
            {(
              [
                ["preview", "3D 미리보기"],
                ["prompt", "정리된 프롬프트"],
                ["spec", "형상 명세"],
              ] as const
            ).map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {id === "preview" ? (
                  <Box size={15} />
                ) : id === "spec" ? (
                  <Code2 size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                {label}
              </button>
            ))}
          </div>
          {tab === "preview" ? (
            <Viewer
              mesh={result?.mesh}
              dimensions={result?.bounds || [100, 100, 60]}
              view={view}
              onViewChange={setView}
            />
          ) : (
            <div className="chat-code">
              {tab === "prompt" ? (
                <>
                  <h3>OpenAI가 정리한 생성용 프롬프트</h3>
                  <p>
                    {prompt ||
                      "메시지를 보내면 대상·자세·특징·크기를 정리한 프롬프트가 표시됩니다."}
                  </p>
                </>
              ) : (
                <>
                  <h3>검증된 형상 명세</h3>
                  <pre>
                    {scene
                      ? JSON.stringify(scene, null, 2)
                      : "아직 생성된 명세가 없습니다."}
                  </pre>
                </>
              )}
            </div>
          )}
          <div className="chat-progress" role="status">
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <span className="status-dot" />
            )}
            {status}
            {busy && (
              <progress aria-label="생성 진행률" value={progress} max={100} />
            )}
          </div>
          <div className="chat-download">
            <div>
              <strong>{scene?.title || "당신의 아이디어를 기다립니다"}</strong>
              <p>
                {result
                  ? `${result.bounds.map((v) => v.toFixed(1)).join(" × ")} mm · ${(result.step.byteLength / 1024).toFixed(0)} KB`
                  : "브라우저에서 실제 CAD 형상을 만들고 STEP으로 저장합니다."}
              </p>
            </div>
            <button disabled={!result || busy} onClick={() => download("step")}>
              <ArrowDownToLine size={16} />
              STEP 다운로드
            </button>
          </div>
          {scene && (
            <div className="scene-notes">
              <div>
                <span>
                  {scene.parts.filter((p) => p.mode === "add").length}개 부품 ·
                  mm · 솔리드 조립체
                </span>
                <button disabled={busy} onClick={retry}>
                  명세로 다시 생성
                </button>
                <button onClick={() => download("json")}>JSON 저장</button>
              </div>
              {scene.limitations.map((note, i) => (
                <p key={i}>{note}</p>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="chat-footer">
        OpenAI로 설계 · 브라우저에서 생성 · 추가 3D AI 없음
        <span>STEP은 여러 솔리드의 조립체일 수 있습니다.</span>
      </footer>
    </div>
  );
}
