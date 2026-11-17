import { z } from "zod";
import { AccountError, requireAccount, rpc } from "@/lib/server/account";
import { corsHeaders, allowedOrigin, preflight, readTextBounded } from "@/lib/server/http";
import { characterProfileSchema } from "@/lib/chat/character";
import { completedNovelListings, isPublishedNovel, listingId, parseLibrarySnapshot } from "@/lib/server/publishing";
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
    const columns = "id,seller_id,kind,title,description,created_at,active,novel:content->novel,chapter:content->chapter";
    const results = await Promise.all([
      db.from("store_listings").select(columns).eq("active", true).order("created_at", { ascending: false }).limit(100),
      db.from("store_listings").select(columns).eq("seller_id", user.id).order("created_at", { ascending: false }).limit(100),
      owned.length ? db.from("store_listings").select(columns).in("id", owned.slice(0,100)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (results.some(result => result.error)) throw new AccountError("스토어를 불러오지 못했습니다.", 503);
    const listings = [...new Map(results.flatMap(result => result.data ?? []).map(listing => [listing.id, listing])).values()]
      .map(listing => ({ ...listing, active: listing.active && (listing.kind !== "chapter" || isPublishedNovel(listing.novel)) }))
      .filter(listing => listing.active || listing.seller_id === user.id || owned.includes(listing.id));
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
      z.object({ action: z.literal("publishNovel"), documentId: z.uuid(), title: z.string().trim().min(1).max(100), description: z.string().trim().max(2000) }).strict(),
      z.object({ action: z.literal("publishCharacter"), documentId: z.uuid(), title: z.string().trim().min(1).max(100), description: z.string().trim().max(2000) }).strict(),
      z.object({ action: z.literal("unpublish"), listingId: z.uuid() }).strict(),
    ]).parse(JSON.parse(text));
    if (input.action === "buy") {
      const listing = await db.from("store_listings").select("kind,content").eq("id", input.listingId).single();
      if (listing.error || !listing.data) throw new AccountError("구매할 상품을 찾지 못했습니다.", 404);
      if (listing.data.kind === "chapter" && !isPublishedNovel(listing.data.content?.novel)) throw new AccountError("완결 소설로 등록된 상품만 구매할 수 있습니다.", 409);
      return Response.json(await rpc("buy_listing", { p_user: user.id, p_id: input.id, p_listing: input.listingId }), { headers });
    }
    if (input.action === "unpublish") {
      const { error } = await db.from("store_listings").update({ active: false }).eq("id", input.listingId).eq("seller_id", user.id);
      if (error) throw new AccountError("등록을 해제하지 못했습니다.", 503);
    } else if (input.action === "publishNovel" || input.action === "publishCharacter") {
      const document = await db.from("documents").select("payload").eq("id", input.documentId).eq("user_id", user.id).is("deleted_at", null).single();
      if (document.error || !document.data) throw new AccountError("본인의 저장된 작품을 선택해주세요.", 404);
      const snapshot = parseLibrarySnapshot(document.data.payload);
      let rows: { id: string; seller_id: string; kind: string; title: string; description: string; storage_path: string | null; content: Record<string, unknown> }[];
      if (input.action === "publishNovel") {
        let query = db.from("generation_jobs").select("result").eq("user_id", user.id).eq("kind", "story").eq("status", "completed");
        query = snapshot.story.lastJobId ? query.eq("id", snapshot.story.lastJobId)
          : query.contains("result", { events: [{ type: "chapter", text: snapshot.story.storyState?.previousProse ?? "" }] });
        const finale = await query.limit(1).maybeSingle();
        if (finale.error || !finale.data) throw new AccountError("완결된 소설의 생성 기록을 확인할 수 없습니다.", 409);
        rows = completedNovelListings({ payload: snapshot, result: finale.data.result, owner: user.id, documentId: input.documentId, title: input.title, description: input.description });
      } else {
        if (!snapshot.art.jobId) throw new AccountError("직접 생성한 캐릭터만 판매할 수 있습니다.", 409);
        const image = await db.from("generation_jobs").select("storage_path").eq("id", snapshot.art.jobId).eq("user_id", user.id).eq("kind", "character").eq("status", "completed").single();
        if (image.error || !image.data?.storage_path) throw new AccountError("본인이 생성한 캐릭터 이미지를 확인할 수 없습니다.", 409);
        rows = [{ id: listingId(user.id, input.documentId, 0), seller_id: user.id, kind: "character", title: input.title, description: input.description,
          storage_path: image.data.storage_path, content: { kind: "character", profile: snapshot.art.profile, description: snapshot.art.description, imageJobId: snapshot.art.jobId, sourceDocumentId: input.documentId } }];
      }
      // One atomic insert: no partially published novel or duplicated chapters on retry.
      const inserted = await db.from("store_listings").insert(rows);
      if (inserted.error) throw new AccountError(inserted.error.code === "23505" ? "이미 등록한 작품입니다. 스토어에서 확인해주세요." : "스토어에 등록하지 못했습니다.", inserted.error.code === "23505" ? 409 : 503);
      if (input.action === "publishNovel") {
        const renamed = await db.from("documents").update({ title: input.title }).eq("id", input.documentId).eq("user_id", user.id);
        if (renamed.error) return Response.json({ ok: true, warning: "판매 등록은 완료됐지만 보관함 제목을 갱신하지 못했습니다." }, { headers });
      }
    } else {
      if (input.content.kind === "chapter") throw new AccountError("완결된 소설 상세 화면에서 제목을 정해 등록해주세요.", 409);
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
