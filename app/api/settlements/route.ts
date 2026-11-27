import { z } from "zod";
import { koreaDay, SETTLEMENT_DAY, SETTLEMENT_HEARTS } from "../../../lib/account/policy.ts";
import { AccountError, isAccountOperator, requireAccount, rpc } from "../../../lib/server/account.ts";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "../../../lib/server/http.ts";

export const OPTIONS = preflight;
const pageSize = 25;
type SettlementRow = {
  id: string; user_id: string; payout_on: string; hearts: number; amount_won: number;
  bank: string; account_holder: string; created_at: string; cancelled_at: string | null; completed_at: string | null;
  account_number?: string; consented_at?: string;
};
const updateSchema = z.object({ action: z.enum(["cancel", "complete"]), id: z.uuid() }).strict();
const monthSchema = z.string().regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/u);
const requestSchema = z.object({
  id: z.uuid(), month: monthSchema,
  hearts: z.number().int().min(SETTLEMENT_HEARTS).max(1_000_000_000).multipleOf(SETTLEMENT_HEARTS),
  bank: z.string().trim().min(1).max(60),
  accountNumber: z.string().max(64).transform(value => value.replace(/[-\s]/gu, "")).pipe(z.string().regex(/^\d{4,32}$/u)),
  accountHolder: z.string().trim().min(1).max(80),
  consent: z.literal(true),
}).strict();

function failure(error: unknown, headers: Record<string, string>) {
  if (error instanceof AccountError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json({ error: "정산 요청의 월, 수량, 계좌 정보를 확인해주세요." }, { status: 400, headers });
  return Response.json({ error: "정산 요청을 처리하지 못했습니다." }, { status: 500, headers });
}

export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "private, no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const isAdmin = isAccountOperator(user);
    const params = new URL(request.url).searchParams;
    const page = z.coerce.number().int().min(0).max(100000).parse(params.get("page") ?? 0);
    const month = monthSchema.nullable().parse(params.get("month"));
    let query = db.from("heart_settlements").select(isAdmin
      ? "id,user_id,payout_on,hearts,amount_won,bank,account_number,account_holder,consented_at,created_at,cancelled_at,completed_at"
      : "id,user_id,payout_on,hearts,amount_won,bank,account_holder,created_at,cancelled_at,completed_at");
    if (!isAdmin) query = query.eq("user_id", user.id);
    if (month) query = query.eq("payout_on", `${month}-${SETTLEMENT_DAY}`);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize).overrideTypes<SettlementRow[], { merge: false }>();
    if (error?.code === "42703") throw new AccountError("정산 기능 DB 업데이트가 필요합니다.", 503);
    if (error) throw new AccountError("정산 내역을 불러오지 못했습니다.", 503);
    const today = koreaDay();
    const requests = data.slice(0, pageSize).map(row => {
      const pending = !row.cancelled_at && !row.completed_at;
      const canCancel = row.user_id === user.id && pending && row.payout_on > today;
      if (isAdmin) return { ...row, ...(row.cancelled_at ? { account_number: null } : {}), canCancel };
      const { user_id: _owner, ...own } = row;
      return { ...own, canCancel };
    });
    return Response.json({ requests, isAdmin, hasMore: data.length > pageSize }, { headers });
  } catch (error) { return failure(error, headers); }
}

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "private, no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { user } = await requireAccount(request);
    const body = JSON.parse(await readTextBounded(request, 4000));
    if (body?.action !== undefined) {
      const { action, id } = updateSchema.parse(body);
      if (action === "complete") {
        if (!isAccountOperator(user)) throw new AccountError("정산을 완료할 권한이 없습니다.", 403);
        const completedAt = await rpc<string>("complete_heart_settlement", { p_id: id, p_operator: user.id });
        return Response.json({ ok: true, completedAt }, { headers });
      }
      await rpc("cancel_heart_settlement", { p_user: user.id, p_id: id });
      return Response.json({ ok: true }, { headers });
    }
    const input = requestSchema.parse(body);
    await rpc("request_heart_settlement", {
      p_user: user.id, p_id: input.id, p_payout_on: `${input.month}-${SETTLEMENT_DAY}`, p_hearts: input.hearts,
      p_bank: input.bank, p_account_number: input.accountNumber, p_account_holder: input.accountHolder, p_consent: input.consent,
    });
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error, headers); }
}
