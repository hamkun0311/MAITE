import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";
import type { StoryState } from "../../lib/novel/state";

test("five chapters complete the story; failed finale does not advance; reset starts at one", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  const bodies: { storyState?: StoryState; additionalConcept?: string }[] = [];
  let failedFinale = false;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const chapter = (body.storyState?.chapter ?? 0) + 1;
    if (chapter === 5 && !failedFinale) {
      failedFinale = true;
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"error","message":"마지막 회차를 다시 작성해주세요."}\n\n' });
    }
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, `${chapter}편. ${chapter === 5 ? "갈등이 끝나고 두 사람은 함께 서점을 열었다." : "새로운 선택으로 사건이 진전됐다."}`) });
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
  await expect(next).toBeEnabled();
  await next.click();
  await expect(progress).toHaveText("이야기 #5");
  expect(bodies.at(-1)).toEqual(bodies.at(-2));
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
  await next.click(); await expect(progress).toContainText("이야기 #3");
  await expect(concept).toHaveValue("");
});

test("a concept after episode three extends through episode eight without resetting labels", async ({ page }) => {
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
  for (let episode = 4; episode <= 8; episode++) {
    await next.click();
    await expect(progress).toHaveText(`이야기 #${episode}`);
    await expect(story.getByRole("log").locator(".assistant > span").last()).toHaveText(`이야기 #${episode}`);
  }
  await expect(story.getByRole("button", { name: "이야기 완결", exact: true })).toBeDisabled();
  expect(bodies).toHaveLength(8);
  expect(bodies[3].storyState?.chapter).toBe(3);
  expect(bodies[4].storyState?.seriesStartChapter).toBe(3);
  expect(bodies[7].storyState?.chapter).toBe(7);
  await expect(story.getByRole("log").locator(".assistant > span")).toHaveText(["이야기 #8"]);
  for (let episode = 7; episode >= 1; episode--) {
    await story.getByRole("button", { name: "이전 이야기 보기", exact: true }).click();
    await expect(progress).toHaveText(`이야기 #${episode}`);
  }
  expect(bodies).toHaveLength(8);
  await expect(story.locator(".live-chat-status")).toHaveCount(0);
});
