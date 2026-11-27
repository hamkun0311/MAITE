import { z } from "zod";
import { AccountError, isAccountOperator, requireAccount } from "../../../lib/server/account.ts";
import { allowedOrigin, corsHeaders, preflight, readTextBounded } from "../../../lib/server/http.ts";

export const OPTIONS = preflight;
const pageSize = 25;
const title = z.string().trim().min(1).max(100);
const body = z.string().trim().min(1).max(3000);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title, body }).strict(),
  z.object({ action: z.literal("update"), id: z.uuid(), title, body }).strict(),
  z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("reply"), id: z.uuid(), body }).strict(),
]);

function failure(error: unknown, headers: Record<string, string>) {
  return Response.json({
    error: error instanceof AccountError ? error.message
      : error instanceof z.ZodError || error instanceof SyntaxError ? "문의 내용을 확인해주세요." : "문의 요청을 처리하지 못했습니다.",
  }, { headers, status: error instanceof AccountError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500 });
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const isAdmin = isAccountOperator(user);
    const page = z.coerce.number().int().min(0).max(100000).parse(new URL(request.url).searchParams.get("page") ?? 0);
    let query = db.from("support_inquiries").select("id,user_id,author_name,title,body,created_at,replies:support_replies(id,body,created_at)");
    if (!isAdmin) query = query.eq("user_id", user.id);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .order("created_at", { referencedTable: "replies" }).range(page * pageSize, (page + 1) * pageSize);
    if (error) throw new AccountError("문의 내역을 불러오지 못했습니다.", 503);
    const inquiries = data.slice(0, pageSize).map(({ user_id, ...row }) => ({ ...row, isOwn: user_id === user.id }));
    return Response.json({ inquiries, isAdmin, hasMore: data.length > pageSize }, { headers });
  } catch (error) { return failure(error, headers); }
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const input = mutation.parse(JSON.parse(await readTextBounded(request, 24000)));
    if (input.action === "create") {
      const nickname: unknown = user.user_metadata?.maite_profile?.nickname;
      const authorName = typeof nickname === "string" ? nickname.trim().slice(0, 80) : "";
      const { error } = await db.from("support_inquiries").insert({ user_id: user.id, author_name: authorName || "사용자", title: input.title, body: input.body });
      if (error) throw new AccountError("문의를 등록하지 못했습니다.", 503);
    } else if (input.action === "reply") {
      if (!isAccountOperator(user)) throw new AccountError("답글을 작성할 권한이 없습니다.", 403);
      const { error } = await db.from("support_replies").insert({ inquiry_id: input.id, body: input.body });
      if (error?.code === "23503") throw new AccountError("문의를 찾을 수 없습니다.", 404);
      if (error) throw new AccountError("답글을 등록하지 못했습니다.", 503);
    } else {
      const table = db.from("support_inquiries");
      const query = input.action === "delete" ? table.delete()
        : table.update({ title: input.title, body: input.body, updated_at: new Date().toISOString() });
      const { data, error } = await query.eq("id", input.id).eq("user_id", user.id).select("id").maybeSingle();
      if (error) throw new AccountError("문의를 변경하지 못했습니다.", 503);
      if (!data) throw new AccountError("문의를 찾을 수 없습니다.", 404);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error, headers); }
}
