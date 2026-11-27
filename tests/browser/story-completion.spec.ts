import { test, expect } from "@playwright/test";
import { chapterEvent, generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";
import type { StoryState } from "../../lib/novel/state";

test("five chapters complete the story; failed finale does not advance; reset starts at one", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  const bodies: { storyState?: StoryState; additionalConcept?: string; storyRestartId?: string }[] = [];
  let failedFinale = false;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const chapter = (body.storyState?.chapter ?? 0) + 1;
    if (chapter === 5 && !failedFinale) {
      failedFinale = true;
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"error","message":"마지막 회차를 다시 작성해주세요."}\n\n' });
    }
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, `${chapter}편. ${chapter === 5 ? "갈등이 끝나고 두 사람은 함께 서점을 열었다." : "새로운 선택으로 사건이 진전됐다."}`, chapter <= 5 ? "final" : "continue") });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const next = story.getByRole("button", { name: "다음 이야기", exact: true });
  const progress = story.locator(".story-page > span");
  await expect(progress).toContainText("이야기 #1");
  for (let chapter = 2; chapter <= 4; chapter++) {
    await next.click();
    await expect(progress).toContainText(`이야기 #${chapter}`);
    await expect(next).toBeEnabled();
  }
  await next.click();
  await expect(story.getByText("마지막 회차를 다시 작성해주세요.")).toBeVisible();
  await expect(progress).toContainText("이야기 #4");
  const retry = story.getByRole("button", { name: "이번화 다시 쓰기", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(progress).toHaveText("이야기 #5");
  const { storyRestartId, ...restarted } = bodies.at(-1)!;
  expect(storyRestartId).toBeTruthy();
  expect(restarted).toEqual(bodies.at(-2));
  const complete = story.getByRole("button", { name: "이야기 완결", exact: true });
  await expect(complete).toBeDisabled();
  await expect(story.getByRole("log").locator(".assistant")).toHaveCount(1);
  await expect(story.getByRole("button", { name: "삽화 생성", exact: true })).toBeEnabled();
  const count = bodies.length;
  await complete.evaluate(element => (element as HTMLButtonElement).click());
  expect(bodies).toHaveLength(count);
  await page.goBack();
  await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(complete).toBeDisabled();
  await expect(progress).toHaveText("이야기 #5");
  expect(bodies).toHaveLength(count);
  const concept = story.getByRole("textbox", { name: "다음 이야기 컨셉" });
  await concept.fill("서점을 둘러싼 새로운 라이벌이 나타난다");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(progress).toHaveText("이야기 #6");
  expect(bodies.at(-1)!.storyState!.chapter).toBe(5);
  expect(bodies.at(-1)!.additionalConcept).toBe("서점을 둘러싼 새로운 라이벌이 나타난다");
  await expect(concept).toHaveValue("");
  await expect(story.getByRole("log").locator(".assistant")).toHaveCount(1);
  await next.click();
  await expect(progress).toHaveText("이야기 #7");
  expect(bodies.at(-1)!.additionalConcept).toBeUndefined();
  expect(bodies.at(-1)!.storyState!.seriesStartChapter).toBe(5);
  await expect(story.getByRole("button", { name: "AI 대화 초기화", exact: true })).toHaveCount(0);
});

test("a failed added concept keeps the old chapter and restores the concept for retry and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal"); await generateCharacter(page);
  let failed = false;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON();
    if (body.additionalConcept && !failed) {
      failed = true;
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"error","message":"생성 실패"}\n\n' });
    }
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, "서하가 문을 열고 새로운 결정을 내렸다.") });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const next = story.getByRole("button", { name: "다음 이야기", exact: true });
  const progress = story.locator(".story-page > span");
  await expect(progress).toContainText("이야기 #1");
  await next.click(); await expect(progress).toContainText("이야기 #2");
  const concept = story.getByRole("textbox", { name: "다음 이야기 컨셉" });
  await concept.fill("잃어버린 동생과 재회한다");
  await expect(concept).toBeInViewport();
  expect((await concept.boundingBox())!.y).toBeLessThan((await next.boundingBox())!.y);
  await next.click();
  await expect(story.getByText("생성 실패", { exact: true })).toBeVisible();
  await expect(progress).toContainText("이야기 #2");
  await expect(concept).toHaveValue("잃어버린 동생과 재회한다");
  await page.goBack(); await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(concept).toHaveValue("잃어버린 동생과 재회한다");
  await story.getByRole("button", { name: "이번화 다시 쓰기", exact: true }).click(); await expect(progress).toContainText("이야기 #3");
  await expect(concept).toHaveValue("");
});

