import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode, storyWire } from "./character-helpers";
import type { StoryState } from "../../lib/novel/state";

test("ten chapters complete the story; failed finale does not advance; reset starts at one", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  const bodies: { storyState?: StoryState; additionalConcept?: string }[] = [];
  let failedFinale = false;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const chapter = (body.storyState?.chapter ?? 0) + 1;
    if (chapter === 10 && !failedFinale) {
      failedFinale = true;
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"error","message":"마지막 회차를 다시 작성해주세요."}\n\n' });
    }
    return route.fulfill({ contentType: "text/event-stream", body: storyWire(body, `${chapter}편. ${chapter === 10 ? "갈등이 끝나고 두 사람은 함께 서점을 열었다." : "새로운 선택으로 사건이 진전됐다."}`) });
  });
  await enterCharacterMode(page, "이야기 만들기");
  const story = page.getByRole("region", { name: "이야기 만들기", exact: true });
  const next = story.getByRole("button", { name: "다음 이야기", exact: true });
  const progress = story.locator(".live-chat-status");
  await expect(progress).toContainText("1/10편");
  for (let chapter = 2; chapter <= 9; chapter++) {
    await next.click();
    await expect(progress).toContainText(`${chapter}/10편 · AI가 만드는 이야기`);
    await expect(next).toBeEnabled();
  }
  await next.click();
  await expect(story.getByText("마지막 회차를 다시 작성해주세요.")).toBeVisible();
  await expect(progress).toContainText("9/10편");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(progress).toHaveText("10/10편 · 완결");
  expect(bodies.at(-1)).toEqual(bodies.at(-2));
  const complete = story.getByRole("button", { name: "이야기 완결", exact: true });
  await expect(complete).toBeDisabled();
  await expect(story.getByRole("log").locator(".assistant")).toHaveCount(10);
  await expect(story.getByRole("button", { name: "삽화 생성", exact: true })).toBeEnabled();
  const count = bodies.length;
  await complete.evaluate(element => (element as HTMLButtonElement).click());
  expect(bodies).toHaveLength(count);
  await page.goBack();
  await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(complete).toBeDisabled();
  await expect(progress).toHaveText("10/10편 · 완결");
  expect(bodies).toHaveLength(count);
  const concept = story.getByRole("textbox", { name: "다음 이야기 컨셉" });
  await concept.fill("서점을 둘러싼 새로운 라이벌이 나타난다");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(progress).toHaveText("1/10편 · AI가 만드는 이야기");
  expect(bodies.at(-1)!.storyState!.chapter).toBe(10);
  expect(bodies.at(-1)!.additionalConcept).toBe("서점을 둘러싼 새로운 라이벌이 나타난다");
  await expect(concept).toHaveValue("");
  await expect(story.getByRole("log").locator(".assistant")).toHaveCount(11);
  await next.click();
  await expect(progress).toHaveText("2/10편 · AI가 만드는 이야기");
  expect(bodies.at(-1)!.additionalConcept).toBeUndefined();
  expect(bodies.at(-1)!.storyState!.seriesStartChapter).toBe(10);
  await story.getByRole("button", { name: "AI 대화 초기화", exact: true }).click();
  await expect(progress).toContainText("0/10편");
  await next.click();
  await expect(progress).toContainText("1/10편 · AI가 만드는 이야기");
  expect(bodies.at(-1)!.storyState).toBeUndefined();
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
  const progress = story.locator(".live-chat-status");
  await expect(progress).toContainText("1/10편 · AI가 만드는 이야기");
  await next.click(); await expect(progress).toContainText("2/10편 · AI가 만드는 이야기");
  const concept = story.getByRole("textbox", { name: "다음 이야기 컨셉" });
  await concept.fill("잃어버린 동생과 재회한다");
  await expect(concept).toBeInViewport();
  expect((await concept.boundingBox())!.y).toBeLessThan((await next.boundingBox())!.y);
  await next.click();
  await expect(story.getByText("생성 실패", { exact: true })).toBeVisible();
  await expect(progress).toContainText("2/10편");
  await expect(concept).toHaveValue("잃어버린 동생과 재회한다");
  await page.goBack(); await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(concept).toHaveValue("잃어버린 동생과 재회한다");
  await next.click(); await expect(progress).toContainText("1/10편 · AI가 만드는 이야기");
  await expect(concept).toHaveValue("");
});
