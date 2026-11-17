import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "../browser/character-helpers";
test("bundled mobile UI generates, routes, streams and keeps the gallery without Next runtime", async ({ page }) => {
  await page.goto("/ideal");
  await expect(page.locator(".chat-header").getByRole("link", { name: "하트 스토어", exact: true })).toHaveAttribute("href", "/ideal/store");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await generateCharacter(page);
  let calls = 0;
  await page.route("**/api/chat", async route => {
    calls++;
    expect(route.request().headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"여기서 함께 이야기해요."}\n\ndata: {"type":"done"}\n\n' });
  });
  await enterCharacterMode(page);
  await page.getByRole("textbox", { name: "AI에게 보낼 메시지" }).fill("안녕");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(page.getByText("여기서 함께 이야기해요.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "장면 갤러리", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/gallery\?from=chat$/);
  await expect(page.getByRole("main", { name: "생성 이미지 갤러리" }).getByRole("article")).toHaveCount(1);
  await page.goBack(); await expect(page).toHaveURL(/\/ideal\/chat$/);
  await expect(page.getByText("여기서 함께 이야기해요.", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
