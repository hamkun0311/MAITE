import { test, expect, type Locator } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";

async function swipe(log: Locator, dx: number, dy = 0) {
  await log.dispatchEvent("touchstart", { touches: [{ identifier: 0, clientX: 190, clientY: 300 }] });
  await log.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 0, clientX: 190 + dx, clientY: 300 + dy }] });
}

test("swiping reads saved chapters without requests; continuation and illustrations use the right chapter", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const bodies: { storyState?: { chapter: number }; messages: { role: string; content: string }[] }[] = [];
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const chapter = (body.storyState?.chapter ?? 0) + 1;
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, `원고${chapter}. ${chapter === 1 ? "카페에 도착했다." : "서점으로 이동했다."}`) });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const title = page.locator(".story-page > span"), log = page.getByRole("log");
  await expect(title).toHaveText("이야기 #1");
  await page.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(title).toHaveText("이야기 #2");
  await swipe(log, 90, 150); // Vertical reading must not change chapters.
  await expect(title).toHaveText("이야기 #2");
  await swipe(log, 100);
  await expect(title).toHaveText("이야기 #1");
  await expect(page.getByRole("button", { name: "이전 이야기 보기" })).toBeDisabled();
  await swipe(log, -100);
  await expect(title).toHaveText("이야기 #2");
  await log.focus(); await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText("이야기 #1");
  expect(bodies).toHaveLength(2);
  await page.goBack(); await enterCharacterMode(page, "이야기 만들기");
  await expect(title).toHaveText("이야기 #1");
  expect(bodies).toHaveLength(2);
  let sceneContext = "";
  await page.route("**/api/characters", async route => {
    const form = await new Request(route.request().url(), { method: "POST", headers: route.request().headers(), body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
    sceneContext = JSON.parse(String(form.get("scene"))).context;
    await route.fulfill({ status: 503, json: { error: "검사용 생성 중단" } });
  });
  await page.getByRole("button", { name: "삽화 생성", exact: true }).click();
  await expect(page.locator(".character-visual-error")).toHaveText("검사용 생성 중단");
  expect(sceneContext).toContain("원고1.");
  expect(sceneContext).not.toContain("원고2.");
  await page.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(title).toHaveText("이야기 #3");
  expect(bodies.at(-1)!.storyState?.chapter).toBe(2);
  expect(bodies.at(-1)!.messages.at(-2)!.content).toContain("원고2.");
});

test("story loading popup cancels an unfinished chapter and keeps the extra concept for retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal"); await generateCharacter(page);
  await page.route("**/api/chat", route => route.fulfill({ contentType: "text/event-stream", body: storyWire(route.request().postDataJSON(), "기존에 완료된 원고.") }));
  await enterCharacterMode(page, "이야기 만들기");
  await expect(page.locator(".story-page > span")).toHaveText("이야기 #1");
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (input !== "/api/chat") return original(input, init);
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"phase","phase":"writing"}\n\n'));
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } }), { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  const concept = page.getByRole("textbox", { name: "다음 이야기 컨셉" });
  await concept.fill("왕국으로 돌아간다");
  await page.getByRole("button", { name: "다음 이야기", exact: true }).click();
  const loading = page.getByRole("dialog", { name: "이야기를 쓰고 있어요" });
  await expect(loading).toBeVisible();
  const box = (await loading.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 422)).toBeLessThan(2);
  await expect(loading.locator("img")).toHaveJSProperty("complete", true);
  await page.screenshot({ path: ".verification/generation-loading-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(loading).toHaveCount(0);
  await expect(page.locator(".story-page > span")).toHaveText("이야기 #1");
  await expect(concept).toHaveValue("왕국으로 돌아간다");
  await expect(page.getByText("응답을 중지했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 이야기", exact: true })).toBeFocused();
});
