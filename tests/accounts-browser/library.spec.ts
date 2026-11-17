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
    if (url.searchParams.has("document")) return route.fulfill({ json: { id: url.searchParams.get("document"), title: "희진의 이야기", payload: saved } });
    if (url.searchParams.has("job")) return route.fulfill({ json: { imageUrl: "https://example.test/image.jpg" } });
    return route.fulfill({ json: { userId, email: "test@example.com", profile: { display_name: "테스트" }, wallet: { transferable: 1000, bonus: 5, free_chats: 5 }, documents: deleted.length ? [] : [
      { id: characterId, title: "희진", kind: "studio", character_name: "희진", chapter: String(saved.story.storyState!.chapter), novel_id: novelId },
      { id: novelId, title: "희진의 이야기", kind: "chapter", chapter: String(saved.story.storyState!.chapter), next_goal: complete ? "" : "다음 사건" },
    ], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.route("https://example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128"/>' }));
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
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "뉴페이스", "서점", "스토어", "마이페이지"]);
  await footer.getByRole("link", { name: "마이페이지", exact: true }).click();
  await expect(page.getByText("test@example.com", { exact: true })).toBeVisible();
  await expect(page.locator(".heart-total")).toContainText("1,005");
  await page.screenshot({ path: ".verification/account-mypage.png", fullPage: true });
  await footer.getByRole("link", { name: "캐릭터", exact: true }).click();
  await page.locator(".native-character-card").filter({ hasText: "희진" }).click();
  await expect(page.getByRole("heading", { name: "캐릭터 상세", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "소설 상세", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await page.locator(".novel-reader").dispatchEvent("touchstart", { touches: [{ identifier: 0, clientX: 220, clientY: 300 }] });
  await page.locator(".novel-reader").dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 0, clientX: 100, clientY: 310 }] });
  await expect(page.locator(".novel-reader")).toContainText("3번째 회차의 원고입니다.");
  await expect(page.locator(".novel-reader")).not.toContainText("비공개 지시");
  await page.getByLabel("소설 제목", { exact: true }).fill("서점에서의 마지막 약속");
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "판매 등록", exact: true }).click();
  await expect(page.getByText("서점에 판매 등록했습니다.", { exact: true })).toBeVisible();
  expect(published).toEqual({ action: "publishNovel", documentId: novelId, title: "서점에서의 마지막 약속", description: "서점에서 시작된 이야기" });
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeInViewport();
  await page.screenshot({ path: ".verification/account-novel-detail.png", fullPage: true });
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
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
  await expect(page.getByText("test@example.com", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: "이미지 다운로드", exact: true })).toBeVisible();
});

test("five tabs separate the heart store from the bookshop and preserve profile editing", async ({ page }) => {
  await signIn(page); await accountRoutes(page); await page.goto("/ideal/characters");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "뉴페이스", "서점", "스토어", "마이페이지"]);
  await page.screenshot({ path: ".verification/native-characters.png", caret: "initial" });
  await footer.getByRole("link", { name: "스토어", exact: true }).click();
  await expect(page.getByRole("heading", { name: "하트 스토어" })).toBeVisible();
  await expect(page.locator(".heart-product")).toHaveCount(4);
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
  await page.route(`**/api/account?document=${characterId}`, route => route.fulfill({ json: { id: characterId, title: "희진", payload: saved } }));
  const errors: string[] = []; let saves = 0; let queries = 0;
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    const url = new URL(request.url()); if (url.pathname !== "/api/account") return;
    if (request.method() === "POST" && request.postDataJSON().action === "save") saves++;
    if (request.method() === "GET" && !url.search) queries++;
  });
  await page.goto(`/ideal/characters/${characterId}`);
  await page.getByRole("button", { name: "이 캐릭터로 대화·이야기 시작", exact: true }).click();
  await expect(page.getByRole("link", { name: "이미지 다운로드", exact: true })).toBeVisible();
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
