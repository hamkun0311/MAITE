import { openNewFace } from "./character-helpers";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { fillCharacterProfile, generateCharacter, enterCharacterMode } from "./character-helpers";

test("character creation completes while another footer menu is open", async ({ page }) => {
  await page.goto("/ideal"); await fillCharacterProfile(page);
  const jpeg = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#b9a4df" } }).jpeg().toBuffer();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("**/api/characters", async route => { requests++; await gate; await route.fulfill({ contentType: "image/jpeg", body: jpeg }); });
  const generate = page.getByRole("button", { name: "캐릭터 생성", exact: true });
  await generate.click(); await expect(generate).toHaveAttribute("aria-busy", "true");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await footer.getByRole("link", { name: "스토어", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/store$/); release();
  await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
  await openNewFace(page);
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
  expect(requests).toBe(1);
  expect((await page.locator(".chat-header").boundingBox())!.height).toBe(52);
  expect((await footer.boundingBox())!.height).toBe(56);
});

test("scene generation survives navigation and appears in the background picker", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  await page.route("**/api/chat", route => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"새 코트로 갈아입었어."}\n\ndata: {"type":"clothing","mentioned":true}\n\ndata: {"type":"done"}\n\n' }));
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  await chat.getByLabel("AI에게 보낼 메시지").fill("새 코트를 입어줘");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  const jpeg = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#a2b7ce" } }).jpeg().toBuffer();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let requests = 0;
  await page.route("**/api/characters", async route => { requests++; await gate; await route.fulfill({ contentType: "image/jpeg", headers: { "X-Character-Title": encodeURIComponent("새 코트 장면") }, body: jpeg }); });
  await chat.getByRole("button", { name: "이미지 생성", exact: true }).click();
  await expect(chat.getByRole("button", { name: "이미지 생성", exact: true })).toHaveAttribute("aria-busy", "true");
  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서점", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/bookshop$/); release();
  await page.goBack(); await expect(page).toHaveURL(/\/ideal\/chat$/);
  await expect(chat.getByRole("button", { name: "이미지 생성", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
  await chat.getByRole("button", { name: "배경 변경", exact: true }).click();
  await expect(page.getByRole("button", { name: "배경 선택: 새 코트 장면", exact: true })).toBeVisible(); expect(requests).toBe(1);
});
