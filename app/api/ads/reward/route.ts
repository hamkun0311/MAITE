import { z } from "zod";
import { AccountError, requireAccount } from "@/lib/server/account";
import { adRewardConfirmed } from "@/lib/server/admob";
import { allowedOrigin, corsHeaders, preflight } from "@/lib/server/http";

export const OPTIONS = preflight;
export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { user } = await requireAccount(request);
    const attempt = z.uuid().parse(new URL(request.url).searchParams.get("attempt"));
    return Response.json({ confirmed: await adRewardConfirmed(user.id, attempt) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AccountError ? error.message : "광고 보상 정보를 확인하지 못했습니다." },
      { status: error instanceof AccountError ? error.status : error instanceof z.ZodError ? 400 : 500, headers });
  }
}
