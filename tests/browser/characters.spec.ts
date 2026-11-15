import { test, expect } from "@playwright/test";
import { fillCharacterProfile } from "./character-helpers";

test("top menus, character generation, download and image-based revision", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ideal$/);
  await expect(page.getByRole("link", { name: "모양", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "캐릭터 생성", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const jpeg = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 720;
      c.height = 1280;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ebd8c5";
      g.fillRect(0, 0, 720, 1280);
      return c.toDataURL("image/jpeg").split(",")[1];
    }),
    "base64",
  );
  let calls = 0;
  await page.route("**/api/characters", async (route) => {
    calls++;
    const body = route.request().postDataBuffer()!.toString("utf8");
    expect(body).toContain("messages");
    expect(body).toContain('"genre":"막장드라마"');
    expect(body).toContain('"gender":"여성"');
    expect(body).toContain(calls === 1 ? "성인 여성, 우아한 원피스" : "은발의 성인 여성, 우아한 원피스");
    if (calls === 2) expect(body).toContain("previous-character.jpg");
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "X-Character-Title": encodeURIComponent("우아한 캐릭터"),
        "X-Character-Summary": encodeURIComponent("요청한 분위기로 그렸어요."),
        "X-Character-Prompt":
          "Portrait 9:16, 2D anime, woman in a dress, clean outlines, cel shading.",
        "X-Character-Style": "female",
      },
      body: jpeg,
    });
  });
  await fillCharacterProfile(page);
  await expect(page.getByRole("button", { name: "그림체 참고", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "생성 프롬프트", exact: true })).toHaveCount(0);
  await page.getByLabel("컨셉", { exact: true }).fill("성인 여성, 우아한 원피스");
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect(
    page.getByText("이미지 생성 완료 · JPG로 저장할 수 있습니다."),
  ).toBeVisible();
  await expect(
    page.getByAltText("우아한 캐릭터 — 생성된 2D 캐릭터 일러스트"),
  ).toBeVisible();
  await expect(page.getByText("720 × 1280 · 9:16 · JPG")).toBeVisible();
  await page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByAltText("우아한 캐릭터 — 전체화면 이미지")).toBeVisible();
  const size = await viewer.boundingBox();
  expect(size!.width).toBe(await page.evaluate(() => innerWidth));
  expect(size!.height).toBe(await page.evaluate(() => innerHeight));
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true }).click();
  await viewer.click({ position: { x: 5, y: 5 } });
  await expect(viewer).not.toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "이미지 다운로드" }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.jpg$/);
  await page.getByLabel("컨셉", { exact: true }).fill("은발의 성인 여성, 우아한 원피스");
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect(
    page.getByText("이미지 생성 완료 · JPG로 저장할 수 있습니다."),
  ).toBeVisible();
  expect(calls).toBe(2);
  await page.getByRole("button", { name: "새 캐릭터 대화" }).click();
  await expect(page.getByRole("link", { name: "이미지 다운로드" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: ".verification/ideal-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".verification/ideal-mobile.png",
    fullPage: true,
  });
  await expect(page.getByRole("link", { name: "모양", exact: true })).toHaveCount(0);
});
test("cancellation and API error never expose a stale character download", async ({
  page,
}) => {
  await page.goto("/ideal");
  await fillCharacterProfile(page);
  await page.route("**/api/characters", (route) =>
    route.fulfill({ status: 422, json: { error: "요청을 변경해주세요." } }),
  );
  await page.getByLabel("컨셉", { exact: true }).fill("성인 캐릭터");
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "요청을 변경해주세요." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이미지 다운로드" }),
  ).toBeDisabled();
  await page.unroute("**/api/characters");
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/characters", async (route) => {
    await wait;
    await route.abort().catch(() => {});
  });
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await page.getByRole("button", { name: "이미지 생성 취소" }).click();
  release();
  await expect(
    page.getByText("생성을 취소했습니다.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("컨셉", { exact: true })).toHaveValue(
    "성인 캐릭터",
  );
  await expect(page.getByRole("link", { name: "이미지 다운로드" })).toHaveCount(
    0,
  );
});
