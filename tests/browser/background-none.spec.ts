import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";

test("background none is independent per screen, survives generation and can be restored", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal");
  await generateCharacter(page);
  let images = 0;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ contentType: "text/event-stream", body: body.character.mode === "story"
      ? storyWire(body, "서하는 창가에서 책을 펼쳤다.")
      : 'data: {"type":"delta","text":"새 코트로 갈아입었어."}\n\ndata: {"type":"clothing","mentioned":true}\n\ndata: {"type":"done"}\n\n' });
  });
  await page.route("**/api/characters", async route => {
    images++;
    const form = await new Request(route.request().url(), { method: "POST", headers: route.request().headers(), body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
    await route.fulfill({ contentType: "image/jpeg", headers: { "X-Character-Title": encodeURIComponent("새 장면") }, body: Buffer.from(await (form.get("image") as File).arrayBuffer()) });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  const picker = page.getByRole("dialog", { name: "배경 변경", exact: true });
  await expect(chat.locator(".character-backdrop")).toHaveCount(1);
  await chat.getByRole("button", { name: "배경 변경", exact: true }).click();
  await picker.getByRole("button", { name: "배경 선택: 배경 없음", exact: true }).click();
  await expect(chat.locator(".character-backdrop")).toHaveCount(0);
  await expect(chat).toHaveClass(/character-no-background/);
  await chat.getByRole("button", { name: "배경 변경", exact: true }).click();
  await expect(picker.getByRole("button", { name: "배경 선택: 배경 없음", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: ".verification/background-none.png" });
  await page.keyboard.press("Escape");
  expect(images).toBe(0);
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  await expect(story.getByText("서하는 창가에서 책을 펼쳤다.", { exact: true })).toBeVisible();
  await expect(story.locator(".character-backdrop")).toHaveCount(1);
  await story.getByRole("button", { name: "배경 변경", exact: true }).click();
  await picker.getByRole("button", { name: "배경 선택: 배경 없음", exact: true }).click();
  await enterCharacterMode(page);
  await expect(chat.locator(".character-backdrop")).toHaveCount(0);
  await chat.getByLabel("AI에게 보낼 메시지").fill("새 코트 입어줘");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await chat.getByRole("button", { name: "이미지 생성", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chat.locator(".character-backdrop")).toHaveCount(0);
  await chat.getByRole("button", { name: "배경 변경", exact: true }).click();
  await picker.getByRole("button", { name: "배경 선택: 새 장면", exact: true }).click();
  await expect(chat.locator(".character-backdrop")).toHaveCount(1);
  await expect(chat).not.toHaveClass(/character-no-background/);
  await enterCharacterMode(page, "이야기 만들기");
  await expect(story.locator(".character-backdrop")).toHaveCount(0);
  expect(images).toBe(1);
});
