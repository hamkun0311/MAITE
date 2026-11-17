import { verifyAdmob } from "@/lib/server/admob";
import { AccountError } from "@/lib/server/account";
export async function GET(request: Request) {
  try { await verifyAdmob(new URL(request.url)); return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "검증에 실패했습니다." }, { status: error instanceof AccountError ? error.status : 503 }); }
}
