import { z } from "zod";
import { AccountError, isAccountOperator, requireAccount } from "@/lib/server/account";
import { grantTestAdReward, testAdRewardStatus } from "@/lib/server/admob";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "@/lib/server/http";

export const OPTIONS = preflight;
const input = z.object({ userId: z.uuid(), attemptId: z.uuid() }).strict();

async function handle(request: Request, claim: boolean) {
  const headers = { ...corsHeaders(request), "Cache-Control": "no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { user } = await requireAccount(request);
    if (isAccountOperator(user)) {
      if (claim) throw new AccountError("이 계정에서는 광고 시청이 비활성화되어 있어요.", 403);
      return Response.json({ enabled: false }, { headers });
    }
    if (!claim) return Response.json(await testAdRewardStatus(user.id), { headers });
    const claimInput = input.parse(JSON.parse(await readTextBounded(request, 512)));
    if (claimInput.userId !== user.id) throw new AccountError("광고를 본 계정으로 다시 로그인해주세요.", 403);
    await grantTestAdReward(user.id, claimInput.attemptId);
    return Response.json(await testAdRewardStatus(user.id), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AccountError ? error.message : "테스트 광고 보상을 처리하지 못했습니다." },
      { status: error instanceof AccountError ? error.status : error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 500, headers });
  }
}

export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
