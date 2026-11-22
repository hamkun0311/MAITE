import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";

test("story paper is transparent and an image job keeps text, scrolling and chapter navigation accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/ideal"); await generateCharacter(page);
  let chapter = 0;
  await page.route("**/api/chat", route => { chapter++; return route.fulfill({ contentType: "text/event-stream", body: storyWire(route.request().postDataJSON(), `장면${chapter}. `+"비가 갠 서점에서 둘은 책장을 천천히 정리하며 지난 이야기를 이어갔다. ".repeat(60)) }); });
  await enterCharacterMode(page, "이야기 만들기");
  const next = page.getByRole("button", { name: "다음 이야기", exact: true }); await expect(next).toBeEnabled(); await next.click();
  await expect(page.locator(".story-page > span")).toHaveText("이야기 #2");
  for (const selector of [".story-page", ".story-page p", ".live-chat-log"]) expect(await page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/characters", async route => { await gate; await route.abort().catch(() => {}); });
  const image = page.getByRole("button", { name: "삽화 생성", exact: true }); await image.click();
  await expect(image).toHaveAttribute("aria-busy", "true"); await expect(image.locator(".spin")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const log = page.getByRole("log"); await log.evaluate(element => { element.scrollTop = 140; }); expect(await log.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.getByRole("button", { name: "이전 이야기 보기", exact: true }).click(); await expect(page.locator(".story-page > span")).toHaveText("이야기 #1");
  await expect(log).toContainText("장면1."); await page.screenshot({ path: ".verification/reading-during-illustration.png", caret: "initial" });
  await page.getByRole("button", { name: "이미지 생성 취소", exact: true }).click(); release();
  await expect(image).toBeEnabled(); await expect(page.locator(".story-page > span")).toHaveText("이야기 #1");
});

test("dialogue uses transparent containers and separate left/right chat bubbles in the app palette", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/ideal"); await generateCharacter(page);
  await page.route("**/api/chat", route => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"같이 서점에서 책을 골라볼까?"}\n\ndata: {"type":"done"}\n\n' }));
  await enterCharacterMode(page); await page.getByLabel("AI에게 보낼 메시지").fill("오늘 어디서 만날까?"); await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(page.locator(".assistant p")).toHaveText("같이 서점에서 책을 골라볼까?");
  expect(await page.locator(".assistant").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await page.locator(".assistant p").evaluate(element => getComputedStyle(element).backgroundColor)).toMatch(/^rgba\(/);
  expect(await page.locator(".user p").evaluate(element => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
  await expect(page.locator(".reader-character-avatar")).toBeVisible();
  await page.screenshot({ path: ".verification/native-chat-transparent.png", caret: "initial" });
  const log = page.getByRole("log");
  const input = page.getByLabel("AI에게 보낼 메시지");
  const originalReader = (await log.boundingBox())!;
  const originalInput = (await input.boundingBox())!;
  await input.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, value: innerHeight - 260 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".is-character-reading")).toHaveAttribute("data-keyboard-open", "true");
  expect((await log.boundingBox())!.height).toBe(originalReader.height);
  expect((await input.boundingBox())!.y).toBeCloseTo(originalInput.y - 260, 0);
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(viewport, "height");
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".is-character-reading")).toHaveAttribute("data-keyboard-open", "false");
});
