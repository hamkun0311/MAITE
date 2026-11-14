"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, MessageCircle, Square } from "lucide-react";
import { readEvents } from "@/lib/chat/stream";

type Message = { role: "user" | "assistant"; content: string };
export default function LiveChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const committed = useRef<Message[]>([]);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0), stopped = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages]);
  function reset() {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    committed.current = [];
    setMessages([]); setInput(""); setNotice(""); setBusy(false);
  }
  async function submit() {
    if (controller.current || !input.trim()) return;
    const text = input.trim();
    const history: Message[] = [...committed.current.slice(-20), { role: "user", content: text }];
    while (history.length > 1 && history.reduce((n, m) => n + m.content.length, 0) > 24000)
      history.splice(0, 2);
    const displayed = [...messages, { role: "user" as const, content: text }];
    const abort = new AbortController(), id = ++sequence.current;
    controller.current = abort; stopped.current = false;
    setMessages([...displayed, { role: "assistant", content: "" }]);
    setInput(""); setNotice(""); setBusy(true);
    let answer = "", completed = false;
    const timeout = setTimeout(() => abort.abort(), 160000);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }), signal: abort.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "AI에 연결하지 못했습니다.");
      }
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream"))
        throw new Error("응답 형식이 올바르지 않습니다.");
      for await (const event of readEvents(response.body)) {
        if (id !== sequence.current) return;
        if (event.type === "delta" && typeof event.text === "string") {
          answer += event.text;
          if (answer.length > 8000) throw new Error("응답이 너무 길어 중단했습니다.");
          setMessages([...displayed, { role: "assistant", content: answer }]);
        } else if (event.type === "done") { completed = true; break; }
        else if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "응답이 중단되었습니다.");
      }
      if (!completed || !answer.trim()) throw new Error("응답이 중단되었습니다. 다시 시도해주세요.");
      committed.current = [...history, { role: "assistant", content: answer }];
    } catch (error) {
      if (id !== sequence.current) return;
      setNotice(stopped.current ? "응답을 중지했습니다." : abort.signal.aborted ? "응답 시간이 초과되었습니다. 다시 시도해주세요." : error instanceof Error ? error.message : "대화 중 오류가 발생했습니다.");
      if (!answer) { setMessages(messages); setInput(text); }
      // Partial replies remain visible, but incomplete turns are not sent as history.
    } finally {
      clearTimeout(timeout);
      abort.abort();
      if (id === sequence.current) { controller.current = null; setBusy(false); }
    }
  }
  return (
    <section className="live-chat" aria-label="AI 실시간 대화">
      <div className="live-chat-heading">
        <div><h2><MessageCircle size={18} /> AI와 대화하기</h2><p>궁금한 점이나 떠오르는 이야기를 나눠보세요.</p></div>
        <button type="button" onClick={reset} aria-label="AI 대화 초기화">새 대화</button>
      </div>
      <div className="live-chat-log" ref={log} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions text">
        {!messages.length && <p className="live-chat-empty">캐릭터 아이디어부터 일상 이야기까지, 자유롭게 대화하세요.</p>}
        {messages.map((m, i) => <article className={`chat-message ${m.role}`} key={i}><span>{m.role === "user" ? "나" : "AI"}</span><p>{m.content || "답변을 기다리는 중…"}</p></article>)}
      </div>
      {notice && <p className="chat-error" role="status">{notice}</p>}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="AI에게 보낼 메시지" placeholder="AI에게 이야기해보세요…" maxLength={2000} value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
        }} />
        <div><span>{input.length}/2000</span>{busy ? <button type="button" aria-label="AI 응답 중지" onClick={(event) => { event.preventDefault(); stopped.current = true; controller.current?.abort(); }}><Square size={14} /></button> : <button type="submit" aria-label="AI 메시지 보내기" disabled={!input.trim()}><ArrowUp size={18} /></button>}</div>
      </form>
      <p className="live-chat-status" role="status">{busy ? <><LoaderCircle size={13} className="spin" /> 답변하는 중…</> : "GPT-5.4 mini · 실시간 대화 · 이미지 생성과 별도 대화"}</p>
    </section>
  );
}
