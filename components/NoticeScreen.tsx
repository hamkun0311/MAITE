"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, Megaphone } from "lucide-react";
import { jsonApi } from "@/lib/platform/commerce";
import { useAccount } from "./AccountProvider";
import HeartText from "./HeartText";

type Notice = { id: string; title: string; body: string; created_at: string };
type NoticeList = { notices: Notice[]; isAdmin: boolean; hasMore: boolean };
const emptyDraft = { title: "", body: "" };
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

export default function NoticeScreen() {
  const { user } = useAccount();
  return <main className="account-page native-page support-page">
    <Link className="native-back" href="/ideal/mypage"><ChevronLeft size={18}/>내 정보</Link>
    <div className="native-page-title"><div><h1>공지사항</h1></div><Megaphone size={25}/></div>
    {user ? <NoticeBoard key={user.id}/> : <p>로그인 후 공지사항을 볼 수 있어요.</p>}
  </main>;
}

function NoticeBoard() {
  const [list, setList] = useState<NoticeList>();
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void jsonApi(`/api/notices?page=${page}`).then((data: NoticeList) => {
      if (active) setList(data);
    }).catch((error: Error) => { if (active) setLoadError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list?.isAdmin || saving || !draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    setFeedback(undefined);
    try {
      await jsonApi("/api/notices", draft);
      setDraft(emptyDraft);
      setFeedback({ error: false, text: "공지사항을 등록했습니다." });
      setPage(0);
      setRevision(value => value + 1);
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "공지사항을 등록하지 못했습니다." });
    } finally { setSaving(false); }
  }

  return <>
    {list?.isAdmin && <form className="account-panel support-form" onSubmit={publish}>
      <h2>공지 작성</h2>
      <label>제목<input required maxLength={100} disabled={saving} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <label>공지 내용<textarea required maxLength={5000} disabled={saving} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })}/></label>
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      <div className="support-actions"><button className="native-primary" disabled={saving || !draft.title.trim() || !draft.body.trim()}>공지 등록</button></div>
    </form>}
    <section aria-label="공지 목록" aria-busy={loading}>
      {loadError && <p role="alert">{loadError} <button type="button" onClick={() => setRevision(value => value + 1)}>다시 불러오기</button></p>}
      {list && !list.notices.length && <p>등록된 공지사항이 없어요.</p>}
      {list?.notices.map(item => <details className="account-panel notice-item" key={item.id}>
        <summary><strong><HeartText text={item.title}/></strong><time dateTime={item.created_at}>{dateFormat.format(new Date(item.created_at))}</time></summary>
        <p><HeartText text={item.body}/></p>
      </details>)}
      <div className="support-actions">
        {page > 0 && <button type="button" disabled={loading} onClick={() => setPage(page - 1)}>이전</button>}
        {list?.hasMore && <button type="button" disabled={loading} onClick={() => setPage(page + 1)}>다음</button>}
      </div>
    </section>
  </>;
}
