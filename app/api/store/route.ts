import { z } from "zod";
import { responseTimings } from "@/lib/server/timing";
import { signedImages, thumbnailPath } from "@/lib/server/image-assets";
import { AccountError, requireAccount, rpc, type serviceDb } from "@/lib/server/account";
import { corsHeaders, allowedOrigin, preflight, readTextBounded } from "@/lib/server/http";
import { characterProfileSchema } from "@/lib/chat/character";
import { novelListings, unpublishedNovelRows, isPublishedNovel, listingId, parseLibrarySnapshot } from "@/lib/server/publishing";
import { listingCoverPaths, listingPreviews, selectedListingCover } from "@/lib/server/listing-covers";
import { userProfileSchema } from "@/lib/account/profile";
import { personalizeNovelText } from "@/lib/novel/reader-name";
import { listingImagePaths, novelListingGallery, studioListingGallery } from "@/lib/server/listing-media";
import { MAX_GALLERY_IMAGES } from "@/lib/characters/gallery";
export const OPTIONS = preflight;
const publish = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), profile: characterProfileSchema, description: z.string().max(6000), imageJobId: z.uuid() }).strict(),
  z.object({ kind: z.literal("chapter"), text: z.string().trim().min(1).max(16000), chapter: z.number().int().min(1) }).strict(),
]);
type StoreDb = ReturnType<typeof serviceDb>;
function profileNickname(profile: unknown) {
  const parsed = userProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data.nickname : undefined;
}
async function publishCover(db: StoreDb, sellerId: string, documentId: string, snapshot: ReturnType<typeof parseLibrarySnapshot>, jobId: string, novel: boolean) {
  if (!novel || snapshot.id === documentId || snapshot.gallery.some(image => image.jobId === jobId))
    return selectedListingCover(db, sellerId, snapshot.gallery, jobId);
  const source = await db.from("documents").select("gallery:payload->gallery").eq("id", snapshot.id).eq("user_id", sellerId).is("deleted_at", null).maybeSingle();
  if (source.error) throw new AccountError("캐릭터 갤러리를 확인하지 못했습니다.", 503);
  const gallery = z.array(z.object({jobId: z.uuid().optional(), kind: z.enum(["character", "illustration", "outfit"])})).safeParse(source.data?.gallery);
  return selectedListingCover(db, sellerId, gallery.success ? gallery.data : [], jobId);
}
async function accountNickname(db: StoreDb, userId: string, savedProfile: unknown) {
  const nickname = profileNickname(savedProfile);
  if (nickname) return nickname;
  const { data } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return typeof data?.display_name === "string" ? data.display_name.trim() : undefined;
}
async function legacyAuthorNickname(db: StoreDb, sellerId: string, novelId: unknown) {
  const id = z.uuid().safeParse(novelId);
  const [seller, source] = await Promise.all([
    db.auth.admin.getUserById(sellerId),
    id.success ? db.from("documents").select("character_name:payload->art->profile->>name").eq("id", id.data).eq("user_id", sellerId).maybeSingle() : null,
  ]);
  const nickname = await accountNickname(db, sellerId, seller.data?.user?.user_metadata?.maite_profile);
  return nickname === source?.data?.character_name ? undefined : nickname;
}
async function legacyCharacterDetails(db: StoreDb, listings: {kind:string; seller_id:string; characterAge?:unknown; characterName?:unknown; source_document_id?:string|null; image_job_id?:string|null}[]) {
  const legacy = listings.filter(row => row.kind === "character" && (!row.characterName || !row.characterAge));
  const uuids = (values: unknown[]) => [...new Set(values.filter((id): id is string => z.uuid().safeParse(id).success))];
  const ids = uuids(legacy.map(row => row.source_document_id));
  const jobs = uuids(legacy.map(row => row.image_job_id));
  const columns = "id,user_id,job_id:payload->art->>jobId,name:payload->art->profile->>name,age:payload->art->profile->age";
  const [sources, originals] = await Promise.all([
    ids.length ? db.from("documents").select(columns).in("id", ids) : undefined,
    jobs.length ? db.from("documents").select(columns).in("kind", ["character", "studio"]).in("payload->art->>jobId", jobs) : undefined,
  ]);
  return new Map([...(originals?.data ?? []).map(row => [`job:${row.user_id}:${row.job_id}`,row] as const), ...(sources?.data ?? []).map(row => [`doc:${row.user_id}:${row.id}`,row] as const)]);
}
export async function GET(request: Request) {
  const headers = corsHeaders(request);
  const measure = responseTimings(headers);
  try {
    if (!allowedOrigin(request)) throw new AccountError("허용되지 않은 요청입니다.", 403);
    const { db, user } = await measure("auth", () => requireAccount(request));
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      const checkedId = z.uuid().parse(id);
      const [listing, order] = await measure("listing_db", () => Promise.all([
        db.from("store_listings").select("*").eq("id", checkedId).single(),
        db.from("store_orders").select("id").eq("listing_id", checkedId).eq("buyer_id", user.id).maybeSingle(),
      ]));
      if (listing.error || !listing.data) throw new AccountError("상품을 찾지 못했습니다.", 404);
      if (listing.data.seller_id !== user.id && !order.data) throw new AccountError("구매 후 열람할 수 있습니다.", 403);
      const { content, storage_path: storedPath } = listing.data;
      const [media, chapterText] = await Promise.all([
        measure("listing_media", () => listingImagePaths(db, listing.data)).catch(() => {
          console.warn("listing-gallery-unavailable");
          return [];
        }),
        listing.data.kind === "chapter" && order.data && listing.data.seller_id !== user.id && typeof content?.text === "string" && content.readerNickname !== null
          ? measure("reader_nickname", async () => {
            const [authorNickname, buyerNickname] = await Promise.all([
              typeof content.readerNickname === "string" ? content.readerNickname : legacyAuthorNickname(db, listing.data.seller_id, content.novel?.id),
              accountNickname(db, user.id, user.user_metadata?.maite_profile),
            ]);
            return authorNickname && buyerNickname ? personalizeNovelText(content.text, authorNickname, buyerNickname) : undefined;
          }).catch(() => undefined) : undefined,
      ]);
      const path = storedPath || (listing.data.kind === "chapter"
        ? await listingCoverPaths(db, [listing.data]).then(paths => paths.get(checkedId)).catch(() => undefined) : undefined);
      const paths = [...new Set([path, ...media.map(image => image.path)].filter((item): item is string => !!item))];
      const signed = paths.length ? await measure("storage_sign", () => signedImages.get(db, user.id, paths.flatMap(item => [item, thumbnailPath(item)]))).catch(error => {
        if (listing.data.kind !== "chapter") throw error;
        console.warn("chapter-media-unavailable");
        return new Map<string, string | undefined>();
      }) : new Map<string, string | undefined>();
      const images = media.flatMap(({path: imagePath, ...image}) => {
        const url = signed.get(imagePath);
        return url ? [{ ...image, url, thumbnailUrl: signed.get(thumbnailPath(imagePath)) }] : [];
      });
      const originalUrl = path ? signed.get(path) : undefined;
      const originalThumbnail = path ? signed.get(thumbnailPath(path)) : undefined;
      const { storage_path: _storage, content: _content, ...details } = listing.data;
      const { gallery: _gallery, galleryVersion: _version, coverPath: _cover, ...publicContent } = content ?? {};
      return Response.json({ ...details, content: chapterText === undefined ? publicContent : { ...publicContent, text: chapterText }, images, imageUrl: originalUrl, thumbnailUrl: originalThumbnail }, { headers: { ...headers, "Cache-Control": "private, no-store" } });
    }
    const novelId = params.get("novel");
    if (novelId) {
      const checkedId = z.uuid().parse(novelId);
      const result = await measure("novel_listings", () => db.from("store_listings")
        .select("id,kind,title,active,novel:content->novel,chapter:content->chapter,purchases:store_orders(listing_id)")
        .eq("kind", "chapter")
        .or(`content->novel->>id.eq.${checkedId},id.eq.${checkedId}`)
        .eq("purchases.buyer_id", user.id));
      if (result.error) throw new AccountError("소설 회차를 불러오지 못했습니다.", 503);
      const owned = (result.data ?? []).filter(row => row.purchases.length).map(row => row.id);
      const ownedIds = new Set(owned);
      const listings = (result.data ?? []).map(({ purchases: _purchases, ...row }) => ({
        ...row,
        active: row.active && isPublishedNovel(row.novel),
      })).filter(row => row.active || ownedIds.has(row.id));
      return Response.json({ listings, owned }, { headers: { ...headers, "Cache-Control": "private, no-store" } });
    }
    const columns = "id,seller_id,kind,title,description,created_at,active,storage_path,cover_path:content->>coverPath,authorNickname:content->>authorNickname,characterName:content->profile->>name,characterAge:content->profile->age,source_document_id:content->>sourceDocumentId,image_job_id:content->>imageJobId,novel:content->novel,chapter:content->chapter";
    const [orders, active, selling] = await measure("store_db", () => Promise.all([
      db.from("store_orders").select("listing_id").eq("buyer_id", user.id).order("created_at", { ascending: false }).limit(1000),
      db.from("store_listings").select(columns).eq("active", true).order("created_at", { ascending: false }).limit(100),
      db.from("store_listings").select(columns).eq("seller_id", user.id).order("created_at", { ascending: false }).limit(100),
    ]));
    if (orders.error) throw new AccountError("구매 기록을 불러오지 못했습니다.", 503);
    const owned = orders.data.map(order => order.listing_id);
    const visibleIds = new Set([...(active.data ?? []), ...(selling.data ?? [])].map(row => row.id));
    const missing = owned.filter(id => !visibleIds.has(id)).slice(0,100);
    const purchased = missing.length ? await measure("owned_db", () => db.from("store_listings").select(columns).in("id", missing)) : { data: [], error: null };
    const results = [active, selling, purchased];
    if (results.some(result => result.error)) throw new AccountError("스토어를 불러오지 못했습니다.", 503);
    const listings = [...new Map(results.flatMap(result => result.data ?? []).map(listing => [listing.id, listing])).values()]
      .map(listing => ({ ...listing, active: listing.active && (listing.kind !== "chapter" || isPublishedNovel(listing.novel)) }))
      .filter(listing => listing.active || listing.seller_id === user.id || owned.includes(listing.id));
    const legacySellerIds = [...new Set(listings.filter(row => !row.authorNickname && row.seller_id !== user.id).map(row => row.seller_id))];
    const previews = measure("cover_images", () => listingPreviews(db, user.id, listings)).catch(() => {
      console.warn("store-cover-unavailable");
      return new Map<string,string|undefined>();
    });
    const [images, legacyProfiles, ownNickname, legacyCharacters] = await Promise.all([
      previews,
      legacySellerIds.length ? db.from("profiles").select("id,display_name").in("id", legacySellerIds) : undefined,
      listings.some(row => !row.authorNickname && row.seller_id === user.id) ? accountNickname(db, user.id, user.user_metadata?.maite_profile) : undefined,
      legacyCharacterDetails(db, listings),
    ]);
    const authorNames = new Map((legacyProfiles?.data ?? []).map(profile => [profile.id, profile.display_name]));
    return Response.json({ listings: listings.map(({storage_path: _path, cover_path: _cover, source_document_id, image_job_id, ...listing}) => {
      const original = legacyCharacters.get(`doc:${listing.seller_id}:${source_document_id}`) ?? legacyCharacters.get(`job:${listing.seller_id}:${image_job_id}`);
      return {...listing,
        characterName: listing.characterName || original?.name,
        characterAge: listing.characterAge ?? original?.age,
        authorNickname: listing.authorNickname || (listing.seller_id === user.id ? ownNickname : authorNames.get(listing.seller_id)),
        thumbnailUrl:images.get(listing.id),
      };
    }), owned }, { headers });
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
      z.object({ action: z.literal("publishNovel"), documentId: z.uuid(), title: z.string().trim().min(1).max(100), description: z.string().trim().max(2000), coverJobId: z.uuid().optional() }).strict(),
      z.object({ action: z.literal("publishCharacter"), documentId: z.uuid(), title: z.string().trim().min(1).max(100), description: z.string().trim().max(2000), coverJobId: z.uuid().optional() }).strict(),
      z.object({ action: z.literal("unpublish"), listingId: z.uuid() }).strict(),
      z.object({ action: z.literal("setSaleStatus"), listingId: z.uuid(), active: z.boolean() }).strict(),
    ]).parse(JSON.parse(text));
    if (input.action === "buy") {
      const listing = await db.from("store_listings").select("kind,content").eq("id", input.listingId).single();
      if (listing.error || !listing.data) throw new AccountError("구매할 상품을 찾지 못했습니다.", 404);
      if (listing.data.kind === "chapter" && !isPublishedNovel(listing.data.content?.novel)) throw new AccountError("소설로 등록된 회차만 구매할 수 있습니다.", 409);
      return Response.json(await rpc("buy_listing", { p_user: user.id, p_id: input.id, p_listing: input.listingId }), { headers });
    }
    if (input.action === "setSaleStatus") {
      const { data: listing, error } = await db.from("store_listings").select("kind,content").eq("id", input.listingId).eq("seller_id", user.id).maybeSingle();
      if (error) throw new AccountError("판매 상태를 확인하지 못했습니다.", 503);
      if (!listing) throw new AccountError("본인의 판매 상품을 선택해주세요.", 404);
      const novelId = listing.kind === "chapter" && isPublishedNovel(listing.content?.novel) ? listing.content.novel.id as string : undefined;
      if (input.active) {
        const source = z.uuid().safeParse(novelId ?? listing.content?.sourceDocumentId);
        if (!source.success && (listing.kind === "chapter" || !z.uuid().safeParse(listing.content?.imageJobId).success))
          throw new AccountError("원본 작품이 없는 상품은 다시 판매할 수 없습니다.", 409);
        let documents = db.from("documents").select("id").eq("user_id", user.id).is("deleted_at", null);
        documents = source.success ? documents.eq("id", source.data) : documents.eq("payload->art->>jobId", listing.content.imageJobId).in("kind", ["character", "studio"]);
        const original = await documents.limit(1).maybeSingle();
        if (original.error) throw new AccountError("원본 작품을 확인하지 못했습니다.", 503);
        if (!original.data) throw new AccountError("원본 작품이 없는 상품은 다시 판매할 수 없습니다.", 409);
      }
      const update = db.from("store_listings").update({ active: input.active }).eq("seller_id", user.id);
      const result = await (novelId ? update.eq("kind", "chapter").eq("content->novel->>id", novelId) : update.eq("id", input.listingId));
      if (result.error) throw new AccountError("판매 상태를 변경하지 못했습니다.", 503);
    } else if (input.action === "unpublish") {
      const { error } = await db.from("store_listings").update({ active: false }).eq("id", input.listingId).eq("seller_id", user.id);
      if (error) throw new AccountError("등록을 해제하지 못했습니다.", 503);
    } else if (input.action === "publishNovel" || input.action === "publishCharacter") {
      const document = await db.from("documents").select("payload").eq("id", input.documentId).eq("user_id", user.id).is("deleted_at", null).single();
      if (document.error || !document.data) throw new AccountError("본인의 저장된 작품을 선택해주세요.", 404);
      const snapshot = parseLibrarySnapshot(document.data.payload);
      const [coverPath, authorNickname, studioGallery] = await Promise.all([
        input.coverJobId ? publishCover(db, user.id, input.documentId, snapshot, input.coverJobId, input.action === "publishNovel") : undefined,
        accountNickname(db, user.id, user.user_metadata?.maite_profile),
        input.action === "publishNovel" && snapshot.id !== input.documentId ? studioListingGallery(db, user.id, snapshot.id) : [],
      ]);
      let rows: { id: string; seller_id: string; kind: string; title: string; description: string; storage_path: string | null; active?: boolean; content: Record<string, unknown> }[];
      if (input.action === "publishNovel") {
        let query = db.from("generation_jobs").select("result").eq("user_id", user.id).eq("kind", "story").eq("status", "completed");
        query = snapshot.story.lastJobId ? query.eq("id", snapshot.story.lastJobId)
          : query.contains("result", { events: [{ type: "chapter", text: snapshot.story.storyState?.previousProse ?? "" }] });
        const generated = await query.limit(1).maybeSingle();
        if (generated.error || !generated.data) throw new AccountError("소설의 생성 기록을 확인할 수 없습니다.", 409);
        rows = novelListings({ payload: snapshot, result: generated.data.result, owner: user.id, documentId: input.documentId, title: input.title, description: input.description });
        const existing=await db.from("store_listings").select("id,content,active").eq("seller_id",user.id).in("id",rows.map(row=>row.id));
        if(existing.error)throw new AccountError("기존 판매 회차를 확인하지 못했습니다.",503);
        rows=unpublishedNovelRows(rows,existing.data??[]);
        if(!rows.length)return Response.json({ok:true,published:0},{headers});
        const covers = await listingCoverPaths(db, rows);
        const active = !existing.data?.length || existing.data.some(row => row.active);
        rows = rows.map(row => ({...row,active,storage_path:covers.get(row.id)??null}));
      } else {
        if (!snapshot.art.jobId) throw new AccountError("직접 생성한 캐릭터만 판매할 수 있습니다.", 409);
        const image = await db.from("generation_jobs").select("storage_path").eq("id", snapshot.art.jobId).eq("user_id", user.id).eq("kind", "character").eq("status", "completed").single();
        if (image.error || !image.data?.storage_path) throw new AccountError("본인이 생성한 캐릭터 이미지를 확인할 수 없습니다.", 409);
        rows = [{ id: listingId(user.id, input.documentId, 0), seller_id: user.id, kind: "character", title: input.title, description: input.description,
          storage_path: image.data.storage_path, content: { kind: "character", profile: snapshot.art.profile, description: snapshot.art.description, imageJobId: snapshot.art.jobId, sourceDocumentId: input.documentId } }];
      }
      const gallery = (await novelListingGallery(db, rows[0], [...snapshot.gallery, ...studioGallery])).slice(0, MAX_GALLERY_IMAGES - 1);
      rows = rows.map(row => ({ ...row, content: { ...row.content, gallery, galleryVersion: 2, authorNickname, ...(coverPath ? { coverPath } : {}) } }));
      // One atomic insert: no partially published novel or duplicated chapters on retry.
      const inserted = await db.from("store_listings").insert(rows);
      if (inserted.error) throw new AccountError(inserted.error.code === "23505" ? "이미 등록한 작품입니다. 스토어에서 확인해주세요." : "스토어에 등록하지 못했습니다.", inserted.error.code === "23505" ? 409 : 503);
      if (input.action === "publishNovel") {
        const renamed = await db.from("documents").update({ title: input.title }).eq("id", input.documentId).eq("user_id", user.id);
        if (renamed.error) return Response.json({ ok: true, warning: "판매 등록은 완료됐지만 보관함 제목을 갱신하지 못했습니다." }, { headers });
      }
    } else {
      if (input.content.kind === "chapter") throw new AccountError("소설 상세 화면에서 제목을 정해 등록해주세요.", 409);
      let storage: string | null = null;
      if (input.content.kind === "character") {
        const { data } = await db.from("generation_jobs").select("storage_path").eq("id", input.content.imageJobId).eq("user_id", user.id).eq("status", "completed").single();
        if (!data?.storage_path) throw new AccountError("본인이 생성한 캐릭터 이미지를 선택해주세요."); storage = data.storage_path;
      }
      const authorNickname = await accountNickname(db, user.id, user.user_metadata?.maite_profile);
      const { error } = await db.from("store_listings").insert({ seller_id: user.id, kind: input.content.kind, title: input.title, description: input.description, content: {...input.content, authorNickname}, storage_path: storage });
      if (error) throw new AccountError("스토어에 등록하지 못했습니다.", 503);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof AccountError ? error.message : "요청을 확인해주세요." }, { status: error instanceof AccountError ? error.status : 400, headers }); }
}
