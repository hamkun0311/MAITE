import { test, expect } from "@playwright/test";
import { generateCharacter, enterCharacterMode } from "./character-helpers";
import { emptyChatMemory, type ChatMemory } from "../../lib/chat/memory";

test("conversation memory survives trimmed history and navigation; failed metadata never commits and reset clears it", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const bodies: { chatMemory?: ChatMemory; messages: { content: string }[] }[] = [];
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const old = body.chatMemory ?? emptyChatMemory("서하");
    const state: ChatMemory = { ...old, turn: old.turn + 1,
      participants: [{ id: "user", name: "사용자" }, { id: "character", name: "서하" }, { id: "npc_1", name: "민수" }],
      facts: [{ id: "fact_1_0", subjectId: "user", objectId: null, action: "arrival_status", value: "사용자가 늦음", certainty: "asserted", evidence: "내가 늦어", sourceTurnId: "user_1" }],
    };
    const failed = body.messages.at(-1).content === "기억 실패";
    return route.fulfill({ contentType: "text/event-stream", body:
      `data: ${JSON.stringify({ type: "delta", text: "늦는 건 너잖아. 민수는 아직 오는 거고. ㅋㅋ" })}\n\n` +
      `data: ${JSON.stringify({ type: "memory", state, expectedTurn: old.turn })}\n\n` +
      (failed ? 'data: {"type":"error","message":"기억 처리 실패"}\n\n' : 'data: {"type":"done"}\n\n') });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  const input = chat.getByLabel("AI에게 보낼 메시지");
  const send = async (text: string) => {
    await input.fill(text); await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
    await expect(input).toBeEnabled();
  };
  await send("민수 만나기로 했는데 내가 늦어");
  for (let index = 0; index < 11; index++) await send(`잡담 ${index}`);
  expect(bodies.at(-1)!.messages.some(message => message.content.includes("내가 늦어"))).toBe(false);
  expect(bodies.at(-1)!.chatMemory!.facts[0].subjectId).toBe("user");
  await page.goBack(); await expect(page.getByRole("group", { name: "캐릭터와 함께하기" })).toBeVisible();
  await enterCharacterMode(page);
  await send("기억 실패");
  const before = bodies.at(-1)!.chatMemory!;
  await expect(chat.getByText("기억 처리 실패", { exact: true })).toBeVisible();
  await send("그럼 둘이 놀자");
  expect(bodies.at(-1)!.chatMemory).toEqual(before);
  await expect(chat.getByRole("log")).not.toContainText("sourceTurnId");
  await chat.getByRole("button", { name: "AI 대화 초기화", exact: true }).click();
  await send("다시 시작");
  expect(bodies.at(-1)!.chatMemory).toBeUndefined();
  expect(bodies.at(-1)!.messages).toHaveLength(1);
});
