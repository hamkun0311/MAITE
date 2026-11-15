import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { generateCharacter, enterCharacterMode } from "./character-helpers";
import { emptyChatMemory, type ChatMemory } from "../../lib/chat/memory";

test("outfit requests retain a clothing-store move and dress from memory after those turns leave recent history", async ({ page }) => {
  await page.goto("/ideal"); await generateCharacter(page);
  const bodies: { messages: { role: string; content: string }[]; chatMemory?: ChatMemory }[] = [];
  await page.route("**/api/chat", route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const old = body.chatMemory ?? emptyChatMemory("서하");
    const first = bodies.length === 1;
    const reply = first ? "옷가게 피팅룸에서 파란 원피스로 갈아입었어." : body.messages.at(-1).content.includes("원피스") ? "이 원피스 마음에 들어." : "오늘은 즐거웠어.";
    const state: ChatMemory = { ...old, turn: old.turn + 1, facts: first ? [
      { id: "fact_1_0", subjectId: "character", objectId: null, action: "location", value: "카페를 나와 옷가게 피팅룸에 도착했다", certainty: "simulated", evidence: reply, sourceTurnId: "character_1" },
      { id: "fact_1_1", subjectId: "character", objectId: null, action: "outfit", value: "카페 앞치마를 벗고 파란 원피스로 갈아입었다", certainty: "simulated", evidence: reply, sourceTurnId: "character_1" },
    ] : old.facts };
    return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text: reply })}\n\ndata: ${JSON.stringify({ type: "memory", state, expectedTurn: old.turn })}\n\ndata: {"type":"done"}\n\n` });
  });
  const image = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#a8c2d7" } }).jpeg().toBuffer();
  let imageContext = "", imageMessage = "";
  await page.route("**/api/characters", async route => {
    const form = await new Request(route.request().url(), { method: "POST", headers: route.request().headers(), body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
    imageContext = JSON.parse(String(form.get("scene"))).context;
    imageMessage = JSON.parse(String(form.get("messages")))[0].content;
    expect((form.get("image") as File).name).toBe("original-character.jpg");
    return route.fulfill({ contentType: "image/jpeg", headers: { "X-Character-Title": encodeURIComponent("옷가게의 파란 원피스") }, body: image });
  });
  await enterCharacterMode(page);
  const chat = page.getByRole("region", { name: "대화하기", exact: true });
  const input = chat.getByLabel("AI에게 보낼 메시지");
  const send = async (text: string) => {
    await input.fill(text); await chat.getByRole("button", { name: "AI 메시지 보내기" }).click();
    await expect(input).toBeEnabled();
  };
  await send("카페를 나와 옷가게에 도착했어. 파란 원피스로 갈아입어줘.");
  for (let index = 0; index < 11; index++) await send(`잡담 ${index}`);
  await send("이 원피스로 보여줘.");
  expect(bodies.at(-1)!.messages.some(message => message.content.includes("옷가게"))).toBe(false);
  await chat.getByRole("button", { name: "의상 변경하기", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 이미지 전체화면", exact: true }).getByRole("img")).toBeVisible();
  expect(imageContext).toContain("옷가게 피팅룸");
  expect(imageContext).toContain("카페 앞치마를 벗고 파란 원피스");
  expect(imageContext).toContain('"subjectId":"character"');
  expect(imageMessage).not.toContain("비 오는 도시의 은발 탐정");
  expect(imageMessage).toContain("현재 실제 장소");
});
