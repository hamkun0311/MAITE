import {test,expect} from "@playwright/test";
import {generateCharacter,enterCharacterMode} from "./character-helpers";
import sharp from "sharp";

test("successful chat image opens once and returns to the conversation when closed",async({page})=>{
 await page.goto("/ideal");await generateCharacter(page);await enterCharacterMode(page);
 await page.route("**/api/chat",route=>route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"delta",text:"응, 여기 앉자."})}\n\ndata: {"type":"done"}\n\n`}));
 const jpeg=await sharp({create:{width:72,height:128,channels:3,background:"#bb99dd"}}).jpeg().toBuffer();
 await page.route("**/api/characters",route=>route.fulfill({contentType:"image/jpeg",body:jpeg}));
 const chat=page.getByRole("region",{name:"대화하기",exact:true});
 const send=async(text:string)=>{await chat.getByLabel("AI에게 보낼 메시지").fill(text);await chat.getByRole("button",{name:"AI 메시지 보내기"}).click();await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();};
 await send("우리 카페에 도착했어.");await chat.getByRole("button",{name:"이미지 생성",exact:true}).click();
 const viewer=page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true});
 await expect(viewer).toBeVisible();await expect(viewer.locator("img")).toBeVisible();
 await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();await expect(viewer).not.toBeVisible();
 await send("뭐 마실래?");await expect(viewer).not.toBeVisible();await expect(chat).toContainText("뭐 마실래?");
});
test("an agreed school visit enables generation and forwards the destination despite false location metadata",async({page})=>{
 await page.goto("/ideal");await generateCharacter(page);
 await page.route("**/api/chat",route=>route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"delta",text:"좋아, 가보자 ㅋㅋ\n\n오랜만에 보면 느낌 좀 이상하겠다."})}\n\ndata: {"type":"location","changed":false}\n\ndata: {"type":"done"}\n\n`}));
 let context="";
 await page.route("**/api/characters",async route=>{
  const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();
  context=JSON.parse(String(form.get("scene"))).context;
  await route.fulfill({status:503,json:{error:"테스트 종료"}});
 });
 await enterCharacterMode(page);
 const chat=page.getByRole("region",{name:"대화하기",exact:true});
 await chat.getByLabel("AI에게 보낼 메시지").fill("그냥 오랜만에 온김에 ㅋㅋㅋ 우리 옛날에 다녔던 학교 가볼래 ?");
 await chat.getByRole("button",{name:"AI 메시지 보내기"}).click();
 const button=chat.getByRole("button",{name:"이미지 생성",exact:true});
 await expect(button).toBeEnabled();await button.click();
 await expect(chat.getByRole("alert")).toContainText("테스트 종료");
 expect(context).toContain('"location":"학교"');expect(context).toContain("not an established arrival");
});
test("local scene remembers the user's shop across generic replies and uses it in the image request",async({page})=>{
 await page.goto("/ideal");await generateCharacter(page);
 let turns=0;
 await page.route("**/api/chat",route=>{
  const answers=["응, 들어가자. 여기 맞으면 좋겠다 ㅋㅋ\n\n나 배고파서 빨리 먹고 싶어.","응, 나는 매운맛이 좋아.","응, 흰 셔츠로 갈아입었어.","응, 여기 앉자.","응, 내일 가자."];
  return route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"delta",text:answers[turns++]})}\n\ndata: {"type":"done"}\n\n`});
 });
 let imageContext="";
 await page.route("**/api/characters",async route=>{
  const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();
  imageContext=JSON.parse(String(form.get("scene"))).context;
  return route.fulfill({status:503,json:{error:"테스트 종료"}});
 });
 await enterCharacterMode(page);
 const chat=page.getByRole("region",{name:"대화하기",exact:true});
 const send=async(text:string)=>{await chat.getByLabel("AI에게 보낼 메시지").fill(text);await chat.getByRole("button",{name:"AI 메시지 보내기"}).click();await expect(chat.getByLabel("AI에게 보낼 메시지")).toBeEnabled();};
 const button=chat.getByRole("button",{name:"이미지 생성",exact:true});
 await send("여기가 내가 찾은 떡볶이집이야. 들어갈까 ?");
 await expect(button).toBeEnabled();
 await send("어떤 맛으로 주문할까?");
 await send("너 흰 셔츠로 갈아입어줘.");
 await send("우리 카페에 도착했어.");
 await button.click();await expect(chat.getByRole("alert")).toContainText("테스트 종료");expect(imageContext).toContain('"location":"카페"');expect(imageContext).toContain('"outfit":"흰 셔츠"');
 await send("내일은 서점에 가자.");
 const stored=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("maite-visual-scene:")).map(key=>JSON.parse(localStorage.getItem(key)!)));
 expect(stored).toContainEqual(expect.objectContaining({location:"카페",outfit:"흰 셔츠"}));
 await page.getByRole("button",{name:"캐릭터 이미지로 돌아가기",exact:true}).click();await expect(page).toHaveURL(/\/ideal$/);await enterCharacterMode(page);
});
