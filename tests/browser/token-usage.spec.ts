import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";

test("token menu updates without interrupting generation, deduplicates events, preserves cancelled usage and exports CSV", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const target = window as typeof window & { usageSend?: (event: object) => void };
    window.fetch = async (input, init) => {
      if (String(input) !== "/api/chat") return original(input, init);
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        target.usageSend = event => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        init?.signal?.addEventListener("abort", () => { try { controller.error(new DOMException("Aborted", "AbortError")); } catch { /* already closed */ } });
      } });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  await page.goto("/ideal");
  await generateCharacter(page);
  await enterCharacterMode(page, "이야기 만들기");
  await expect(page.getByRole("button", { name: "다음 이야기" })).toBeDisabled();
  await page.waitForFunction(() => !!(window as typeof window & { usageSend?: unknown }).usageSend);
  const record = { id: "call-1", feature: "novel.chapter_plan", model: "gpt-5.4-mini", startedAt: new Date().toISOString(), durationMs: 20,
    status: "completed", inputTokens: 60, outputTokens: 15, totalTokens: 75, cachedTokens: 40, reasoningTokens: 5 };
  await page.evaluate(record => { const send = (window as typeof window & { usageSend: (event: object) => void }).usageSend;
    send({ type: "usage", record }); send({ type: "usage", record });
  }, record);
  await page.getByRole("button", { name: /토큰 사용량/ }).click();
  const menu = page.getByRole("dialog", { name: "토큰 사용량", exact: true });
  await expect(menu).toContainText("확인된 합계 75 토큰");
  await expect(menu).toContainText("회차 설계");
  await expect(page).toHaveURL(/\/ideal\/story$/);
  await page.evaluate(record => (window as typeof window & { usageSend: (event: object) => void }).usageSend({ type: "usage", record: {
    ...record, id: "call-2", feature: "novel.prose", status: "running", inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null,
  } }), record);
  await expect(menu).toContainText("원고 집필 / 재집필");
  await menu.getByRole("button", { name: "토큰 사용량 닫기" }).click();
  await page.getByRole("link", { name: "갤러리", exact: true }).click();
  await page.getByRole("button", { name: /토큰 사용량/ }).click();
  await expect(menu).toContainText("확인된 합계 75 토큰");
  await expect(menu).toContainText("중단");
  await expect(menu).toContainText("사용량 확인 불가 1회");
  const download = page.waitForEvent("download");
  await menu.getByRole("button", { name: "CSV 다운로드" }).click();
  expect((await download).suggestedFilename()).toMatch(/^maite-tokens-.*\.csv$/);
  await page.reload();
  await page.getByRole("button", { name: /토큰 사용량/ }).click();
  await expect(menu).toContainText("확인된 합계 75 토큰");
  await menu.getByRole("button", { name: "완료 기록 비우기" }).click();
  await expect(menu).toContainText("아직 기록된 작업이 없습니다");
});

test("mobile usage menu remains accessible without a character", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/ideal");
  const trigger = page.getByRole("button", { name: /토큰 사용량/ });
  await expect(trigger).toBeInViewport();
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "토큰 사용량", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "토큰 사용량 닫기" })).toBeInViewport();
  expect(await menu.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
});
