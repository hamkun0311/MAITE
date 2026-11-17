import { test, expect } from "@playwright/test";
import { chapterEvent, generateCharacter, enterCharacterMode } from "./character-helpers";
import type { Timeline } from "../../lib/chat/timeline";

test("chat and story exchange compact continuity, failed story changes never commit", async ({ page }) => {
  await page.goto("/ideal");
  await generateCharacter(page);
  let storyCalls = 0, chatCalls = 0;
  await page.route("**/api/chat", async route => {
    const body = route.request().postDataJSON();
    const old = body.timeline as Timeline;
    const next = structuredClone(old);
    next.revision++;
    next.participants = [{ id: "user", name: "당신" }, { id: "character", name: "서하" }];
    if (body.character.mode === "chat") {
      chatCalls++;
      if (chatCalls === 1) next.scene = [{ subjectId: "user", text: "서점에 도착" }];
      else {
        expect(old.scene[0].text).toBe("다음 날 서점에서 재회");
        expect(old.relationships[0].text).toBe("화해함");
      }
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text: "서점에서 만나요." })}\n\ndata: ${JSON.stringify({ type: "timeline", expectedRevision: old.revision, state: next })}\n\ndata: {"type":"done"}\n\n` });
    } else {
      storyCalls++;
      // A failed first attempt must leave the revision from chat intact.
      expect(old.revision).toBe(1);
      expect(old.scene[0].text).toBe("서점에 도착");
      next.scene = [{ subjectId: "character", text: "다음 날 서점에서 재회" }];
      next.relationships = [{ subjectId: "character", text: "화해함" }];
      const timeline = `data: ${JSON.stringify({ type: "timeline", expectedRevision: old.revision, state: next })}\n\n`;
      await route.fulfill({ contentType: "text/event-stream", body: timeline + (storyCalls === 1
        ? 'data: {"type":"error","message":"검증 실패"}\n\n'
        : `data: ${JSON.stringify(chapterEvent(body, "다음 날, 서하와 당신은 서점에서 화해했다."))}\n\ndata: {"type":"done"}\n\n`) });
    }
  });
  await enterCharacterMode(page);
  await page.getByRole("textbox", { name: "AI에게 보낼 메시지" }).fill("나는 서점에 도착했어");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(page.getByText("서점에서 만나요.", { exact: true })).toBeVisible();
  await enterCharacterMode(page, "이야기 만들기");
  await expect(page.getByText("검증 실패", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 이야기", exact: true }).click();
  await expect(page.getByText("다음 날, 서하와 당신은 서점에서 화해했다.", { exact: true })).toBeVisible();
  await enterCharacterMode(page);
  await page.getByRole("textbox", { name: "AI에게 보낼 메시지" }).fill("지금 어디야?");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect.poll(() => chatCalls).toBe(2);
  await expect(page.getByText("서점에서 만나요.", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "AI 대화 초기화", exact: true }).click();
  await page.getByRole("textbox", { name: "AI에게 보낼 메시지" }).fill("계속 이야기하자");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect.poll(() => chatCalls).toBe(3);
  expect(storyCalls).toBe(2);
});
