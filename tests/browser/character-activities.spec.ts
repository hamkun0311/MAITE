import { openExistingCharacter } from "./character-helpers";
import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire, chapterEvent } from "./character-helpers";
import type { StoryState } from "../../lib/novel/state";

test("mobile profile precedes image generation and is shared by chat and story", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal");
  await expect(page.locator(".chat-examples")).toHaveCount(0);
  await expect(page.getByLabel("캐릭터 이름")).toBeInViewport();
  await expect(page.getByLabel("만들고 싶은 캐릭터")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "장르", exact: true })).toHaveCount(0);
  const gender = page.getByRole("combobox", { name: "성별", exact: true });
  await expect(gender.locator("option:not([disabled])")).toHaveText(["남성", "여성"]);
  await expect(page.getByLabel("외모", { exact: true })).toHaveAttribute("maxlength", "1000");
  expect(await gender.evaluate(element => element.closest("label")!.nextElementSibling?.querySelector("textarea")?.name)).toBe("appearance");
  expect(await gender.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('textarea[aria-label="성격"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByRole("navigation", { name: "캐릭터 활동" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toHaveCount(0);
  await generateCharacter(page);
  const image = page.getByAltText("은발 탐정 — 생성된 2D 캐릭터 일러스트");
  await expect(image).toBeInViewport();
  const imageUrl = await image.getAttribute("src");
  await page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true });
  await expect(viewer).toBeVisible();
  expect(await viewer.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(844);
  await viewer.getByRole("button", { name: "전체화면 닫기", exact: true }).click();
  await expect(viewer).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  const actions = page.getByRole("group", { name: "캐릭터와 함께하기" });
  await expect(actions.getByRole("button")).toHaveCount(2);
  for (const button of await actions.getByRole("button").all()) {
    expect(await button.textContent()).toBe("");
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await actions.evaluate(element => {
    const image = element.previousElementSibling!.querySelector("img")!;
    return element.getBoundingClientRect().top >= image.getBoundingClientRect().bottom - 1;
  })).toBe(true);
  await actions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".verification/character-actions-mobile.png", fullPage: true });
  const bodies: { storyState?: StoryState; messages: { content: string }[]; character: { name: string; mode: string; age: number; personality: string; concept: string; imageDescription: string } }[] = [];
  await page.route("**/api/chat", route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 4) return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(chapterEvent(bodies.at(-1)!, "완료되지 않은 새 회차"))}\n\ndata: {"type":"error","message":"잠시 후 다시 이어주세요."}\n\n` });
    if (bodies.at(-1)!.character.mode === "story") return route.fulfill({ contentType: "text/event-stream", body: storyWire(bodies.at(-1)!, "우리가 다시 만나다니. 비밀은 아직 끝나지 않았어.") });
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"우리가 다시 만나다니. 비밀은 아직 끝나지 않았어."}\n\ndata: {"type":"done"}\n\n' });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  await expect(chat.locator(".character-reader-title p")).toHaveText("서하 · 25세");
  await expect(page.getByLabel("캐릭터 이름")).toHaveCount(0);
  await expect(chat.locator(".character-backdrop")).toHaveAttribute("src", imageUrl!);
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeInViewport();
  await chat.getByLabel("AI에게 보낼 메시지").fill("오랜만이야");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByText("우리가 다시 만나다니. 비밀은 아직 끝나지 않았어.")).toBeVisible();
  expect(bodies[0].character).toMatchObject({ mode: "chat", name: "서하", age: 25, personality: "도도하지만 다정한 성격", concept: "25살 은발 탐정, 비 오는 도시, 검은 코트", genre: "막장드라마" });
  expect(bodies[0].character.imageDescription).toContain("25살 은발 탐정");
  expect(bodies[0].character).toMatchObject({ gender: "여성" });
  expect(bodies[0].character).toMatchObject({ appearance: "긴 은발, 보라색 눈동자, 갸름한 얼굴" });
  expect(bodies[0].character.imageDescription).toContain("Silver-haired detective");
  await chat.getByLabel("AI에게 보낼 메시지").fill("아직 보내지 않은 말");
  await page.goBack();
  await expect(page).toHaveURL(/\/ideal$/);
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true }).click();
  await expect(viewer).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/ideal\/chat$/);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect(chat.getByText("오랜만이야", { exact: true })).toBeVisible();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toHaveValue("아직 보내지 않은 말");
  await chat.getByLabel("AI에게 보낼 메시지").fill("");
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  await expect(story.locator(".character-reader-title p")).toHaveText("서하 · 25세");
  await expect(story.locator(".character-backdrop")).toHaveAttribute("src", imageUrl!);
  await expect(story.getByText("우리가 다시 만나다니. 비밀은 아직 끝나지 않았어.")).toBeVisible();
  expect(bodies[1].character).toMatchObject({ mode: "story", name: "서하", age: 25, genre: "막장드라마" });
  expect(bodies[1].messages).toEqual([{ role: "user", content: "설정에 맞춰 첫 장면부터 이야기를 시작해줘." }]);
  expect(bodies[1].character).toMatchObject({ gender: "여성" });
  expect(bodies[1].character).toMatchObject({ appearance: "긴 은발, 보라색 눈동자, 갸름한 얼굴" });
  await expect(story.getByLabel("AI에게 보낼 메시지")).toHaveCount(0);
  await expect(story.getByRole("log").locator(".user")).toHaveCount(0);
  await story.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(story.locator(".story-page > span")).toHaveText("이야기 #2");
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeEnabled();
  expect(bodies[2].messages).toHaveLength(3);
  expect(bodies[2].storyState?.chapter).toBe(1);
  expect(bodies[2].storyState?.resolvedEvents).toContain("서점에서의 재회");
  expect(bodies[2].messages[1]).toEqual({ role: "assistant", content: "우리가 다시 만나다니. 비밀은 아직 끝나지 않았어." });
  expect(bodies[2].messages[2].content).toContain("다음 장면");
  expect(bodies[2].character).toEqual(bodies[1].character);
  await story.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(story.getByText("잠시 후 다시 이어주세요.")).toBeVisible();
  await expect(story.getByText("완료되지 않은 새 회차")).toHaveCount(0);
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeEnabled();
  await story.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeEnabled();
  expect(bodies[4].messages).toEqual(bodies[3].messages);
  expect(bodies[4].storyState).toEqual(bodies[3].storyState);
  await expect(story.locator(".story-page > span")).toHaveText("이야기 #3");
  await enterCharacterMode(page);
  await expect(chat.getByText("오랜만이야", { exact: true })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(story.locator(".story-page > span")).toHaveText("이야기 #3");
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeEnabled();
  expect(bodies).toHaveLength(5);
  await expect(story.getByRole("button", { name: "AI 대화 초기화", exact: true })).toHaveCount(0);
  await expect(story.getByRole("button", { name: "캐릭터 설정", exact: true })).toHaveCount(0);
  await openExistingCharacter(page);
  await expect(page.getByLabel("캐릭터 이름")).toHaveValue("서하");
  await expect(gender).toHaveValue("여성");
  await expect(page.getByLabel("외모", { exact: true })).toHaveValue("긴 은발, 보라색 눈동자, 갸름한 얼굴");
  await enterCharacterMode(page);
  await expect(chat.getByText("오랜만이야", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".verification/character-chat-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openExistingCharacter(page);
  await page.getByRole("button", { name: "새 캐릭터 대화" }).click();
  await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toHaveCount(0);
  await expect(page.locator(".character-backdrop")).toHaveCount(0);
  await expect(page.getByLabel("캐릭터 이름")).toHaveValue("");
  await expect(gender).toHaveValue("");
  await expect(page.getByLabel("외모", { exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "장르", exact: true })).toHaveCount(0);
});

test("direct activity URLs guide a new session to character creation without calling AI", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/chat", route => { requests++; return route.abort(); });
  for (const path of ["/ideal/chat", "/ideal/story"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "캐릭터를 먼저 만들어주세요." })).toBeVisible();
    await expect(page.getByLabel("AI에게 보낼 메시지")).toHaveCount(0);
    await page.getByRole("link", { name: "캐릭터 생성으로 이동", exact: true }).click();
    await expect(page).toHaveURL(/\/ideal$/);
    await expect(page.getByLabel("캐릭터 이름")).toBeVisible();
  }
  expect(requests).toBe(0);
});

test("leaving a chat page keeps streaming alive and commits the completed response", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  await enterCharacterMode(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    const scope = window as typeof window & { routeChatAborted?: boolean; routeChatBodies?: unknown[]; finishChat?: () => void };
    scope.routeChatBodies = [];
    window.fetch = async (input, init) => {
      if (input !== "/api/chat") return original(input, init);
      scope.routeChatBodies!.push(JSON.parse(String(init?.body)));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"delta","text":"아직 끝나지 않은 응답"}\n\n'));
        if (scope.routeChatBodies!.length > 1) {
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n')); controller.close();
        } else {
          scope.finishChat = () => { controller.enqueue(encoder.encode('data: {"type":"done"}\n\n')); controller.close(); };
          init?.signal?.addEventListener("abort", () => { scope.routeChatAborted = true; controller.error(new DOMException("Aborted", "AbortError")); }, { once: true });
        }
      } }), { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  await chat.getByLabel("AI에게 보낼 메시지").fill("첫 요청");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByText("아직 끝나지 않은 응답", { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "캐릭터 이미지로 돌아가기" }).click();
  await expect(page).toHaveURL(/\/ideal$/);
  expect(await page.evaluate(() => (window as typeof window & { routeChatAborted?: boolean }).routeChatAborted)).not.toBe(true);
  await page.evaluate(() => (window as typeof window & { finishChat: () => void }).finishChat());
  await enterCharacterMode(page);
  await expect(chat.getByText("아직 끝나지 않은 응답", { exact: true })).toBeVisible();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
  await chat.getByLabel("AI에게 보낼 메시지").fill("다음 요청");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
  const bodies = await page.evaluate(() => (window as typeof window & { routeChatBodies: { messages: unknown[] }[] }).routeChatBodies);
  expect(bodies[1].messages).toEqual([{ role: "user", content: "첫 요청" }, { role: "assistant", content: "아직 끝나지 않은 응답" }, { role: "user", content: "다음 요청" }]);
});

test("story reader uses most of the screen and commits a chapter only after completion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal");
  await generateCharacter(page);
  const chapter = chapterEvent({}, "첫 장면. 비가 그친 도시에서 서하가 고개를 들었다.\n\n" + "골목을 걷던 두 사람은 오래된 서점 앞에서 잠시 발걸음을 멈췄다. 서로 나누지 못했던 이야기가 조용히 이어졌다.\n\n".repeat(35));
  await page.evaluate(chapter => {
    const original = window.fetch.bind(window);
    const scope = window as typeof window & { finishStory?: () => void };
    window.fetch = async (input, init) => {
      if (input !== "/api/chat") return original(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: "phase", phase: "reviewing" });
        send(chapter);
        scope.finishStory = () => { send({ type: "done" }); controller.close(); };
      } }), { headers: { "Content-Type": "text/event-stream" } });
    };
  }, chapter);
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const log = story.getByRole("log");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(story.locator(".story-generation-status")).toContainText("이야기 흐름 확인 중…");
  await expect(story.locator(".story-next-button .spin")).toBeVisible();
  await expect(page.locator(".story-page p")).not.toContainText("첫 장면.");
  await expect(story.getByLabel("AI에게 보낼 메시지")).toHaveCount(0);
  await expect(page.locator(".story-next-button")).toBeDisabled();
  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서점", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/bookshop$/);
  await page.evaluate(() => (window as typeof window & { finishStory?: () => void }).finishStory!());
  await page.goBack(); await expect(page).toHaveURL(/\/ideal\/story$/);
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeEnabled();
  await expect(log.locator(".assistant p")).toContainText("첫 장면.");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect.poll(async () => (await log.boundingBox())!.height / (844 - (await footer.boundingBox())!.height)).toBeGreaterThan(0.55);
  expect(await log.locator(".assistant p").evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(17);
  const initial = await log.evaluate(element => ({ top: element.scrollTop, bottom: element.scrollHeight - element.clientHeight }));
  expect(initial.top).toBeLessThan(initial.bottom - 100);
  await log.evaluate(element => { element.scrollTop = 120; });
  expect(await log.evaluate(element => element.scrollTop)).toBeCloseTo(120, 0);
  await page.screenshot({ path: ".verification/story-reader-mobile.png" });
  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await log.boundingBox())!.height / (viewport.height - (await footer.boundingBox())!.height)).toBeGreaterThan(0.45);
    await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 440 });
  await expect(story.getByRole("button", { name: "다음 이야기", exact: true })).toBeInViewport();
  await expect.poll(async () => (await log.boundingBox())!.height).toBeGreaterThan(100);
});
