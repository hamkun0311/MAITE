"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, Wallet } from "lucide-react";
import { firstSettlementMonth, SETTLEMENT_DAY, SETTLEMENT_HEARTS, SETTLEMENT_WON } from "@/lib/account/policy";
import { jsonApi } from "@/lib/platform/commerce";
import { useAccount } from "./AccountProvider";
import { useActionConfirm } from "./ActionConfirm";
import HeartText from "./HeartText";

type Settlement = {
  id: string; payout_on: string; hearts: number; amount_won: number; bank: string;
  account_holder: string; account_number?: string; consented_at?: string; created_at: string; user_id?: string;
  cancelled_at?: string | null; completed_at?: string | null; canCancel: boolean;
};
type SettlementList = { requests: Settlement[]; isAdmin: boolean; hasMore: boolean };
const emptyForm = { hearts: "", bank: "", accountNumber: "", accountHolder: "", consent: false };
const money = (won: number) => `${won.toLocaleString("ko-KR")}원`;
const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

export default function SettlementScreen() {
  const { user, account, refresh } = useAccount();
  return <SettlementPageBody key={user?.id ?? "signed-out"} userId={user?.id} available={account?.wallet.transferable ?? 0} refresh={refresh}/>;
}

function SettlementPageBody({ userId, available, refresh }: { userId?: string; available: number; refresh: () => Promise<void> }) {
  const confirm = useActionConfirm();
  const [month, setMonth] = useState(firstSettlementMonth);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<SettlementList>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const [updateFeedback, setUpdateFeedback] = useState<{ error: boolean; text: string }>();
  const pending = useRef<{ payload: string; id: string } | undefined>(undefined);
  const hearts = Number(form.hearts);
  const canSubmit = hearts >= SETTLEMENT_HEARTS && hearts <= available && hearts % SETTLEMENT_HEARTS === 0;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("month", filter);
    void jsonApi(`/api/settlements?${params}`).then((data: SettlementList) => {
      if (active) setList(data);
    }).catch((error: Error) => {
      if (active) setListError(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, page, filter, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSubmit || !form.consent) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      if (!await confirm({ title: "정산을 요청할까요?", description: "접수하면 빨간 하트 잔액에서 즉시 차감됩니다.", lines: [
        { label: "정산 예정일", value: `${month}-${SETTLEMENT_DAY}` },
        { label: "정산 금액", value: money(hearts / SETTLEMENT_HEARTS * SETTLEMENT_WON) },
      ], confirmLabel: "정산 요청" })) return;
      const input = { ...form, month, hearts };
      const payload = JSON.stringify(input);
      if (pending.current?.payload !== payload) pending.current = { payload, id: crypto.randomUUID() };
      await jsonApi("/api/settlements", { ...input, id: pending.current.id });
      pending.current = undefined;
      setForm(emptyForm);
      setFeedback({ error: false, text: "정산 요청을 접수했습니다." });
      setPage(0);
      setFilter("");
      setRevision(value => value + 1);
      void refresh();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "정산 요청을 처리하지 못했습니다." });
    } finally { setBusy(false); }
  }

  async function update(item: Settlement, action: "cancel" | "complete") {
    const cancelling = action === "cancel";
    if (busy || (cancelling ? !item.canCancel : !list?.isAdmin || !!item.cancelled_at || !!item.completed_at)) return;
    setBusy(true);
    setUpdateFeedback(undefined);
    try {
      if (!await confirm(cancelling
        ? { title: "정산 요청을 취소할까요?", description: `빨간 하트 ${item.hearts.toLocaleString("ko-KR")}개가 잔액으로 돌아옵니다.`, confirmLabel: "정산 취소", danger: true }
        : { title: "정산을 완료할까요?", description: "실제 송금을 마친 요청인지 확인해주세요.", lines: [
          { label: "예금주", value: item.account_holder }, { label: "송금액", value: money(item.amount_won) },
        ], confirmLabel: "정산 완료 처리" })) return;
      const result = await jsonApi("/api/settlements", { action, id: item.id });
      if (!cancelling) setList(current => current && ({ ...current, requests: current.requests.map(row =>
        row.id === item.id ? { ...row, completed_at: result.completedAt, canCancel: false } : row) }));
      setUpdateFeedback({ error: false, text: cancelling ? "정산 요청을 취소하고 빨간 하트를 돌려드렸습니다." : "정산을 완료했습니다." });
      setRevision(value => value + 1);
      if (cancelling) void refresh().catch(() => undefined);
    } catch (error) {
      setUpdateFeedback({ error: true, text: error instanceof Error ? error.message : "정산 요청 상태를 변경하지 못했습니다." });
    } finally { setBusy(false); }
  }

  return <main className="account-page native-page support-page">
    <Link className="native-back" href="/ideal/mypage"><ChevronLeft size={18}/>내 정보</Link>
    <div className="native-page-title"><div><h1>정산 요청</h1></div><Wallet size={25}/></div>
    {!userId ? <p>로그인 후 정산을 요청할 수 있어요.</p> : <>
      <form className="account-panel support-form settlement-form" onSubmit={submit}>
        <h2>정산 신청</h2>
        <small><HeartText text={`빨간 하트 ${SETTLEMENT_HEARTS}개당 ${money(SETTLEMENT_WON)}을 신청한 월의 10일에 정산해요.`}/></small>
        <strong><HeartText text={`정산 가능 ${available.toLocaleString("ko-KR")}하트`}/></strong>
        <label>정산 월<input type="month" required min={firstSettlementMonth()} value={month} onChange={event => setMonth(event.target.value)}/></label>
        <label><span><HeartText text="하트 수량"/></span><input type="number" required min={SETTLEMENT_HEARTS} step={SETTLEMENT_HEARTS} max={available} value={form.hearts} onChange={event => setForm({ ...form, hearts: event.target.value })}/></label>
        {canSubmit && <output>정산 금액 {money(hearts / SETTLEMENT_HEARTS * SETTLEMENT_WON)}</output>}
        <label>은행명<input required maxLength={60} value={form.bank} onChange={event => setForm({ ...form, bank: event.target.value })}/></label>
        <label>계좌번호<input required inputMode="numeric" maxLength={64} value={form.accountNumber} onChange={event => setForm({ ...form, accountNumber: event.target.value })}/></label>
        <label>예금주<input required maxLength={80} value={form.accountHolder} onChange={event => setForm({ ...form, accountHolder: event.target.value })}/></label>
        <label className="settlement-consent"><input type="checkbox" required checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })}/>
          <span>정산 처리에 필요한 은행명, 계좌번호, 예금주 정보를 운영자에게 제공하는 데 동의합니다. 동의해야 정산을 신청할 수 있어요.</span>
        </label>
        {feedback && <p role={feedback.error ? "alert" : "status"}><HeartText text={feedback.text}/></p>}
        <div className="support-actions"><button className="native-primary" disabled={busy || !canSubmit || !form.consent}>정산 요청하기</button></div>
      </form>
      <section className="account-panel support-form" aria-busy={loading}>
        <h2>{list?.isAdmin ? "전체 정산 요청" : "내 정산 요청"}</h2>
        <small>본인의 요청은 정산 예정일 전날까지 취소할 수 있어요.</small>
        {updateFeedback && <p role={updateFeedback.error ? "alert" : "status"}><HeartText text={updateFeedback.text}/></p>}
        {list?.isAdmin && <label>정산 월 필터<input type="month" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}/></label>}
        {listError && <><p role="alert">{listError}</p><button type="button" onClick={() => setRevision(value => value + 1)}>다시 불러오기</button></>}
        {list && !list.requests.length && <p>접수된 정산 요청이 없어요.</p>}
        {list?.requests.map(item => <details key={item.id} className="settlement-details">
          <summary>{item.payout_on} · {money(item.amount_won)}{list.isAdmin && ` · ${item.account_holder}`} · {item.completed_at ? "정산 완료" : item.cancelled_at ? "취소됨" : "접수"}</summary>
          <dl>
            <dt>신청 일시</dt><dd>{dateTime.format(new Date(item.created_at))}</dd>
            <dt><HeartText text="신청 하트"/></dt><dd>{item.hearts.toLocaleString("ko-KR")}</dd>
            <dt>은행명</dt><dd>{item.bank}</dd>
            <dt>예금주</dt><dd>{item.account_holder}</dd>
            {item.cancelled_at && <><dt>취소 일시</dt><dd>{dateTime.format(new Date(item.cancelled_at))}</dd></>}
            {item.completed_at && <><dt>정산 완료 일시</dt><dd><time dateTime={item.completed_at}>{dateTime.format(new Date(item.completed_at))}</time></dd></>}
            {list.isAdmin && <>{!item.cancelled_at && <><dt>계좌번호</dt><dd>{item.account_number}</dd></>}<dt>정보 제공 동의</dt><dd>{item.consented_at && dateTime.format(new Date(item.consented_at))}</dd><dt>신청 계정 ID</dt><dd>{item.user_id}</dd></>}
          </dl>
          <div className="support-actions">
            {item.canCancel && <button type="button" disabled={busy || loading} onClick={() => void update(item, "cancel")}>정산 취소</button>}
            {list.isAdmin && !item.cancelled_at && !item.completed_at && <button type="button" className="native-primary" disabled={busy || loading} onClick={() => void update(item, "complete")}>정산 완료 처리</button>}
          </div>
        </details>)}
        <div className="support-actions">
          {list && !listError && <button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>내역 새로고침</button>}
          {page > 0 && <button type="button" disabled={loading} onClick={() => setPage(page - 1)}>이전</button>}
          {list?.hasMore && <button type="button" disabled={loading} onClick={() => setPage(page + 1)}>다음</button>}
        </div>
      </section>
    </>}
  </main>;
}
