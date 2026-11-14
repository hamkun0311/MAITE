import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";

test("speech register persists beyond trimmed history and navigation, changes after completed replies and resets", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  const bodies: { speechStyle?: string; messages: { role: string; content: string }[] }[] = [];
  let failed = false;
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const direction = body.messages.at(-1).content;
    if (direction === "실패 전환" && !failed) {
      failed = true;
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"speech","speechStyle":"polite"}\n\ndata: {"type":"error","message":"다시 시도해주세요."}\n\n' });
    }
    const speechStyle = direction === "반말해줘" ? "casual" : direction === "존댓말해줘" ? "polite" : body.speechStyle ?? "polite";
    return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text: speechStyle === "casual" ? "오늘도 같이 걸을까?" : "오늘도 같이 걸을까요?" })}\n\ndata: ${JSON.stringify({ type: "speech", speechStyle })}\n\ndata: {"type":"done"}\n\n` });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  const input = chat.getByLabel("AI에게 보낼 메시지");
  const send = async (text: string) => {
    await input.fill(text); await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
    await expect(input).toBeEnabled();
  };
  await send("안녕하세요");
  expect(bodies[0].speechStyle).toBeUndefined();
  await send("반말해줘");
  expect(bodies[1].speechStyle).toBe("polite");
  for (let i = 0; i < 11; i++) await send(`대화 ${i}`);
  expect(bodies.at(-1)!.speechStyle).toBe("casual");
  expect(bodies.at(-1)!.messages.some(message => message.content === "반말해줘")).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/\/ideal$/);
  await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page);
  await send("실패 전환");
  await expect(chat.getByText("다시 시도해주세요.")).toBeVisible();
  await send("계속 걷자");
  expect(bodies.at(-1)!.speechStyle).toBe("casual");
  await send("존댓말해줘");
  await send("고마워요");
  expect(bodies.at(-1)!.speechStyle).toBe("polite");
  await chat.getByRole("button", { name: "AI 대화 초기화", exact: true }).click();
  await send("다시 처음부터");
  expect(bodies.at(-1)!.speechStyle).toBeUndefined();
  expect(bodies.at(-1)!.messages).toHaveLength(1);
});
