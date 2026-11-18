import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { fillCharacterProfile } from "../browser/character-helpers";
import { snapshotSchema } from "../../lib/platform/snapshot";
import { createStudioSessions } from "../../lib/chat/session";
import { emptyStoryState } from "../../lib/novel/state";

const userId = "11111111-1111-4111-8111-111111111111";
const characterId = "22222222-2222-4222-8222-222222222222";
const novelId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const archive = Array.from({ length: 5 }, (_, index) => [{ role: "user" as const, content: "비공개 지시" }, { role: "assistant" as const, content: `${index + 1}번째 회차의 원고입니다.` }]).flat();
const sessions = createStudioSessions();
const snapshot = snapshotSchema.parse({ version: 1, id: characterId,
  art: { title: "희진", summary: "서점에서 시작된 이야기", prompt: "private", style: "neutral", description: "서점", profile: { name: "희진", age: 25, personality: "다정함", concept: "서점의 친구" }, width: 72, height: 128, jobId },
  chat: sessions.chat, story: { ...sessions.story, documentId: novelId, lastJobId: jobId, archive, storyState: { ...emptyStoryState(), chapter: 5, previousProse: archive.at(-1)!.content } }, timeline: sessions.chat.timeline.state });

test("bookshelf replaces newface and remembers a separate last-read chapter",async({page})=>{
 await signIn(page);await accountRoutes(page);
 await page.route("**/api/store",route=>route.fulfill({json:{listings:[],owned:[]}}));
 await page.goto("/ideal/library");
 const footer=page.getByRole("navigation",{name:"하단 메뉴"});await expect(footer.getByRole("link")).toHaveText(["캐릭터","서고","서점","스토어","마이페이지"]);
 await page.getByRole("link",{name:/희진의 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("1번째 회차");
 await page.getByRole("button",{name:"다음 이야기 보기",exact:true}).click();await page.getByRole("button",{name:"다음 이야기 보기",exact:true}).click();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await footer.getByRole("link",{name:"서고",exact:true}).click();await page.getByRole("link",{name:/희진의 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await page.reload();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await footer.getByRole("link",{name:"캐릭터",exact:true}).click();await page.getByRole("link",{name:"새 캐릭터 만들기",exact:true}).click();await expect(page.getByLabel("캐릭터 이름")).toBeVisible();
});

test("calendar claims today's attendance and missed pass days only on explicit action",async({page})=>{
 await signIn(page);await accountRoutes(page);let calls:any[]=[];
 const calendar={today:"2026-11-18",month:"2026-11-01",claims:[] as {day:string;kind:string;amount:number}[],passes:[{starts_on:"2026-11-01",ends_on:"2026-12-01",daily_hearts:20}]};
 await page.route("**/api/rewards**",route=>{
  if(route.request().method()==="POST"){const body=route.request().postDataJSON();calls.push(body);const amount=body.kind==="pass"?20:5;calendar.claims.push({...body,amount});return route.fulfill({json:{claimed:amount}});}
  return route.fulfill({json:calendar});
 });
 await page.goto("/ideal/mypage");await page.getByRole("link",{name:"출석보상",exact:true}).click();
 await expect(page.getByRole("heading",{name:"출석·패스 보상"})).toBeVisible();expect(calls).toHaveLength(0);
 await page.getByRole("button",{name:"2026-11-17",exact:true}).click();
 await expect(page.getByRole("button",{name:"수령 불가",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"패스 보상 받기",exact:true}).click();await expect(page.getByRole("status")).toContainText("20하트");expect(calls).toEqual([{kind:"pass",day:"2026-11-17"}]);
 await page.getByRole("button",{name:"2026-11-18 오늘",exact:true}).click();await page.getByRole("button",{name:"보상 받기",exact:true}).click();await expect(page.getByRole("status")).toContainText("5하트");
 await page.getByRole("button",{name:"2026-11-19",exact:true}).click();await expect(page.getByRole("button",{name:"아직 받을 수 없어요",exact:true})).toHaveCount(2);
 await page.getByRole("button",{name:"2026-11-18 오늘",exact:true}).click();
 const rewardRow=page.locator(".reward-claim-row").first();
 expect((await rewardRow.locator("strong").boundingBox())!.width).toBeGreaterThan(80);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:".verification/reward-calendar.png",fullPage:true});
});

test("purchased chapters appear in the bookshelf and resume independently",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const listingA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",listingB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
 const listings=[{id:listingA,kind:"chapter",title:"구매작 #1",chapter:1,novel:{id:jobId,title:"구매한 이야기",chapters:2}},{id:listingB,kind:"chapter",title:"구매작 #2",chapter:2,novel:{id:jobId,title:"구매한 이야기",chapters:2}}];
 await page.route("**/api/store**",route=>{const id=new URL(route.request().url()).searchParams.get("id");return route.fulfill({json:id?{content:{text:id===listingA?"구매한 첫 회차":"구매한 둘째 회차"}}:{listings,owned:[listingA,listingB]}});});
 await page.goto("/ideal/library");await page.getByRole("link",{name:/구매한 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 첫 회차");
 await page.getByRole("button",{name:"다음 이야기 보기",exact:true}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 둘째 회차");
 await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"서고",exact:true}).click();await page.getByRole("link",{name:/구매한 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 둘째 회차");
});

async function signIn(page: Page) {
  await page.addInitScript(({ userId }) => {
    const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, user: { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.com", app_metadata: {}, user_metadata: { full_name: "테스트" }, created_at: new Date().toISOString() } };
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, { userId });
}
async function accountRoutes(page: Page, complete = true, deleted: string[] = []) {
  const saved = structuredClone(snapshot);
  if (!complete) { saved.story.storyState!.chapter = 3; saved.story.storyState!.nextChapterGoal = "다음 사건"; const partial = archive.slice(0, 6); saved.story.archive = partial; saved.story.storyState!.previousProse = partial.at(-1)!.content; }
  await page.route("**/api/account**", async route => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe("Bearer test-access-token");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "deleteCharacter") deleted.push(body.id);
      return route.fulfill({ json: { ok: true, claimed: 0 } });
    }
    if (url.searchParams.has("document")) return route.fulfill({ json: { id: url.searchParams.get("document"), title: "희진의 이야기", payload: saved, media: { original: "https://example.test/image.jpg", gallery: {} } } });
    if (url.searchParams.has("job")) return route.fulfill({ json: { imageUrl: "https://example.test/image.jpg" } });
    return route.fulfill({ json: { userId, email: "test@example.com", profile: { display_name: "테스트" }, wallet: { transferable: 1000, bonus: 5, free_chats: 5 }, documents: deleted.length ? [] : [
      { id: characterId, title: "희진", kind: "studio", character_name: "희진", chapter: String(saved.story.storyState!.chapter), novel_id: novelId },
      { id: novelId, title: "희진의 이야기", kind: "chapter", chapter: String(saved.story.storyState!.chapter), next_goal: complete ? "" : "다음 사건" },
    ], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.route("https://example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128"/>' }));
  await page.route("**/api/notifications**",route=>route.fulfill({json:{pushEnabled:false,quietHours:true,available:true,activities:[],messages:[]}}));
}

test("initial anonymous launch requires Google login before showing the creation screen", async ({ page }) => {
  await page.goto("/ideal");
  await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
  await expect(page.getByLabel("캐릭터 이름")).toHaveCount(0);
  await page.route("http://127.0.0.1:54321/auth/v1/authorize**", route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:3101/ideal");
    return route.fulfill({ contentType: "text/html", body: "Google 로그인 테스트" });
  });
  await page.getByRole("button", { name: "Google로 로그인", exact: true }).click();
  await expect(page).toHaveURL(/auth\/v1\/authorize/);
});

test("character deletion requires confirmation and removes the private library entry", async ({ page }) => {
  const deleted: string[] = [];
  await signIn(page); await accountRoutes(page, true, deleted);
  await page.goto(`/ideal/characters/${characterId}`);
  const remove = page.getByRole("button", { name: "캐릭터 삭제", exact: true });
  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("기존 구매자의 작품");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(deleted).toEqual([]);
  await remove.click();
  await dialog.getByRole("button", { name: "캐릭터 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/characters$/);
  await expect(page.locator(".native-character-card")).toHaveCount(0);
  expect(deleted).toEqual([characterId]);
});

test("signed-in launch shows creation, footer navigation, account details and character publication", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const published: unknown[] = [];
  await page.route("**/api/store", route => { published.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.goto("/ideal");
  await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "서고", "서점", "스토어", "마이페이지"]);
  await footer.getByRole("link", { name: "마이페이지", exact: true }).click();
  await expect(page.getByText("test@example.com", { exact: true })).toBeVisible();
  await expect(page.locator(".heart-total")).toContainText("1,005");
  await page.screenshot({ path: ".verification/account-mypage.png", fullPage: true });
  await footer.getByRole("link", { name: "캐릭터", exact: true }).click();
  await page.locator(".native-character-card").filter({ hasText: "희진" }).click();
  await expect(page.locator(".character-detail")).toBeVisible();
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "판매 등록", exact: true }).click();
  await expect(page.getByText("서점에 판매 등록했습니다.", { exact: true })).toBeVisible();
  expect(published).toEqual([{ action: "publishCharacter", documentId: characterId, title: "희진", description: "서점에서 시작된 이야기" }]);
});

test("complete novel detail reads individual chapters and publishes a chosen work title", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let published: unknown;
  await page.route("**/api/store", route => { published = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto(`/ideal/novels/${novelId}`);
  await expect(page.locator(".novel-reader")).toBeVisible();
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await page.locator(".novel-reader").dispatchEvent("touchstart", { touches: [{ identifier: 0, clientX: 220, clientY: 300 }] });
  await page.locator(".novel-reader").dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 0, clientX: 100, clientY: 310 }] });
  await expect(page.locator(".novel-reader")).toContainText("3번째 회차의 원고입니다.");
  await expect(page.locator(".novel-reader")).not.toContainText("비공개 지시");
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  const sale=page.getByRole("dialog",{name:"소설 판매 등록",exact:true});await expect(sale).toBeVisible();
  await page.getByLabel("소설 제목", { exact: true }).fill("서점에서의 마지막 약속");
  await sale.getByRole("button", { name: "판매 등록하기", exact: true }).click();
  await expect(page.getByText("서점에 판매 등록했습니다.", { exact: true })).toBeVisible();
  expect(published).toEqual({ action: "publishNovel", documentId: novelId, title: "서점에서의 마지막 약속", description: "서점에서 시작된 이야기" });
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeInViewport();
  await page.screenshot({ path: ".verification/account-novel-detail.png", fullPage: true });
});

test("novel text scrolls inside a bounded background while side arrows and sale toolbar remain visible",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.archive![1].content="소설의 긴 문단을 읽습니다.\n\n".repeat(180);saved.story.committed=saved.story.archive!;
 await page.route(`**/api/account?document=${novelId}`,route=>route.fulfill({json:{id:novelId,title:"긴 소설",payload:saved}}));
 await page.setViewportSize({width:390,height:844});await page.goto(`/ideal/novels/${novelId}`);
 const reader=page.locator(".saved-novel-reader"),scroll=page.getByLabel("소설 본문",{exact:true});
 await expect(reader).toBeVisible();await expect(page.locator(".saved-novel-background")).toBeVisible();
 const box=(await reader.boundingBox())!,next=page.getByRole("button",{name:"다음 이야기 보기",exact:true});
 const arrow=(await next.boundingBox())!;expect(Math.abs(arrow.y+arrow.height/2-box.y-box.height/2)).toBeLessThan(3);
 expect(box.height).toBeLessThan(720);expect(box.height).toBeGreaterThan(350);
 await scroll.evaluate(element=>element.scrollTop=600);expect(await scroll.evaluate(element=>element.scrollTop)).toBeGreaterThan(400);
 const after=(await next.boundingBox())!;expect(Math.abs(after.y-arrow.y)).toBeLessThan(1);
 const back=(await page.getByRole("link",{name:"서고",exact:true}).first().boundingBox())!,sale=(await page.getByRole("button",{name:"서점에 판매 등록",exact:true}).boundingBox())!;
 expect(Math.abs(back.y-sale.y)).toBeLessThan(3);await expect(next).toBeInViewport();
 await next.click();expect(await page.getByLabel("소설 본문",{exact:true}).evaluate(element=>element.scrollTop)).toBe(0);
 await expect(page.locator(".novel-reader")).toContainText("2번째 회차");
 await page.screenshot({path:".verification/novel-reader-centered.png"});
});

test("scene keywords appear in image confirmation dialogs rather than generation buttons",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);
 saved.chat.committed=[{role:"user",content:"여기 떡볶이집이야."},{role:"assistant",content:"응 들어가자."}];saved.chat.archive=saved.chat.committed;
 saved.chat.visualDetected=true;saved.chat.latestVisualChange=true;saved.chat.visualScene={location:"떡볶이집",outfit:"흰 셔츠",turn:1};
 saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;saved.story.archive![1].content="희진은 이곳에 없었다. 햄군은 민수와 카페에서 마주 앉았다. 민수는 검은 코트를 입었다.";saved.story.storyState!.characters.push({name:"민수",goal:"대화",knowledge:[],relationships:[]});
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let images=0;await page.route("**/api/characters",route=>{images++;return route.abort();});
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
 const button=page.getByRole("button",{name:"이미지 생성",exact:true});await expect(button.locator("small")).toHaveCount(0);await button.click();
 const popup=page.getByRole("dialog");await expect(popup.locator(".scene-details-list dt")).toHaveText(["장소","의상","등장인물"]);await expect(popup.getByLabel("장면 장소")).toHaveValue("떡볶이집");await expect(popup.getByLabel("장면 의상")).toHaveValue("흰 셔츠");await expect(popup.locator(".scene-details-list dd").last()).toHaveText("희진 (이미지 대상)");await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
 await page.getByRole("button",{name:"캐릭터 이미지로 돌아가기",exact:true}).click();await expect(page).toHaveURL(/\/ideal\/new$/);
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();
 const illustration=page.getByRole("button",{name:"삽화 생성",exact:true});await expect(illustration.locator("small")).toHaveCount(0);await illustration.click();
 await expect(popup.getByLabel("장면 장소")).toHaveValue("카페");await expect(popup.getByLabel("장면 의상")).toHaveValue("검은 코트");await expect(popup.locator(".scene-details-list dd").last()).toHaveText("민수 (이미지 대상)");await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
});

test("chat images can be requested before the first dialogue with user-selected location and outfit",async({page})=>{
 await signIn(page);await accountRoutes(page);
 let chats=0,images=0,selection:any;
 await page.route("**/api/chat",route=>{chats++;return route.abort();});
 await page.route("**/api/characters",async route=>{
  images++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();selection=JSON.parse(String(form.get("scene"))).selection;
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
 const button=page.getByRole("button",{name:"이미지 생성",exact:true});await expect(button).toBeEnabled();await button.click();
 const popup=page.getByRole("dialog");await popup.getByLabel("장면 장소").fill("해변 산책로");await popup.getByLabel("장면 의상").fill("흰 원피스");expect(images).toBe(0);
 await popup.getByRole("button",{name:"그림 만들기",exact:true}).click();await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");
 expect(selection).toMatchObject({confirmed:true,location:"해변 산책로",outfit:"흰 원피스",target:"희진"});expect(images).toBe(1);expect(chats).toBe(0);await expect(button).toBeEnabled();
});

test("a novel illustration can focus a manually entered counterpart while the original character is present",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;
 saved.story.archive![1].content="희진은 흰 드레스를 입고 왕궁 연회장에 들어갔다. 민수는 검은 갑옷을 입고 왕 앞에 무릎을 꿇었다.";
 saved.story.storyState!.characters.push({name:"민수",goal:"왕에게 보고",knowledge:[],relationships:[]});
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let images=0,scene:any;
 await page.route("**/api/characters",async route=>{
  images++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();scene=JSON.parse(String(form.get("scene")));
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();
 await page.getByRole("button",{name:"삽화 생성",exact:true}).click();const popup=page.getByRole("dialog");
 await expect(popup.getByLabel("삽화 대상 인물")).toHaveValue("희진");
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
 await page.getByRole("button",{name:"삽화 생성",exact:true}).click();
 await popup.getByLabel("삽화 대상 인물").fill("민수");await expect(popup.getByLabel("장면 의상")).toHaveValue("");
 await expect(popup.getByRole("button",{name:"그림 만들기",exact:true})).toBeDisabled();
 await popup.getByLabel("장면 장소").fill("왕궁 연회장");await popup.getByLabel("장면 의상").fill("검은 갑옷");
 await popup.getByRole("button",{name:"그림 만들기",exact:true}).click();await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");
 expect(images).toBe(1);expect(scene.selection).toMatchObject({target:"민수",targetConfirmed:true,confirmed:true,location:"왕궁 연회장",outfit:"검은 갑옷"});
 expect(scene.selection.characters).toContain("민수");expect(scene.context).toContain("희진");
});

test("missing illustration details require concrete confirmation and use the edited scene",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;saved.story.archive![1].content="희진은 조용히 눈을 떴다.";
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let selection:any;let calls=0;
 await page.route("**/api/characters",async route=>{
  calls++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();selection=JSON.parse(String(form.get("scene"))).selection;
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();await page.getByRole("button",{name:"삽화 생성",exact:true}).click();
 const popup=page.getByRole("dialog"),generate=popup.getByRole("button",{name:"그림 만들기",exact:true});
 await expect(generate).toBeDisabled();await expect(popup.getByText("현재 장면에서 확인",{exact:true})).toHaveCount(0);await expect(popup.getByText("대상 인물의 장면 속 의상",{exact:true})).toHaveCount(0);expect(calls).toBe(0);
 await popup.getByLabel("장면 장소").fill("왕궁 연회장");await expect(generate).toBeDisabled();await popup.getByLabel("장면 의상").fill("붉은 비단 예복");await expect(generate).toBeEnabled();
 await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();await generate.click();
 await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");expect(selection).toMatchObject({location:"왕궁 연회장",outfit:"붉은 비단 예복",target:"희진",confirmed:true});expect(calls).toBe(1);
});

test("new illustrations retain the requested chapter when the reader moves before completion", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved = structuredClone(snapshot); saved.story.started = true; saved.story.storyPage = 0; saved.story.committed = archive;
  let persisted: any; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/account?document=${characterId}*`, route => route.fulfill({ json: { id: characterId, title: "희진", payload: saved, media: { original: "https://example.test/image.jpg", gallery: {} } } }));
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action === "save") persisted = body.payload;
    return route.fulfill({ json: { ok: true } });
  });
  const image = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#bda4dd" } }).jpeg().toBuffer();
  await page.route("**/api/characters", async route => { await gate; await route.fulfill({ contentType: "image/jpeg", headers: { "X-Job-Id": jobId }, body: image }); });
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    await page.getByRole("button", { name: "이 캐릭터로 대화·이야기 시작" }).click();
    await page.getByRole("group", { name: "캐릭터와 함께하기" }).getByRole("button", { name: "이야기 만들기", exact: true }).click();
    await expect(page.locator(".story-page>span")).toHaveText("이야기 #1");
    await page.getByRole("button", { name: "삽화 생성", exact: true }).click();
    await page.getByRole("dialog").getByLabel("장면 장소").fill("왕궁 연회장");
    await page.getByRole("dialog").getByRole("button", { name: "그림 만들기", exact: true }).click();
    await expect(page.getByRole("button", { name: "삽화 생성", exact: true })).toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
    await expect(page.locator(".story-page>span")).toHaveText("이야기 #2"); release();
    await expect.poll(() => persisted?.gallery?.find((image: any) => image.kind === "illustration")?.scene).toEqual({ novelId, chapter: 1 });
    await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).not.toBeVisible();
    const parsed = snapshotSchema.parse(persisted);
    expect(parsed.gallery.find(image => image.kind === "illustration")?.scene).toEqual({ novelId, chapter: 1 });
  } finally { release(); }
});

test("novel detail carries the nearest previous illustration forward and never uses a future scene", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const illustrationJob="55555555-5555-4555-8555-555555555555";
  const thirdJob="66666666-6666-4666-8666-666666666666";
  const requestedJobs:string[]=[];
  await page.route("**/api/account?job=*",route=>{requestedJobs.push(new URL(route.request().url()).searchParams.get("job")!);return route.fulfill({json:{imageUrl:"https://example.test/image.jpg"}});});
  const saved = snapshotSchema.parse({ ...snapshot, gallery: [
    { id: "legacy", title: "기존 삽화", kind: "illustration", jobId },
    { id: "chapter-two", title: "2회차 삽화", kind: "illustration", jobId:illustrationJob, scene: { novelId, chapter: 2 } },
    { id: "chapter-three", title: "3회차 삽화", kind: "illustration", jobId:thirdJob, scene: { novelId, chapter: 3 } },
    { id: "other-novel", title: "다른 소설", kind: "illustration", jobId, scene: { novelId: characterId, chapter: 2 } },
  ] });
  await page.route(`**/api/account?document=${novelId}`, route => route.fulfill({ json: { id: novelId, title: "테스트 소설", payload: saved } }));
  await page.goto(`/ideal/novels/${novelId}`);
  const background = page.locator(".saved-novel-background");
  await expect(background).toBeVisible(); await expect(background).toHaveCSS("opacity", "0.18");
  expect(requestedJobs).toEqual([jobId]);
  await expect(page.locator(".novel-reader")).toContainText("1번째 회차의 원고");
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await expect.poll(()=>requestedJobs).toEqual([jobId,illustrationJob]);
  await expect(background).toBeVisible();await expect(background).toHaveCSS("opacity","0.18");
  await expect(page.locator(".novel-reader")).toContainText("2번째 회차의 원고");
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await expect.poll(()=>requestedJobs).toEqual([jobId,illustrationJob,thirdJob]);
  await expect(background).toBeVisible();const thirdSource=await background.getAttribute("src");
  for(const chapter of [4,5]){
   await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
   await expect(page.locator(".novel-reader")).toContainText(`${chapter}번째 회차의 원고`);
   await expect(background).toHaveAttribute("src",thirdSource!);
  }
  expect(requestedJobs).toEqual([jobId,illustrationJob,thirdJob]);
  await page.getByRole("button", { name: "이전 이야기 보기", exact: true }).click();
  await expect(background).toBeVisible();
});

test("incomplete novels cannot be published", async ({ page }) => {
  await signIn(page); await accountRoutes(page, false);
  await page.goto(`/ideal/novels/${novelId}`);
  await expect(page.getByRole("button", { name: "서점에 판매 등록", exact: true })).toBeDisabled();
  await expect(page.getByText("완결된 소설만 판매할 수 있습니다. 모든 회차를 완성하고 저장해주세요.", { exact: true })).toBeVisible();
});

test("logging out hides private library data and returns to the login screen", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  await page.route("http://127.0.0.1:54321/auth/v1/logout**", route => route.fulfill({ status: 204 }));
  await page.goto("/ideal/mypage");
  await expect(page.getByText("test@example.com", { exact: true })).toBeVisible();
  await page.evaluate(async () => { const cache = await caches.open("maite-private-images-v1"); await cache.put("/logout-cache-check", new Response("private")); });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
  await expect(page.getByText("test@example.com", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => caches.has("maite-private-images-v1"))).toBe(false);
});

test("store groups a complete work, charges per chapter, and opens purchased prose", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const listingId = "55555555-5555-4555-8555-555555555555";
  let purchased = false;
  await page.route("**/api/store**", route => {
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); expect(body.action).toBe("buy"); expect(body.listingId).toBe(listingId); purchased = true; return route.fulfill({ json: { ok: true } }); }
    if (new URL(route.request().url()).searchParams.has("id")) return route.fulfill({ json: { title: "마지막 약속 #1", kind: "chapter", content: { text: "구매한 첫 회차 원고" } } });
    return route.fulfill({ json: { listings: [{ id: listingId, seller_id: characterId, kind: "chapter", title: "마지막 약속 #1", description: "완결 소설", active: true, chapter: 1, novel: { id: novelId, title: "마지막 약속", chapters: 5 } }], owned: purchased ? [listingId] : [] } });
  });
  await page.goto("/ideal");
  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서점", exact: true }).click();
  await page.getByRole("tab", { name: "소설", exact: true }).click();
  await page.getByText("마지막 약속 · 5편", { exact: true }).click();
  await page.getByRole("button", { name: "총 12하트로 구매", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "구매하기", exact: true }).click();
  await page.getByRole("button", { name: "회차 읽기", exact: true }).click();
  await expect(page.getByText("구매한 첫 회차 원고", { exact: true })).toBeVisible();
});

test("first login collects a profile and restores it on the next launch", async ({ page }) => {
  await signIn(page);
  let profile: { display_name: string; gender?: string; age?: number; onboarded: boolean } = { display_name: "", onboarded: false };
  await page.route("**/api/account**", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "profile") { expect(body).toEqual({ action: "profile", nickname: "별빛", gender: "여성", age: 27 }); profile = { display_name: body.nickname, gender: body.gender, age: body.age, onboarded: true }; }
      return route.fulfill({ json: { ok: true } });
    }
    if (new URL(route.request().url()).searchParams.has("previews")) return route.fulfill({ json: { images: {} } });
    return route.fulfill({ json: { userId, email: "test@example.com", profile, wallet: { transferable: 0, bonus: 5, free_chats: 5 }, documents: [], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.goto("/ideal");
  await expect(page.getByRole("heading", { name: "당신을 알려주세요" })).toBeVisible();
  await page.getByLabel("사용자 닉네임").fill("별빛"); await page.getByLabel("사용자 성별").selectOption("여성"); await page.getByLabel("사용자 나이").fill("27");
  await page.screenshot({ path: ".verification/native-onboarding.png", caret: "initial" });
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  await expect(page.locator(".native-user")).toContainText("별빛");
  await page.reload(); await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  await expect(page.getByLabel("사용자 닉네임")).toHaveCount(0);
});

test("character generation confirmation does not call the API until accepted", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const jpeg = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#cbb9ef" } }).jpeg().toBuffer();
  let requests = 0;
  await page.route("**/api/characters", route => { requests++; return route.fulfill({ contentType: "image/jpeg", headers: { "X-Character-Title": encodeURIComponent("서하") }, body: jpeg }); });
  await page.goto("/ideal/new"); await fillCharacterProfile(page);
  await page.screenshot({ path: ".verification/native-newface-account.png", caret: "initial" });
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "새로운 캐릭터를 만날까요?" });
  await expect(confirmation).toContainText("50하트"); await expect(confirmation).toContainText("955하트");
  await page.screenshot({ path: ".verification/native-confirm-character.png", caret: "initial" });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click(); expect(requests).toBe(0);
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await confirmation.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
});

test("profile photo previews, saves, survives reload and can be removed", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let avatarUrl: string | null = null; let uploads = 0; let avatarReads = 0;
  const photo = await sharp({ create: { width: 60, height: 80, channels: 3, background: "#ad9bea" } }).png().toBuffer();
  await page.route("https://example.test/avatar.jpg", route => { avatarReads++; return route.fulfill({ contentType: "image/png", body: photo }); });
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { userId, email: "test@example.com", profile: { display_name: "별빛", gender: "여성", age: 27, onboarded: true }, avatarUrl, wallet: { transferable: 1000, bonus: 5, free_chats: 5 }, documents: [], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.route("**/api/account/profile", async route => {
    expect(route.request().headers().authorization).toBe("Bearer test-access-token");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    const body = route.request().postDataBuffer()!.toString();
    expect(body).toContain('name="profile"');
    if (body.includes('name="photo"')) { uploads++; avatarUrl = "https://example.test/avatar.jpg"; }
    else { expect(body).toContain('name="removePhoto"'); avatarUrl = null; }
    return route.fulfill({ json: { ok: true, avatarUrl } });
  });
  await page.goto("/ideal/mypage");
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로필 수정" });
  const chooserEvent = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "프로필 사진 변경" }).click();
  const chooser = await chooserEvent;
  await chooser.setFiles({ name: "avatar.png", mimeType: "image/png", buffer: photo });
  await expect(editor.getByAltText("프로필 사진 미리보기")).toBeVisible();
  await editor.getByRole("button", { name: "프로필 저장" }).click();
  await expect(editor).toHaveCount(0); await expect(page.locator(".native-profile-card img")).toBeVisible();
  expect(uploads).toBe(1);
  await expect.poll(() => page.evaluate(async () => { const cache = await caches.open("maite-private-images-v1"); return (await cache.keys()).length; })).toBeGreaterThan(0);
  const readsBeforeReload = avatarReads;
  await page.reload(); await expect(page.locator(".native-profile-card img")).toBeVisible();
  expect(avatarReads).toBe(readsBeforeReload);
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  await editor.getByRole("button", { name: "사진 삭제" }).click();
  await editor.getByRole("button", { name: "프로필 저장" }).click();
  await expect(editor).toHaveCount(0); await expect(page.locator(".native-profile-card img")).toHaveCount(0);
});

test("notification switches persist account-wide push and quiet-hour preferences", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let settings={pushEnabled:false,quietHours:true,available:true};const saved:unknown[]=[];
  await page.route("**/api/notifications", route=>{
    if(route.request().method()==="POST"){const body=route.request().postDataJSON();saved.push(body);settings={...settings,pushEnabled:body.pushEnabled,quietHours:body.quietHours};return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:settings});
  });
  await page.goto("/ideal/mypage");
  const push=page.getByRole("switch",{name:"앱 알림",exact:true}),quiet=page.getByRole("switch",{name:"야간 알림 제한",exact:true});
  await expect(push).toHaveAttribute("aria-checked","false");await expect(quiet).toHaveAttribute("aria-checked","true");
  await push.click();await expect(push).toHaveAttribute("aria-checked","true");
  await quiet.click();await expect(quiet).toHaveAttribute("aria-checked","false");
  await page.reload();await expect(push).toHaveAttribute("aria-checked","true");await expect(quiet).toHaveAttribute("aria-checked","false");
  expect(saved).toEqual([{action:"settings",pushEnabled:true,quietHours:true},{action:"settings",pushEnabled:true,quietHours:false}]);
});

test("stored check-ins appear in their character chat once without generating an AI reply",async({page})=>{
 await signIn(page);await accountRoutes(page);
 let aiCalls=0;let requestBody:any;await page.route("**/api/chat",route=>{aiCalls++;requestBody=route.request().postDataJSON();return route.fulfill({contentType:"text/event-stream",body:'data: {"type":"delta","text":"반가워!"}\n\ndata: {"type":"done"}\n\n'});});
 await page.route(`**/api/notifications?document=${characterId}`,route=>route.fulfill({json:{messages:[{id:novelId,body:"나 안 보고 싶어?",user_turns:0,created_at:new Date().toISOString()}]}}));
 await page.goto(`/ideal/characters/${characterId}`);
 await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
 const greeting=page.getByRole("log").getByText("나 안 보고 싶어?",{exact:true});await expect(greeting).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event("maite-checkins-refresh")));await expect(greeting).toHaveCount(1);expect(aiCalls).toBe(0);
 await page.getByLabel("AI에게 보낼 메시지").fill("나도 보고 싶어");await page.getByRole("button",{name:"AI 메시지 보내기"}).click();
 await expect(page.getByRole("log").getByText("반가워!",{exact:true})).toBeVisible();expect(aiCalls).toBe(1);
 expect(requestBody.messages).toEqual([{role:"assistant",content:"나 안 보고 싶어?"},{role:"user",content:"나도 보고 싶어"}]);
});

test("an open local web chat receives its three-minute greeting once without an AI call",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const now=new Date("2026-11-18T12:00:00+09:00");await page.clock.install({time:now});
 const saved=structuredClone(snapshot);saved.chat.committed=[{role:"user",content:"이따 봐"},{role:"assistant",content:"응, 이따 봐!"}];saved.chat.archive=saved.chat.committed;
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 const receipts:any[]=[];let aiCalls=0,messageReads=0;
 await page.route("**/api/chat",route=>{aiCalls++;return route.abort();});
 await page.route("**/api/notifications**",route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==="POST"){receipts.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}
  if(url.searchParams.has("document")){messageReads++;return route.fulfill({json:{messages:receipts.map(row=>({id:row.id,body:row.body,user_turns:row.userTurns,created_at:row.dueAt}))}});}
  const last=receipts.at(-1);
  return route.fulfill({json:{pushEnabled:true,quietHours:false,available:true,nickname:"햄군",activities:[{documentId:characterId,userTurns:1,lastUserAt:now.toISOString(),characterName:"희진"}],lastDelivered:last??null}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||"{}").pending?.dueAt,`maite-local-checkins:${userId}`)).toBe(new Date(now.getTime()+180000).toISOString());
 await page.clock.fastForward(179000);expect(receipts).toHaveLength(0);
 // A recent empty poll must not hide a newly delivered greeting behind the document read cache.
 await expect.poll(()=>messageReads).toBeGreaterThan(1);
 await page.clock.fastForward(2000);await expect(page.getByRole("log").getByText("나 안 보고 싶어?",{exact:true})).toBeVisible();
 expect(receipts).toHaveLength(1);expect(aiCalls).toBe(0);
 await page.clock.fastForward(240000);expect(receipts).toHaveLength(1);
 await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"마이페이지",exact:true}).click();
 await expect(page.locator(".checkin-reservation-status")).toContainText("지난 안부에 답장");
 await expect(page.locator(".notification-settings")).toContainText("웹에서는 화면을 열어 둔 동안");
});

test("five tabs separate the heart store from the bookshop and preserve profile editing", async ({ page }) => {
  await signIn(page); await accountRoutes(page); await page.goto("/ideal/characters");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "서고", "서점", "스토어", "마이페이지"]);
  await page.screenshot({ path: ".verification/native-characters.png", caret: "initial" });
  await footer.getByRole("link", { name: "스토어", exact: true }).click();
  await expect(page.getByRole("heading", { name: "하트 스토어" })).toBeVisible();
  await expect(page.locator(".heart-product")).toHaveCount(4);
  await expect(page.locator(".heart-product h3")).toHaveText(["하트 150개","하트 400개","하트 1,000개","하트 패스 · 총 800개"]);
  await expect(page.locator(".heart-product button")).toHaveText(["2,000원","5,000원","10,000원","5,000원"]);
  await expect(page.locator(".heart-store-page")).toContainText("즉시 200개 + 30일간 매일 20개");
  await expect(page.locator(".heart-product button").first()).toBeDisabled();
  await page.screenshot({ path: ".verification/native-hearts.png", caret: "initial" });
  await footer.getByRole("link", { name: "서점", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "서점 분류" })).toBeVisible();
  await footer.getByRole("link", { name: "마이페이지", exact: true }).click();
  await expect(page.getByRole("heading", { name: "캐릭터 목록", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로필 수정" }); await expect(editor).toBeVisible();
  await page.keyboard.press("Escape"); await expect(editor).toHaveCount(0);
  await expect(page.locator(".heart-total")).toContainText("1,005");
});

test("restored duplicate image IDs stay selectable, naming uses the profile, and unchanged navigation avoids saves", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved = structuredClone(snapshot);
  saved.story.started = true;
  saved.gallery = [
    { id: "original", title: "희진", kind: "character", jobId },
    { id: "illustration-4", title: "첫 삽화", kind: "illustration", jobId },
    { id: "illustration-4", title: "다른 삽화", kind: "illustration", jobId: "66666666-6666-4666-8666-666666666666" },
  ];
  saved.backgrounds = { chat: "illustration-4", story: "original" };
  await page.route(`**/api/account?document=${characterId}*`, route => route.fulfill({ json: { id: characterId, title: "희진", payload: saved, media: { original: "https://example.test/image.jpg", gallery: { [jobId]: "https://example.test/image.jpg", "66666666-6666-4666-8666-666666666666": "https://example.test/image.jpg" } } } }));
  const errors: string[] = []; let saves = 0; let queries = 0;
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    const url = new URL(request.url()); if (url.pathname !== "/api/account") return;
    if (request.method() === "POST" && request.postDataJSON().action === "save") saves++;
    if (request.method() === "GET" && !url.search) queries++;
  });
  await page.goto(`/ideal/characters/${characterId}`);
  await page.getByRole("button", { name: "이 캐릭터로 대화·이야기 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
  await expect.poll(() => saves).toBeGreaterThan(0);
  await page.getByRole("group", { name: "캐릭터와 함께하기" }).getByRole("button", { name: "대화하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "캐릭터 설정", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "배경 변경", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "배경 변경", exact: true });
  await expect(picker.locator(".background-picker-grid > button")).toHaveCount(4);
  await picker.getByRole("button", { name: "배경 선택: 다른 삽화", exact: true }).click();
  await page.getByRole("button", { name: "배경 변경", exact: true }).click();
  await expect(picker.getByRole("button", { name: "배경 선택: 다른 삽화", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  let named = false;
  await page.route("**/api/chat", route => {
    expect(route.request().postDataJSON().character.userName).toBe("테스트"); named = true;
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"테스트, 반가워."}\n\ndata: {"type":"done"}\n\n' });
  });
  await page.getByLabel("AI에게 보낼 메시지").fill("안녕");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(page.getByText("테스트, 반가워.", { exact: true })).toBeVisible();
  expect(named).toBe(true);
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await footer.getByRole("link", { name: "마이페이지", exact: true }).click();
  await page.waitForTimeout(700); // Let completion refresh and the coalesced save settle.
  const previous = { saves, queries };
  await footer.getByRole("link", { name: "캐릭터", exact: true }).click();
  await footer.getByRole("link", { name: "마이페이지", exact: true }).click();
  await page.waitForTimeout(700);
  expect({ saves, queries }).toEqual(previous);
  expect(errors.filter(message => /same key/.test(message))).toEqual([]);
  await expect(page.locator(".native-profile-card .native-outline svg")).toBeVisible();
  await expect(page.locator(".chat-header .account-trigger")).toHaveAttribute("href", "/ideal/store");
});

test("image slots hide browser broken-image indicators until the image decodes", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const image = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#bba4df" } }).jpeg().toBuffer();
  await page.route("https://example.test/image.jpg", async route => { await gate; await route.fulfill({ contentType: "image/jpeg", body: image }); });
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    const preview = page.locator(".character-detail img");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("src", /^data:image\/gif/);
    await expect(preview).toHaveCSS("visibility", "hidden");
    const before = await preview.boundingBox();
    release();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("aria-busy", "false");
    await expect(preview).toHaveJSProperty("naturalWidth", 72);
    expect((await preview.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  } finally { release(); }
});

test("one bundled read opens a character before slow gallery downloads and preserves every saved image", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved=structuredClone(snapshot);
  const otherJob="66666666-6666-4666-8666-666666666666";
  const firstSceneJob="77777777-7777-4777-8777-777777777777";
  saved.gallery=[{id:"original",title:"희진",kind:"character",jobId},{id:"scene-a",title:"서점",kind:"illustration",jobId:firstSceneJob},{id:"scene-b",title:"카페",kind:"illustration",jobId:otherJob}];
  saved.backgrounds={chat:"scene-a",story:"original"};
  let documentReads=0,jobReads=0,originalReads=0,secondSceneReads=0;const persisted:unknown[]=[];
  page.on("request",request=>{
    const url=new URL(request.url());if(url.hostname==="example.test"&&url.pathname==="/image.jpg")originalReads++;
    if(url.hostname==="example.test"&&url.pathname==="/slow-b.jpg")secondSceneReads++;
    if(url.pathname!=="/api/account")return;
    if(url.searchParams.has("job"))jobReads++;
    if(request.method()==="POST" && request.postDataJSON().action==="save")persisted.push(request.postDataJSON());
  });
  await page.route(`**/api/account?document=${characterId}*`,route=>{
    documentReads++;expect(new URL(route.request().url()).searchParams.get("media")).toBe("1");
    return route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{[firstSceneJob]:"https://example.test/slow-a.jpg",[otherJob]:"https://example.test/slow-b.jpg"},thumbnails:{[firstSceneJob]:"https://example.test/thumb-a.webp",[otherJob]:"https://example.test/thumb-b.webp"}}}});
  });
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const image=await sharp({create:{width:72,height:128,channels:3,background:"#bca4d8"}}).jpeg().toBuffer();
  const thumb=await sharp(image).resize({width:32}).webp().toBuffer();
  await page.route("https://example.test/thumb-*.webp",route=>route.fulfill({contentType:"image/webp",body:thumb}));
  await page.route("https://example.test/slow-*.jpg",async route=>{await gate;await route.fulfill({contentType:"image/jpeg",body:image}).catch(()=>{});});
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    await expect(page.locator(".character-detail img")).toBeVisible();
    await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작",exact:true}).click();
    await expect(page.getByRole("button",{name:"캐릭터 이미지 전체화면 보기",exact:true})).toBeVisible();
    expect(documentReads).toBe(1);expect(jobReads).toBe(0);expect(originalReads).toBe(1);
    await expect.poll(()=>persisted.filter((item:any)=>item.kind==="studio" && item.payload.gallery.length===3).length).toBeGreaterThan(0);
    await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
    await expect(page.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
    await page.getByRole("link",{name:"장면 갤러리",exact:true}).click();
    await expect(page.locator(".generated-gallery-grid article")).toHaveCount(3);
    await expect.poll(()=>page.locator('.generated-gallery-grid img').nth(2).evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBe(32);
    expect(secondSceneReads).toBe(0);
    await page.getByRole("button",{name:"이미지 보기: 카페",exact:true}).click();
    await expect.poll(()=>secondSceneReads).toBe(1);
    release();
    await expect(page.locator('.generated-gallery-grid img[src^="blob:"]')).toHaveCount(3);
  } finally {release();}
});
