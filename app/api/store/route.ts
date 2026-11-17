import { z } from "zod";
import { AccountError, requireAccount, rpc } from "@/lib/server/account";
import { corsHeaders, allowedOrigin, preflight, readTextBounded } from "@/lib/server/http";
import { characterProfileSchema } from "@/lib/chat/character";
export const OPTIONS = preflight;
const publish = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), profile: characterProfileSchema, description: z.string().max(6000), imageJobId: z.uuid() }).strict(),
  z.object({ kind: z.literal("chapter"), text: z.string().trim().min(1).max(16000), chapter: z.number().int().min(1) }).strict(),
]);
export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request); const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const listing = await db.from("store_listings").select("*").eq("id", z.uuid().parse(id)).single();
      if (listing.error || !listing.data) throw new AccountError("상품을 찾지 못했습니다.", 404);
      const order = await db.from("store_orders").select("id").eq("listing_id", id).eq("buyer_id", user.id).maybeSingle();
      if (listing.data.seller_id !== user.id && !order.data) throw new AccountError("구매 후 열람할 수 있습니다.", 403);
      const signed = listing.data.storage_path ? await db.storage.from("maite-private").createSignedUrl(listing.data.storage_path, 300) : undefined;
      return Response.json({ ...listing.data, imageUrl: signed?.data?.signedUrl }, { headers });
    }
    const orders = await db.from("store_orders").select("listing_id").eq("buyer_id", user.id).order("created_at", { ascending: false }).limit(1000);
    if (orders.error) throw new AccountError("구매 기록을 불러오지 못했습니다.", 503);
    const owned = orders.data.map(order => order.listing_id);
    const columns = "id,seller_id,kind,title,description,created_at,active";
    const results = await Promise.all([
      db.from("store_listings").select(columns).eq("active", true).order("created_at", { ascending: false }).limit(100),
      db.from("store_listings").select(columns).eq("seller_id", user.id).order("created_at", { ascending: false }).limit(100),
      owned.length ? db.from("store_listings").select(columns).in("id", owned.slice(0,100)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (results.some(result => result.error)) throw new AccountError("스토어를 불러오지 못했습니다.", 503);
    const listings = [...new Map(results.flatMap(result => result.data ?? []).map(listing => [listing.id, listing])).values()];
    return Response.json({ listings, owned }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "요청을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await requireAccount(request);
    const text = await readTextBounded(request, 60000);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("buy"), id: z.uuid(), listingId: z.uuid() }).strict(),
      z.object({ action: z.literal("publish"), title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000), content: publish }).strict(),
      z.object({ action: z.literal("unpublish"), listingId: z.uuid() }).strict(),
    ]).parse(JSON.parse(text));
    if (input.action === "buy") return Response.json(await rpc("buy_listing", { p_user: user.id, p_id: input.id, p_listing: input.listingId }), { headers });
    if (input.action === "unpublish") {
      const { error } = await db.from("store_listings").update({ active: false }).eq("id", input.listingId).eq("seller_id", user.id);
      if (error) throw new AccountError("등록을 해제하지 못했습니다.", 503);
    } else {
      let storage: string | null = null;
      if (input.content.kind === "character") {
        const { data } = await db.from("generation_jobs").select("storage_path").eq("id", input.content.imageJobId).eq("user_id", user.id).eq("status", "completed").single();
        if (!data?.storage_path) throw new AccountError("본인이 생성한 캐릭터 이미지를 선택해주세요."); storage = data.storage_path;
      }
      const { error } = await db.from("store_listings").insert({ seller_id: user.id, kind: input.content.kind, title: input.title, description: input.description, content: input.content, storage_path: storage });
      if (error) throw new AccountError("스토어에 등록하지 못했습니다.", 503);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "요청을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