test("a draft preview remains readable without advancing the chapter", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const draft = "서하가 편지를 내려다봤다. 그녀는 봉투를 열기로 했다.";
  const sent: number[] = [];
  const restartIds: (string | undefined)[] = [];
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON();
    sent.push(body.storyState?.chapter ?? 0);
    restartIds.push(body.storyRestartId);
    return route.fulfill({ contentType: "text/event-stream", body: sent.length === 2
      ? `data: ${JSON.stringify({ type: "draft_preview", text: draft })}\n\ndata: {"type":"error","code":"story_draft_paused"}\n\n`
      : storyWire(body, "서하가 문을 열고 새로운 결정을 내렸다.") });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const next = story.getByRole("button", { name: "다음 이야기", exact: true });
  const heading = story.locator(".story-page > span");
  await expect(heading).toHaveText("이야기 #1");
  await next.click();
  await expect(heading).toHaveText("임시 원고");
  await expect(story.getByText(draft)).toBeVisible();
  const retry = story.getByRole("button", { name: "이번화 다시 쓰기", exact: true });
  await expect(retry).toBeVisible();
  await story.getByRole("button", { name: "임시 원고 닫기" }).click();
  await expect(heading).toHaveText("이야기 #1");
  await retry.click();
  await expect(heading).toHaveText("이야기 #2");
  await expect(next).toBeVisible();
  expect(sent).toEqual([0, 1, 1]);
  expect(restartIds.slice(0, 2)).toEqual([undefined, undefined]);
  expect(restartIds[2]).toMatch(/^[\da-f-]{36}$/);
});

test("finishing a streamed story preserves reading position and only shows the final prose", async ({ page }) => {
  const draft = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 문단에서 서하가 책장을 살피며 친구에게 자신의 생각을 이야기했다.`).join("\n\n");
  const final = draft.replace("친구에게", "동료에게");
  const wire = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
  await page.addInitScript(({ live, complete }) => {
    const actualFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.href, location.href);
      if (url.pathname !== "/api/chat") return actualFetch(input, init);
      const encoder = new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(live));
          window.addEventListener("complete-story-test", () => {
            controller.enqueue(encoder.encode(complete));
            controller.close();
          }, { once: true });
        },
      }), { headers: { "Content-Type": "text/event-stream" } }));
    };
  }, { live: wire({ type: "draft_live", text: draft }),
    complete: wire({ ...chapterEvent({}, final), styleDraft: draft }) + wire({ type: "done" }) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ideal"); await generateCharacter(page);
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  await expect(story.getByText("작성 중인 초고", { exact: true })).toBeVisible();
  const log = story.getByRole("log");
  const position = await log.evaluate(element => { element.scrollTop = 300; return element.scrollTop; });
  expect(position).toBeGreaterThan(200);
  await page.evaluate(() => window.dispatchEvent(new Event("complete-story-test")));
  await expect(story.locator(".story-page > span")).toHaveText("이야기 #1");
  await expect(story.getByText("초고와 편집본 비교", { exact: true })).toHaveCount(0);
  expect(await log.evaluate(element => element.scrollTop)).toBe(position);
});

test("a story completes after server-side recovery within the original request", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const opening = '서하가 문을 열었다. "들어와." 그는 옆으로 비켰다.';
  const continuation = "가".repeat(5000 - opening.length - 2);
  let attempts = 0;
  await page.route("**/api/chat", async route => {
    const request = route.request();
    attempts++;
    const progress = attempts === 2 ? 'data: {"type":"draft_progress","chars":851,"events":1}\n\n' : "";
    return route.fulfill({ contentType: "text/event-stream",
      body: progress + storyWire(request.postDataJSON(), attempts === 2 ? opening + "\n\n" + continuation : opening) });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const progress = story.locator(".story-page > span");
  await expect(progress).toHaveText("이야기 #1");
  await story.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(progress).toHaveText("이야기 #2");
  expect(await story.locator(".story-page > p").textContent()).toBe('서하가 문을 열었다.\n\n"들어와."\n\n그는 옆으로 비켰다.\n\n' + continuation);
  expect(attempts).toBe(2);
});

test("a concept after episode three starts a new arc that rolls over after episode eight", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const bodies: { storyState?: StoryState; additionalConcept?: string }[] = [];
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, "관계를 이어가며 새로운 선택의 결과를 맞았다.") });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const next = story.getByRole("button", { name: "다음 이야기", exact: true });
  const progress = story.locator(".story-page > span");
  await expect(progress).toContainText("이야기 #1");
  for (const episode of [2, 3]) {
    await next.click(); await expect(progress).toContainText(`이야기 #${episode}`);
  }
  await story.getByRole("textbox", { name: "다음 이야기 컨셉" }).fill("오해가 풀리고 두 사람은 화해한다");
  for (let episode = 4; episode <= 9; episode++) {
    await next.click();
    await expect(progress).toHaveText(`이야기 #${episode}`);
    await expect(story.getByRole("log").locator(".assistant > span").last()).toHaveText(`이야기 #${episode}`);
  }
  await expect(next).toBeEnabled();
  expect(bodies[8].storyState?.chapter).toBe(8);
  expect(bodies[8].additionalConcept).toBeUndefined();
  expect(bodies).toHaveLength(9);
  expect(bodies[3].storyState?.chapter).toBe(3);
  expect(bodies[4].storyState?.seriesStartChapter).toBe(3);
  expect(bodies[7].storyState?.chapter).toBe(7);
  await expect(story.getByRole("log").locator(".assistant > span")).toHaveText(["이야기 #9"]);
  for (let episode = 8; episode >= 1; episode--) {
    await story.getByRole("button", { name: "이전 이야기 보기", exact: true }).click();
    await expect(progress).toHaveText(`이야기 #${episode}`);
  }
  expect(bodies).toHaveLength(9);
  await expect(story.locator(".live-chat-status")).toHaveCount(0);
});
