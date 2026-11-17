import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";

test("live chat shows partial output before completion, keeps context and stays separate from images", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  await enterCharacterMode(page);
  // Use a real browser ReadableStream: route.fulfill alone buffers the entire response.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let calls = 0;
    const scope = window as typeof window & { finishChat?: () => void; chatBodies?: unknown[] };
    scope.chatBodies = [];
    window.fetch = async (input, init) => {
      if (input !== "/api/chat") return original(input, init);
      calls++;
      scope.chatBodies!.push(JSON.parse(String(init?.body)));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(encoder.encode('data: {"type":"delta","text":"안녕하세요"}\n\n'));
        scope.finishChat = () => {
          c.enqueue(encoder.encode('data: {"type":"delta","text":"! 반가워요."}\n\ndata: {"type":"done"}\n\n'));
          c.close();
        };
        if (calls > 1) scope.finishChat();
      } }), { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  let images = 0;
  await page.route("**/api/characters", (route) => { images++; return route.abort(); });
  const chat = page.getByRole("region", { name: "AI 실시간 대화" });
  await chat.getByLabel("AI에게 보낼 메시지").fill("안녕");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByText("안녕하세요", { exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "AI 응답 중지" })).toBeVisible();
  await page.evaluate(() => (window as typeof window & { finishChat?: () => void }).finishChat!());
  await expect(chat.getByText("안녕하세요! 반가워요.", { exact: true })).toBeVisible();
  await chat.getByLabel("AI에게 보낼 메시지").fill("다음 이야기");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
  const bodies = await page.evaluate(() => (window as typeof window & { chatBodies: { messages: { role: string; content: string }[] }[] }).chatBodies);
  expect(bodies[1].messages).toEqual([
    { role: "user", content: "안녕" }, { role: "assistant", content: "안녕하세요! 반가워요." }, { role: "user", content: "다음 이야기" },
  ]);
  expect(images).toBe(0);
  await chat.getByRole("button", { name: "AI 대화 초기화" }).click();
  await expect(chat.getByText("다음 이야기", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeVisible();
  const log = chat.getByRole("log");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect.poll(async () => (await log.boundingBox())!.height / (844 - (await footer.boundingBox())!.height)).toBeGreaterThan(0.65);
  expect((await log.boundingBox())!.width).toBeGreaterThan(390 * 0.88);
  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await log.boundingBox())!.height / (viewport.height - (await footer.boundingBox())!.height)).toBeGreaterThan(0.55);
    expect((await log.boundingBox())!.width).toBeGreaterThan(Math.min(viewport.width, 480) * 0.85);
    await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("live chat cancellation restores input and API errors allow retry", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  await enterCharacterMode(page);
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    if (calls === 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); await route.abort().catch(() => {}); }
    else await route.fulfill({ status: 429, json: { error: "잠시 후 다시 대화해주세요." } });
  });
  const chat = page.getByRole("region", { name: "AI 실시간 대화" });
  await chat.getByLabel("AI에게 보낼 메시지").fill("대화 시작");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await chat.getByRole("button", { name: "AI 응답 중지" }).click();
  await expect(chat.getByText("응답을 중지했습니다.", { exact: true })).toBeVisible();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toHaveValue("대화 시작");
  await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(chat.getByText("잠시 후 다시 대화해주세요.")).toBeVisible();
  await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
});
