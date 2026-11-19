import { expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { emptyStoryState, type StoryState } from "../../lib/novel/state";

export function chapterEvent(body: { storyState?: StoryState; additionalConcept?: string }, text: string) {
  const state = body.storyState ?? emptyStoryState();
  return { type: "chapter", text, expectedChapter: state.chapter,
    state: { ...state, ...(body.additionalConcept ? { seriesStartChapter: state.chapter, seriesConcept: body.additionalConcept } : {}), chapter: state.chapter + 1, previousProse: text, previousEnding: text.slice(-700),
      recentEvents: ["서하가 친구와 재회했다."], resolvedEvents: ["서점에서의 재회"], nextChapterGoal: "함께 서점을 정리한다." } };
}
export function storyWire(body: { storyState?: StoryState; additionalConcept?: string }, text: string) {
  return `data: ${JSON.stringify(chapterEvent(body, text))}\n\ndata: {"type":"done"}\n\n`;
}

export async function fillCharacterProfile(page: Page) {
  await page.getByLabel("캐릭터 이름").fill("서하");
  await page.getByLabel("나이", { exact: true }).fill("25");
  await page.getByRole("combobox", { name: "성별", exact: true }).selectOption("여성");
  await page.getByLabel("외모", { exact: true }).fill("긴 은발, 보라색 눈동자, 갸름한 얼굴");
  await page.getByLabel("성격", { exact: true }).fill("도도하지만 다정한 성격");
  await page.getByLabel("컨셉", { exact: true }).fill("재회한 라이벌과 도시의 비밀을 추적한다");
}

export async function startNewCharacter(page: Page) {
  await openExistingCharacter(page);
  await page.getByRole("button", { name: "새 캐릭터 대화", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal$/);
  await expect(page.getByLabel("나이", { exact: true })).toHaveValue("");
  await generateCharacter(page);
  await enterCharacterMode(page);
}

export async function openExistingCharacter(page: Page) {
  await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"캐릭터",exact:true}).click();
  await expect(page.getByRole("heading",{name:"나의 캐릭터",exact:true})).toBeVisible();
  const selected=page.locator("button.native-character-card");
  if(await selected.count())await selected.click();
  else await page.getByRole("link",{name:"새 캐릭터 만들기",exact:true}).click();
}

export async function generateCharacter(page: Page) {
  await fillCharacterProfile(page);
  const jpeg = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#c3a4bc" } }).jpeg().toBuffer();
  await page.route("**/api/characters", route => route.fulfill({
    headers: { "Content-Type": "image/jpeg", "X-Character-Title": encodeURIComponent("은발 탐정"), "X-Character-Summary": encodeURIComponent("비 오는 도시의 은발 탐정"), "X-Character-Prompt": "Silver-haired detective, rainy city, 2D anime" }, body: jpeg,
  }));
  await page.getByLabel("컨셉", { exact: true }).fill("25살 은발 탐정, 비 오는 도시, 검은 코트");
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true }).waitFor();
  await expect(page.getByRole("dialog", {name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
}

export async function enterCharacterMode(page: Page, mode: "대화하기" | "이야기 만들기" = "대화하기") {
  const back = page.getByRole("button", { name: "캐릭터 이미지로 돌아가기", exact: true });
  // The URL may already be /ideal while the old screen is being unmounted.
  // Avoid a second back click on that stale screen during client-side routing.
  if (!/\/ideal$/.test(page.url()) && await back.isVisible()) {
    await back.click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/ideal$/);
  }
  await page.getByRole("group", { name: "캐릭터와 함께하기" }).getByRole("button", { name: mode, exact: true }).click();
  // Client-side routing may have an intentionally open SSE response. Assert
  // the route itself rather than waiting for an unrelated document load event.
  // Allow a cold Next development route to compile when these tests run alone.
  await expect(page).toHaveURL(mode === "대화하기" ? /\/ideal\/chat$/ : /\/ideal\/story$/, { timeout: 15000 });
}
