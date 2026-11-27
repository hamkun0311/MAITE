import { z } from "zod";
import { AccountError, isAccountOperator, requireAccount } from "../../../lib/server/account.ts";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "../../../lib/server/http.ts";

export const OPTIONS = preflight;
const pageSize = 20;
const notice = z.object({ title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(5000) }).strict();

function failure(error: unknown, headers: Record<string, string>) {
  if (error instanceof AccountError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json({ error: "공지사항 입력 내용을 확인해주세요." }, { status: 400, headers });
  return Response.json({ error: "공지사항을 처리하지 못했습니다." }, { status: 500, headers });
}

export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "private, no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const page = z.coerce.number().int().min(0).max(100000).parse(new URL(request.url).searchParams.get("page") ?? 0);
    const { data, error } = await db.from("notices").select("id,title,body,created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * pageSize, (page + 1) * pageSize);
    if (error) throw new AccountError("공지사항을 불러오지 못했습니다.", 503);
    return Response.json({ notices: data.slice(0, pageSize), isAdmin: isAccountOperator(user), hasMore: data.length > pageSize }, { headers });
  } catch (error) { return failure(error, headers); }
}

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "private, no-store" };
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    if (!isAccountOperator(user)) throw new AccountError("공지사항을 작성할 권한이 없습니다.", 403);
    const input = notice.parse(JSON.parse(await readTextBounded(request, 36000)));
    const { error } = await db.from("notices").insert(input);
    if (error) throw new AccountError("공지사항을 등록하지 못했습니다.", 503);
    return Response.json({ ok: true }, { status: 201, headers });
  } catch (error) { return failure(error, headers); }
}
