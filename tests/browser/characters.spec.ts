import { test, expect } from "@playwright/test";

test("top menus, character generation, reference, download and image-based revision", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "모양", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "이상형", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "이상형", exact: true }),
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
  await page.getByRole("button", { name: "그림체 참고", exact: true }).click();
  await expect(page.getByAltText(/그림체 참고 샘플/)).toBeVisible();
  await page.getByRole("button", { name: "남자 스타일", exact: true }).click();
  await expect(page.getByText("남자 캐릭터 톤앤매너", { exact: true })).toBeVisible();
  await expect(page.getByAltText(/그림체 참고 샘플/)).toHaveCount(0);
  await page.getByRole("button", { name: "여자 스타일", exact: true }).click();
  await page.getByLabel("만들고 싶은 캐릭터").fill("동탄 유부녀 누님, 원피스");
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect(
    page.getByText("이미지 생성 완료 · JPG로 저장할 수 있습니다."),
  ).toBeVisible();
  await expect(
    page.getByAltText("우아한 캐릭터 — 생성된 2D 캐릭터 일러스트"),
  ).toBeVisible();
  await expect(page.getByText("720 × 1280 · 9:16 · JPG")).toBeVisible();
  await page
    .getByRole("button", { name: "생성 프롬프트", exact: true })
    .click();
  await expect(page.getByText(/Portrait 9:16, 2D anime/)).toBeVisible();
  await expect(page.getByText("여자 캐릭터 스타일", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "캐릭터 이미지", exact: true })
    .click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "이미지 다운로드" }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.jpg$/);
  await page.getByLabel("만들고 싶은 캐릭터").fill("은발로 바꿔줘");
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
  await page.getByRole("link", { name: "모양", exact: true }).click();
  await expect(page.getByLabel("만들고 싶은 모양")).toBeVisible();
});
test("cancellation and API error never expose a stale character download", async ({
  page,
}) => {
  await page.goto("/ideal");
  await page.route("**/api/characters", (route) =>
    route.fulfill({ status: 422, json: { error: "요청을 변경해주세요." } }),
  );
  await page.getByLabel("만들고 싶은 캐릭터").fill("성인 캐릭터");
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
  await expect(page.getByLabel("만들고 싶은 캐릭터")).toHaveValue(
    "성인 캐릭터",
  );
  await expect(page.getByRole("link", { name: "이미지 다운로드" })).toHaveCount(
    0,
  );
});
