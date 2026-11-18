import { test, expect } from "@playwright/test";
import { chapterEvent, generateCharacter, enterCharacterMode } from "./character-helpers";
import type { Timeline } from "../../lib/chat/timeline";
import {emptyChatMemory} from "../../lib/chat/memory";
import {personalityState} from "../../lib/chat/personality";

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
      if (chatCalls === 1) {
        next.scene = [{ subjectId: "user", text: "서점에 도착" }];
        next.canon=[{id:"chat:fact_1_0",source:"chat",sourceId:"user_1",subjectId:"user",objectId:"character",key:"event_rescue",kind:"event",status:"completed",visibility:"character",text:"서하를 구했다",evidence:"너를 구했어"}];
      }
      else {
        expect(old.scene[0].text).toBe("다음 날 서점에서 재회");
        expect(old.relationships[0].text).toBe("화해함");
        expect(old.canon?.at(-1)?.source).toBe("novel");
        expect(body.chatMemory.personality.currentGoal).toBe("서점에서 함께 이야기하기");
      }
      const memory={...(body.chatMemory??emptyChatMemory("서하")),turn:(body.chatMemory?.turn??0)+1,personality:{...personalityState(body.character,body.chatMemory?.personality),currentGoal:"서점에서 함께 이야기하기"}};
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text: "서점에서 만나요." })}\n\ndata: ${JSON.stringify({ type: "memory", expectedTurn:body.chatMemory?.turn??0,state:memory })}\n\ndata: ${JSON.stringify({ type: "timeline", expectedRevision: old.revision, state: next })}\n\ndata: {"type":"done"}\n\n` });
    } else {
      storyCalls++;
      // A failed first attempt must leave the revision from chat intact.
      expect(old.revision).toBe(1);
      expect(old.scene[0].text).toBe("서점에 도착");
      expect(old.canon?.[0]?.text).toBe("서하를 구했다");
      next.scene = [{ subjectId: "character", text: "다음 날 서점에서 재회" }];
      next.relationships = [{ subjectId: "character", text: "화해함" }];
      next.canon=[...(old.canon??[]),{id:"novel:1:character:relationship_user",source:"novel",sourceId:"chapter_1",subjectId:"character",objectId:"user",key:"relationship_user",kind:"relationship",status:"completed",visibility:"character",text:"화해함",evidence:"서하와 당신은 서점에서 화해했다"}];
      const timeline = `data: ${JSON.stringify({ type: "timeline", expectedRevision: old.revision, state: next })}\n\n`;
      await route.fulfill({ contentType: "text/event-stream", body: timeline + (storyCalls === 1
        ? 'data: {"type":"error","message":"검증 실패"}\n\n'
        : `data: ${JSON.stringify(chapterEvent(body, "다음 날, 서하와 당신은 서점에서 화해했다."))}\n\ndata: {"type":"done"}\n\n`) });
    }
  });
  await enterCharacterMode(page);
  await page.getByRole("textbox", { name: "AI에게 보낼 메시지" }).fill("나는 서점에 도착했어. 너를 구했어.");
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
  await expect(page.getByRole("button", { name: "AI 대화 초기화", exact: true })).toHaveCount(0);
});
