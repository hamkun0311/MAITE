import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "../browser/character-helpers";
test("bundled mobile UI generates, routes, streams and keeps the gallery without Next runtime", async ({ page }) => {
  await page.goto("/ideal");
  await page.getByRole("button", { name: "계정 및 하트", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "계정 및 하트", exact: true });
  await expect(dialog.getByText(/Supabase 연결 후/)).toBeVisible();
  await dialog.getByRole("button", { name: "계정 닫기" }).click();
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
  await page.getByRole("link", { name: "갤러리", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/gallery$/);
  await expect(page.getByRole("main", { name: "생성 이미지 갤러리" }).getByRole("article")).toHaveCount(1);
  await page.goBack(); await expect(page).toHaveURL(/\/ideal\/chat$/);
  await expect(page.getByText("여기서 함께 이야기해요.", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
