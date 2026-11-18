import { test, expect } from "@playwright/test";

// Mock only the paid AI boundary. The real browser Worker, OCCT, preview and STEP writer run.
const fixture = {
  title: "잠자는 강아지",
  summary: "낮은 몸통과 앞발 위의 머리, 귀를 구성했습니다.",
  limitations: ["기본 곡면 조립체로 단순화했습니다."],
  unit: "mm",
  parts: [
    {
      id: "body",
      name: "몸통",
      type: "ellipsoid",
      size: [60, 30, 25],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      mode: "add",
      target: "",
    },
    {
      id: "head",
      name: "머리",
      type: "ellipsoid",
      size: [24, 24, 20],
      position: [32, 0, -2],
      rotation: [0, 10, 0],
      mode: "add",
      target: "",
    },
    {
      id: "paw",
      name: "앞발",
      type: "ellipsoid",
      size: [22, 10, 7],
      position: [30, -10, -10],
      rotation: [0, 0, -10],
      mode: "add",
      target: "",
    },
    {
      id: "base",
      name: "받침",
      type: "box",
      size: [100, 60, 5],
      position: [0, 0, -17],
      rotation: [0, 0, 0],
      mode: "add",
      target: "",
    },
    {
      id: "hole",
      name: "구멍",
      type: "cylinder",
      size: [6, 6, 10],
      position: [-40, -20, -17],
      rotation: [0, 0, 0],
      mode: "cut",
      target: "base",
    },
    {
      id: "roof",
      name: "지붕 검증",
      type: "roof",
      size: [10, 12, 8],
      position: [-30, 20, 0],
      rotation: [0, 0, 15],
      mode: "add",
      target: "",
    },
  ],
};
test("chat context to real scene Worker and STEP; cancel and retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let requests = 0;
  await page.route("**/api/generations", async (route) => {
    const body = route.request().postDataJSON();
    requests++;
    if (requests === 2) expect(body.messages.length).toBe(3);
    await route.fulfill({
      json: {
        optimizedPrompt:
          "Sleeping dog, lowered head on forward paws, 100mm miniature",
        explanation: "잠자는 자세로 설계했습니다.",
        specification: fixture,
      },
    });
  });
  await page.goto("/technical/cad");
  await expect(page.getByLabel("서비스 접근 코드")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("이메일", { exact: true })).toHaveCount(0);
  await page.getByLabel("만들고 싶은 모양").fill("엎드려 자는 강아지");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(
    page.getByText("3D 생성 · STEP 유효성 및 치수 재검증 완료"),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "정리된 프롬프트" }).click();
  await expect(page.getByText(/Sleeping dog, lowered/)).toBeVisible();
  await expect(page.getByRole("button", { name: "STEP 다운로드" })).toHaveCount(0);
  await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
  await page.screenshot({
    path: ".verification/chat-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("만들고 싶은 모양").fill("귀를 더 크게");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("설계한 모양을 만드는 중")).toBeVisible();
  await page.getByRole("button", { name: "생성 취소" }).click();
  await expect(
    page.getByRole("button", { name: "STEP 다운로드" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "명세로 다시 생성" }).click();
  await expect(
    page.getByText("3D 생성 · STEP 유효성 및 치수 재검증 완료"),
  ).toBeVisible({ timeout: 120000 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".verification/chat-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("API failure remains an error and never enables STEP", async ({
  page,
  request,
}) => {
  // The real API accepts requests without a login or shared code. Test server has no AI key.
  const response = await request.post("/api/generations", {
    data: { messages: [{ role: "user", content: "광화문" }] },
  });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toContain("OpenAI API 키");
  await page.route("**/api/generations", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "OpenAI API 키가 없습니다." },
    }),
  );
  await page.goto("/technical/cad");
  await page.getByLabel("만들고 싶은 모양").fill("광화문");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "API 키가 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "STEP 다운로드" }),
  ).toHaveCount(0);
});
