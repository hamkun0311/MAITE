import { test, expect } from "@playwright/test";
import { fillCharacterProfile, generateCharacter, enterCharacterMode } from "./character-helpers";

test("the compact header restores the token usage dialog for generation tests", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/ideal");
  const header = page.locator(".chat-header");
  await expect(header.getByRole("link", { name: "내 프로필" })).toBeVisible();
  await expect(header.getByRole("link", { name: "하트 스토어" })).toBeVisible();
  await expect(header.getByRole("button", { name: "토큰 사용량",exact:true })).toBeVisible();
  await header.getByRole("button", { name: "토큰 사용량",exact:true }).click();
  const usage=page.getByRole("dialog",{name:"토큰 사용량",exact:true});
  await expect(usage).toBeVisible();await expect(usage).toContainText("확인된 합계");
  await page.getByRole("button",{name:"토큰 사용량 닫기",exact:true}).click();await expect(usage).not.toBeVisible();
  await expect(header.getByRole("link")).toHaveCount(2);
  await expect(header.getByRole("link", { name: "갤러리", exact: true })).toHaveCount(0);
});

test("failed novel reviews still show consumed tokens and never publish an unchecked chapter",async({page})=>{
 await page.goto("/ideal");await generateCharacter(page);
 let calls=0;
 await page.route("**/api/chat",route=>{
  calls++;
  const record={id:crypto.randomUUID(),feature:"novel.chapter_review",model:"gpt-5.4-mini",startedAt:new Date().toISOString(),durationMs:25807,status:"failed",inputTokens:14101,outputTokens:4000,totalTokens:18101,cachedTokens:0,reasoningTokens:4000};
  return route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"usage",record})}\n\ndata: ${JSON.stringify({type:"error",code:"output_token_limit",message:"출력 토큰 한도에 도달했습니다. 자동 재시도는 하지 않았습니다."})}\n\n`});
 });
 await enterCharacterMode(page,"이야기 만들기");
 await expect(page.locator(".chat-error")).toContainText("출력 토큰 한도");
 await expect(page.locator(".story-page")).toHaveCount(0);expect(calls).toBe(1);
 await page.locator(".chat-header").getByRole("button",{name:"토큰 사용량",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"토큰 사용량",exact:true});
 await expect(dialog).toContainText("확인된 합계 18,101 토큰");
 await dialog.locator(".token-usage-task").filter({hasText:"이야기 1회차"}).locator("summary").click();
 await expect(dialog.getByRole("cell",{name:"25.8초",exact:true})).toBeVisible();
 expect(calls).toBe(1);
});

test("character image generation stays inline with a spinner and can be cancelled without a loading popup", async ({ page }) => {
  await page.goto("/ideal"); await fillCharacterProfile(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/characters", async route => { await gate; await route.abort().catch(() => {}); });
  const button = page.getByRole("button", { name: "캐릭터 생성", exact: true }); await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true"); await expect(button.locator(".spin")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByLabel("캐릭터 이름")).toBeVisible();
  await page.getByRole("button", { name: "이미지 생성 취소", exact: true }).click(); release();
  await expect(button).toBeEnabled(); await expect(button).toHaveAttribute("aria-busy","false"); await expect(button.locator(".spin")).toHaveCount(0);
});

test("story generation uses an inline spinner and can be cancelled without a popup", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  await page.evaluate(() => { const original = window.fetch.bind(window); window.fetch = async (input, init) => {
    if (input !== "/api/chat") return original(input, init);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"phase","phase":"writing"}\n\n')); init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); } }), { headers: { "Content-Type": "text/event-stream" } });
  }; });
  await enterCharacterMode(page, "이야기 만들기");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".story-next-button .spin")).toBeVisible();
  await page.getByRole("button", { name: "이야기 생성 취소", exact: true }).click();
  await expect(page.locator(".story-next-button")).toBeEnabled();
});
