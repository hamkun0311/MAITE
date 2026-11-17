import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";

test("location-only changes enable image generation; plans, failure and ordinary chat do not", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  let calls = 0, images = 0;
  await page.route("**/api/chat", route => {
    calls++;
    if (calls === 4) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"location","changed":true}\n\ndata: {"type":"error","message":"응답 실패"}\n\n' });
    const changed = calls === 1 || calls === 5;
    const text = changed ? "같이 카페에 도착했네. 여기 앉자." : calls === 3 ? "내일 서점에 가자." : "알겠어.";
    return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text })}\n\ndata: {"type":"clothing","mentioned":false}\n\ndata: ${JSON.stringify({ type: "location", changed })}\n\ndata: {"type":"done"}\n\n` });
  });
  await page.route("**/api/characters", async route => {
    images++;
    const form = await new Request(route.request().url(), { method: "POST", headers: route.request().headers(), body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
    expect(JSON.parse(String(form.get("scene"))).context).toContain("카페에 도착");
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"이미지 테스트 실패"}' });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  const button = chat.getByRole("button", { name: "이미지 생성", exact: true });
  const send = async (text: string) => {
    await chat.getByLabel("AI에게 보낼 메시지").fill(text);
    await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
    await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
  };
  await send("여기 카페에 같이 도착했어");
  await expect(button).toBeEnabled();
  expect(images).toBe(0);
  await button.click();
  await expect(page.getByText("이미지 테스트 실패", { exact: true })).toBeVisible();
  expect(images).toBe(1);
  await send("알았어");
  await expect(button).toBeDisabled();
  await send("내일은 서점에 가자");
  await expect(button).toBeDisabled();
  await send("다른 장소");
  await expect(page.getByText("응답 실패", { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  await send("카페에 왔어");
  await expect(button).toBeEnabled();
  await page.getByRole("button", { name: "캐릭터 이미지로 돌아가기", exact: true }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/ideal$/);
  await enterCharacterMode(page);
  await expect(button).toBeEnabled();
  await chat.getByRole("button", { name: "AI 대화 초기화", exact: true }).click();
  await expect(button).toHaveCount(0);
});
