import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

test("real Worker builds plate, validates STEP and downloads a CAD file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/technical/plate");
  await expect(
    page.getByRole("heading", { name: "아이디어를, 형태로." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "STEP 다운로드" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "3D 모델 생성" }).click();
  await expect(
    page.getByText("STEP 재검증 완료 · 다운로드할 수 있습니다."),
  ).toBeVisible({ timeout: 120000 });
  await expect(page.getByText("100.0 × 60.0 × 5.0 mm")).toBeVisible();
  await expect(page.getByText("29434.5 mm³")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "STEP 다운로드" }).click();
  const download = await downloadEvent;
  await mkdir(".verification", { recursive: true });
  await download.saveAs(".verification/mounting-plate.step");
  const content = await readFile(".verification/mounting-plate.step", "utf8");
  expect(content).toContain("ISO-10303-21;");
  expect(content).toContain("MANIFOLD_SOLID_BREP");
  expect(content.match(/CYLINDRICAL_SURFACE/g)?.length).toBe(4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".verification/desktop.png", fullPage: true });
  await page.getByLabel("가로 (mm)").fill("120");
  await expect(
    page.getByText("치수가 변경되었습니다.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3D 모델 생성" }).click();
  await page.getByRole("button", { name: "생성 취소", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "STEP 다운로드" }),
  ).toBeDisabled();
  await expect(
    page.getByText("작업을 취소했습니다.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("가로 (mm)").fill("100");
  await page.getByRole("button", { name: "3D 모델 생성" }).click();
  await expect(
    page.getByText("STEP 재검증 완료 · 다운로드할 수 있습니다."),
  ).toBeVisible({ timeout: 120000 });
  await page.reload();
  await page.getByRole("button", { name: /최근 디자인\s*2/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /마운팅 플레이트/ }),
  ).toHaveCount(2);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /마운팅 플레이트/ })
    .first()
    .click();
  await expect(page.getByLabel("가로 (mm)")).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "STEP 다운로드" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("invalid dimensions, presets, help, local history and mobile layout", async ({
  page,
}) => {
  await page.goto("/technical/plate");
  await page.getByLabel("모서리 간격 (mm)").fill("3");
  await expect(
    page.getByRole("alert").filter({ hasText: "여유가 필요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "3D 모델 생성" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /컴팩트 베이스/ }).click();
  await expect(page.getByLabel("가로 (mm)")).toHaveValue("60");
  await page.getByRole("button", { name: "도움말", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "설계 시작하기" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "최근 디자인 열기", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "3D 모델 생성" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".verification/mobile.png", fullPage: true });
});
