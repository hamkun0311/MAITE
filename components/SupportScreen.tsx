"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { jsonApi } from "@/lib/platform/commerce";
import { useAccount } from "./AccountProvider";
import { useActionConfirm } from "./ActionConfirm";
import { useScreenLoading } from "./ScreenLoading";

type Reply = { id: string; body: string; created_at: string };
type Inquiry = { id: string; author_name: string; title: string; body: string; created_at: string; isOwn: boolean; replies: Reply[] };
type List = { inquiries: Inquiry[]; isAdmin: boolean; hasMore: boolean };
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });
const emptyDraft = { title: "", body: "" };
const loadInquiries = (page = 0): Promise<List> => jsonApi(`/api/support?page=${page}`);

export default function SupportScreen() {
  const { user } = useAccount();
  const confirm = useActionConfirm();
  const [list, setList] = useState<List>();
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<string>();
  const [replying, setReplying] = useState<string>();
  const [reply, setReply] = useState("");
  useScreenLoading(!!user && loading);

  useEffect(() => {
    let active = true;
    setList(undefined); setPage(0); setError(""); setDraft(emptyDraft); setEditing(undefined); setReplying(undefined); setReply("");
    if (!user) return;
    setLoading(true);
    void loadInquiries().then(data => { if (active) setList(data); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); }
    catch (error) { setError(error instanceof Error ? error.message : "문의 요청을 처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function change(input: object, reset?: () => void) {
    await run(async () => {
      await jsonApi("/api/support", input);
      reset?.();
      setList(await loadInquiries()); setPage(0);
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void change(editing ? { action: "update", id: editing, ...draft } : { action: "create", ...draft },
      () => { setDraft(emptyDraft); setEditing(undefined); });
  }
  async function remove(inquiry: Inquiry) {
    if (!await confirm({ title: "문의를 삭제할까요?", description: "문의와 달린 답글이 함께 삭제됩니다.", confirmLabel: "삭제", danger: true })) return;
    await change({ action: "delete", id: inquiry.id }, () => {
      if (editing === inquiry.id) { setEditing(undefined); setDraft(emptyDraft); }
    });
  }
  function more() {
    void run(async () => {
      const next = await loadInquiries(page + 1);
      setList(previous => ({
        ...next, inquiries: [...new Map([...(previous?.inquiries ?? []), ...next.inquiries].map(item => [item.id, item])).values()],
      }));
      setPage(page + 1);
    });
  }

  return <main className="account-page native-page support-page">
    <Link className="native-back" href="/ideal/mypage"><ChevronLeft size={18}/>내 정보</Link>
    <div className="native-page-title"><div><h1>문의하기</h1></div><MessageCircle size={25}/></div>
    {!user && <p>로그인 후 문의할 수 있어요.</p>}
    {error && <p role="alert">{error}</p>}
    {user && error && !list && <button type="button" disabled={busy} onClick={() => void run(async () => { setList(await loadInquiries()); setPage(0); })}>다시 불러오기</button>}
    {user && list && <>
      <form id="support-form" className="account-panel support-form" onSubmit={submit}>
        <h2>{editing ? "문의 수정" : "새 문의"}</h2>
        <label>제목<input value={draft.title} maxLength={100} required disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>문의 내용<textarea value={draft.body} maxLength={3000} required disabled={busy} onChange={event => setDraft({ ...draft, body: event.target.value })}/></label>
        <div className="support-actions">
          {editing && <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setDraft(emptyDraft); }}>취소</button>}
          <button className="native-primary" disabled={busy || !draft.title.trim() || !draft.body.trim()}>{editing ? "수정 저장" : "문의 등록"}</button>
        </div>
      </form>
      <section aria-label={list.isAdmin ? "전체 문의 내역" : "내 문의 내역"} className="support-list">
        <h2>{list.isAdmin ? "전체 문의 내역" : "내 문의 내역"}</h2>
        {!list.inquiries.length && <p>등록된 문의가 없어요.</p>}
        {list.inquiries.map(inquiry => <article key={inquiry.id} className="account-panel support-inquiry">
          <h3>{inquiry.title}</h3>
          <small>{list.isAdmin ? `${inquiry.author_name} · ` : ""}<time dateTime={inquiry.created_at}>{dateFormat.format(new Date(inquiry.created_at))}</time></small>
          <p className="support-body">{inquiry.body}</p>
          {inquiry.replies.map(item => <div className="support-reply" key={item.id}>
            <strong>운영자 답글</strong><time dateTime={item.created_at}>{dateFormat.format(new Date(item.created_at))}</time>
            <p className="support-body">{item.body}</p>
          </div>)}
          <div className="support-actions">
            {inquiry.isOwn && <>
              <button type="button" disabled={busy} onClick={() => {
                setEditing(inquiry.id); setDraft({ title: inquiry.title, body: inquiry.body });
                document.getElementById("support-form")?.scrollIntoView({ block: "start" });
              }}>수정</button>
              <button type="button" disabled={busy} onClick={() => void remove(inquiry)}>삭제</button>
            </>}
            {list.isAdmin && replying !== inquiry.id && <button type="button" disabled={busy} onClick={() => { setReplying(inquiry.id); setReply(""); }}>답글 쓰기</button>}
          </div>
          {list.isAdmin && replying === inquiry.id && <form className="support-form" onSubmit={event => {
            event.preventDefault();
            void change({ action: "reply", id: inquiry.id, body: reply }, () => { setReplying(undefined); setReply(""); });
          }}>
            <label>답글 내용<textarea required maxLength={3000} value={reply} disabled={busy} onChange={event => setReply(event.target.value)}/></label>
            <div className="support-actions"><button type="button" disabled={busy} onClick={() => setReplying(undefined)}>취소</button><button className="native-primary" disabled={busy || !reply.trim()}>답글 등록</button></div>
          </form>}
        </article>)}
        {list.hasMore && <button type="button" disabled={busy} onClick={more}>문의 더 보기</button>}
      </section>
    </>}
  </main>;
}
