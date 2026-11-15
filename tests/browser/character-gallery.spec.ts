import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { fillCharacterProfile } from "./character-helpers";

test("images fit their actual aspect ratio; gallery keeps prior generations through reset and supports preview/download", async ({ page }) => {
  await page.goto("/ideal/gallery");
  await expect(page.getByText("아직 생성한 이미지가 없어요.")).toBeVisible();
  await page.getByRole("link", { name: "캐릭터 생성하기", exact: true }).click();
  await fillCharacterProfile(page);
  const landscape = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#adc6c9" } }).jpeg().toBuffer();
  const portrait = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#c8a9b0" } }).jpeg().toBuffer();
  let calls = 0;
  await page.route("**/api/characters", route => {
    calls++;
    if (calls === 3) return route.fulfill({ status: 502, json: { error: "이미지 생성 실패" } });
    return route.fulfill({ contentType: "image/jpeg", body: calls === 1 ? landscape : portrait,
      headers: { "X-Character-Title": encodeURIComponent(calls === 1 ? "가로 이미지" : "세로 이미지"), "X-Character-Width": calls === 1 ? "600" : "300", "X-Character-Height": calls === 1 ? "300" : "450" } });
  });
  const generate = page.getByRole("button", { name: "캐릭터 생성", exact: true });
  await generate.click();
  const image = page.getByAltText("가로 이미지 — 생성된 2D 캐릭터 일러스트", { exact: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(image).toBeVisible();
    await expect.poll(async () => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(600);
    const size = await image.boundingBox();
    const canvas = await page.locator(".character-canvas").boundingBox();
    expect(size!.width / size!.height).toBeCloseTo(2, 2);
    expect(canvas!.height).toBeCloseTo(size!.height, 1);
    expect(canvas!.width).toBeCloseTo(size!.width, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("link", { name: "갤러리", exact: true }).click();
  const gallery = page.getByRole("main", { name: "생성 이미지 갤러리" });
  await expect(gallery.getByRole("article")).toHaveCount(1);
  await gallery.getByRole("button", { name: "이미지 보기: 가로 이미지", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true });
  await expect(viewer.getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  await expect(gallery.getByRole("button", { name: "이미지 보기: 가로 이미지", exact: true })).toBeFocused();
  const downloadEvent = page.waitForEvent("download");
  await gallery.getByRole("link", { name: "다운로드: 가로 이미지", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("가로_이미지.jpg");
  await page.getByRole("link", { name: "캐릭터 생성", exact: true }).click();
  await generate.click();
  const second = page.getByAltText("세로 이미지 — 생성된 2D 캐릭터 일러스트", { exact: true });
  await expect(second).toBeVisible();
  const size = await second.boundingBox();
  expect(size!.width / size!.height).toBeCloseTo(2 / 3, 2);
  expect((await page.locator(".character-canvas").boundingBox())!.height).toBeCloseTo(size!.height, 1);
  await generate.click();
  await expect(page.getByText("이미지 생성 실패", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "새 캐릭터 대화", exact: true }).click();
  await page.getByRole("link", { name: "갤러리", exact: true }).click();
  await expect(gallery.getByRole("article")).toHaveCount(2);
  for (const image of await gallery.getByRole("img").all()) {
    await expect.poll(async () => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".verification/gallery-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls).toBe(3);
  await page.reload();
  await expect(page.getByText("아직 생성한 이미지가 없어요.")).toBeVisible();
});
