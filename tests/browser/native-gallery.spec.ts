import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";

test("reader gallery shows the original image and reapplies it without generating another image", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  let extraRequests = 0;
  await page.route("**/api/characters", route => { extraRequests++; return route.abort(); });
  await enterCharacterMode(page);
  await page.getByRole("button", { name: "배경 변경", exact: true }).click();
  await expect(page.getByRole("button", { name: "배경 선택: 은발 탐정", exact: true })).toHaveText("");
  await page.getByRole("button", { name: "배경 선택: 배경 없음", exact: true }).click();
  await expect(page.locator(".character-experience .character-backdrop")).toHaveCount(0);
  await page.getByRole("link", { name: "장면 갤러리", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "이미지 종류" })).toBeVisible();
  await page.getByRole("button", { name: "이미지 보기: 은발 탐정", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true });
  await expect(viewer).toBeVisible();
  expect(await viewer.getByRole("img").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  await viewer.getByRole("button", { name: "대화 배경으로 적용", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/chat$/);
  await expect(page.locator(".character-experience .character-backdrop")).toBeVisible();
  expect(extraRequests).toBe(0);
});
