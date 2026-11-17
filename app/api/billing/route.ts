import { z } from "zod";
import { requireAccount, AccountError } from "@/lib/server/account";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "@/lib/server/http";
import { playAccountId, verifyPurchase } from "@/lib/server/play";
export const OPTIONS = preflight;
export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { user } = await requireAccount(request);
    return Response.json({ accountId: playAccountId(user.id) }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "계정 확인 실패" }, { status: error instanceof AccountError ? error.status : 500, headers }); }
}
export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { user } = await requireAccount(request);
    const text = await readTextBounded(request, 10000);
    const input = z.object({ productId: z.string().min(1).max(100), token: z.string().min(1).max(8000) }).strict().parse(JSON.parse(text));
    return Response.json(await verifyPurchase(user.id, input.productId, input.token), { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "결제 정보를 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
