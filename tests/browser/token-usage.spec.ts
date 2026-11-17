import { test, expect } from "@playwright/test";
import { fillCharacterProfile, generateCharacter, enterCharacterMode } from "./character-helpers";

test("the top header contains only the profile and hearts, with no usage or gallery controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/ideal");
  const header = page.locator(".chat-header");
  await expect(header.getByRole("link", { name: "내 프로필" })).toBeVisible();
  await expect(header.getByRole("link", { name: "하트 스토어" })).toBeVisible();
  await expect(header.getByRole("button")).toHaveCount(0); await expect(header.getByRole("link")).toHaveCount(2);
  await expect(header.getByRole("button", { name: /토큰/ })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "갤러리", exact: true })).toHaveCount(0);
});

test("character image generation stays inline with a spinner and can be cancelled without a loading popup", async ({ page }) => {
  await page.goto("/ideal"); await fillCharacterProfile(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/characters", async route => { await gate; await route.abort().catch(() => {}); });
  const button = page.getByRole("button", { name: "캐릭터 생성", exact: true }); await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true"); await expect(button.locator(".spin")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByLabel("캐릭터 이름")).toBeVisible();
  await page.getByRole("button", { name: "이미지 생성 취소", exact: true }).click(); release();
  await expect(button).toBeEnabled(); await expect(page.getByText("생성을 취소했습니다.", { exact: false })).toBeVisible();
});

test("story loading retains its illustration but has no token usage button", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  await page.evaluate(() => { const original = window.fetch.bind(window); window.fetch = async (input, init) => {
    if (input !== "/api/chat") return original(input, init);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"phase","phase":"writing"}\n\n')); init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); } }), { headers: { "Content-Type": "text/event-stream" } });
  }; });
  await enterCharacterMode(page, "이야기 만들기"); const loading = page.getByRole("dialog", { name: "이야기를 쓰고 있어요" });
  await expect(loading).toBeVisible(); await expect(loading.getByRole("button", { name: /토큰/ })).toHaveCount(0);
  await loading.getByRole("button", { name: "생성 취소", exact: true }).click(); await expect(loading).toHaveCount(0);
});
