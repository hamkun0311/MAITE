import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { fillCharacterProfile } from "../browser/character-helpers";
import { snapshotSchema } from "../../lib/platform/snapshot";
import { createStudioSessions } from "../../lib/chat/session";
import { emptyStoryState } from "../../lib/novel/state";
import { koreaDay } from "../../lib/account/policy";

const userId = "11111111-1111-4111-8111-111111111111";
const characterId = "22222222-2222-4222-8222-222222222222";
const novelId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const archive = Array.from({ length: 5 }, (_, index) => [{ role: "user" as const, content: "비공개 지시" }, { role: "assistant" as const, content: `${index + 1}번째 회차의 원고입니다.` }]).flat();
const sessions = createStudioSessions();
const snapshot = snapshotSchema.parse({ version: 1, id: characterId,
  art: { title: "희진", summary: "서점에서 시작된 이야기", prompt: "private", style: "neutral", description: "서점", profile: { name: "희진", age: 25, personality: "다정함", concept: "서점의 친구" }, width: 72, height: 128, jobId },
  chat: sessions.chat, story: { ...sessions.story, documentId: novelId, lastJobId: jobId, archive, storyState: { ...emptyStoryState(), chapter: 5, previousProse: archive.at(-1)!.content,
    seriesArc: { endingMode: "final", endingPromise: "약속을 지킨다", installments: Array.from({ length: 5 }, (_, index) => ({ chapter: index + 1, goal: "목표", payoff: "결과" })) } } }, timeline: sessions.chat.timeline.state });

test("deleting later episodes from the story header preserves the selected episode", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page);
  await accountRoutes(page);
  const current = structuredClone(snapshot);
  current.story.storyPage = 2;
  current.story.committed = archive.slice(-4);
  const laterIllustration = "77777777-7777-4777-8777-777777777777";
  current.gallery = [{id:"later-illustration",title:"삭제한 회차의 삽화",kind:"illustration",jobId:laterIllustration,scene:{novelId,chapter:4}}];
  current.backgrounds.story = "later-illustration";
  const restored = structuredClone(current);
  delete restored.gallery[0].scene;
  delete restored.backgrounds.story;
  restored.rewindToken = "55555555-5555-4555-8555-555555555555";
  restored.story.archive = archive.slice(0, 6);
  restored.story.committed = restored.story.archive;
  restored.story.storyPage = 2;
  restored.story.storyState = { ...emptyStoryState(), chapter: 3, previousProse: archive[5].content };
  await page.route(`**/api/account?document=${characterId}*`, route => route.fulfill({
    json: { id: characterId, payload: current, media: { original: "https://example.test/image.jpg", gallery: {[laterIllustration]:"https://example.test/illustration.jpg"} } },
  }));
  let called = 0;
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "rewindStory") return route.fallback();
    ++called;
    expect(route.request().postDataJSON()).toEqual({ action: "rewindStory", studioId: characterId, novelId, from: 4, lastJobId: jobId });
    return route.fulfill({ json: restored });
  });
  await page.goto("/ideal/story");
  await expect(page.getByRole("log")).toContainText("3번째 회차");
  const heading = page.locator(".character-story-experience .character-screen-heading");
  const actions = heading.locator(".story-rewind-button, .character-background-button, .reader-gallery-button");
  await expect(actions).toHaveText(["뒤 이야기 삭제", "배경", "갤러리"]);
  const remove = heading.getByRole("button", { name: "뒤 이야기 삭제" });
  const icon = remove.locator("svg.lucide-trash-2");
  await expect(icon).toBeVisible();
  const fits = await remove.evaluate(button => {
    const icon = button.querySelector("svg")!.getBoundingClientRect();
    const label = button.querySelector("span")!.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return icon.left >= bounds.left && icon.right <= label.left && label.right < bounds.right;
  });
  expect(fits).toBe(true);
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "3화 뒤 이야기를 삭제할까요?" });
  await expect(dialog).toContainText("1~3화를 남깁니다");
  await expect(dialog).toContainText("4화부터");
  await dialog.getByRole("button", { name: "뒤 이야기 삭제" }).click();
  await expect(page.getByRole("log")).toContainText("3번째 회차");
  await expect(page.getByRole("button", { name: "다음 이야기 보기" })).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(page.getByText("다음 이야기에서 4화를 다시 쓸 수 있어요.")).toBeVisible();
  expect(called).toBe(1);
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "배경 변경", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const picker = page.getByRole("dialog", { name: "배경 변경", exact: true });
  await expect(picker.getByRole("button", { name: "배경 선택: 삭제한 회차의 삽화" })).toHaveAttribute("aria-pressed", "false");
  await picker.getByRole("button", { name: "배경 선택 닫기" }).evaluate(button => (button as HTMLButtonElement).click());

  let generationCalls = 0;
  await page.route("**/api/chat", route => {
    const request = route.request().postDataJSON();
    expect(request.rewindToken).toBe(restored.rewindToken);
    expect(request.storyDocumentId).toBe(novelId);
    expect(request.storyState.chapter).toBe(3);
    generationCalls++;
    return route.fulfill({ status: 503, json: { error: "요청 확인 완료" } });
  });
  await page.getByRole("button", { name: "다음 이야기", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const continuation = page.getByRole("dialog", { name: "다음 이야기를 만들까요?" });
  await expect(continuation).toBeVisible();
  await continuation.getByRole("button", { name: "이야기 만들기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "요청 확인 완료" })).toBeVisible();
  expect(generationCalls).toBe(1);
});

test("direct story and chat landings restore the selected character and remain on the activity after reload",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.started=true;saved.story.committed=archive;saved.story.storyPage=1;
 saved.chat.committed=[{role:"user",content:"다시 만나서 반가워"},{role:"assistant",content:"우리 이야기를 이어가자"}];saved.chat.archive=saved.chat.committed;
 let loads=0,aiCalls=0;
 await page.route(`**/api/account?document=${characterId}*`,route=>{loads++;return route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}});});
 await page.route("**/api/chat",route=>{aiCalls++;return route.abort();});
 for(const mode of ["story","chat"]){
  await page.goto(`/ideal/${mode}`);
  await expect(page.getByRole("log")).toContainText(mode==="story"?"2번째 회차":"우리 이야기를 이어가자");
  await expect(page).toHaveURL(new RegExp(`/ideal/${mode}$`));
  expect(await page.evaluate(key=>sessionStorage.getItem(key),`maite-active-character:${userId}`)).toBe(characterId);
  await page.reload();
  await expect(page.getByRole("log")).toContainText(mode==="story"?"2번째 회차":"우리 이야기를 이어가자");
  await expect(page).toHaveURL(new RegExp(`/ideal/${mode}$`));
  await expect(page.getByRole("heading",{name:"캐릭터를 먼저 만들어주세요."})).toHaveCount(0);
 }
 expect(loads).toBe(4);
 // Reordering several owned characters must not replace the last selected one.
 await page.route("**/api/account",route=>route.request().method()!=="GET"?route.fallback():route.fulfill({json:{userId,email:"test@example.com",profile:{display_name:"테스트"},wallet:{transferable:1000,bonus:5,free_chats:5},documents:[{id:"55555555-5555-4555-8555-555555555555",title:"수아",kind:"studio",character_name:"수아"},{id:characterId,title:"희진",kind:"studio",character_name:"희진"}],jobs:[]}}));
 await page.reload();await expect(page.getByRole("log")).toContainText("우리 이야기를 이어가자");
 await expect(page).toHaveURL(/\/ideal\/chat$/);expect(loads).toBe(5);expect(aiCalls).toBe(0);
});

test("activity restoration waits for cloud data, preserves navigation and offers character selection on failure",async({page})=>{
 await signIn(page);await accountRoutes(page);let release!:()=>void;
 await page.goto("/ideal/store");
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route(`**/api/account?document=${characterId}*`,async route=>{await held;return route.fulfill({json:{id:characterId,title:"희진",payload:snapshot,media:{original:"https://example.test/image.jpg",gallery:{}}}});});
 await page.goto("/ideal/story");await expect(page.getByRole("dialog",{name:"불러오는 중",exact:true})).toBeVisible();
 await expect(page.locator("dialog.screen-loading")).toHaveCount(1);
 await page.keyboard.press("Escape");await expect(page.getByRole("dialog",{name:"불러오는 중",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"캐릭터를 먼저 만들어주세요."})).toHaveCount(0);
 await page.goBack();release();
 await expect(page).toHaveURL(/\/ideal\/store$/);
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({status:500,json:{error:"fixture failure"}}));
 await page.goto("/ideal/story");
 await expect(page.getByText("저장된 캐릭터를 불러오지 못했습니다.",{exact:true})).toBeVisible();
 await expect(page.getByRole("link",{name:"나의 캐릭터에서 다시 선택"})).toBeVisible();
 await expect(page).toHaveURL(/\/ideal\/story$/);
});

test("screen loading reuses the writing artwork, clears on errors and excludes background notification sync",async({page})=>{
 await signIn(page);await accountRoutes(page);let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route(`**/api/account?document=${characterId}*`,async route=>{await held;return route.fulfill({json:{id:characterId,title:"희진",payload:snapshot,media:{original:"https://example.test/image.jpg",gallery:{}}}});});
 await page.goto(`/ideal/characters/${characterId}`);
 const popup=page.getByRole("dialog",{name:"불러오는 중",exact:true});
 await expect(popup).toBeVisible();await expect(popup).toHaveText("불러오는 중…");
 await expect(page.getByText("작품을 불러오는 중…",{exact:true})).toHaveCount(0);
 await expect.poll(()=>popup.locator("img").evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
 await page.screenshot({path:".verification/screen-loading.png",fullPage:true});
 release();await expect(popup).toHaveCount(0);await expect(page.getByRole("tabpanel",{name:"대화 목록"})).toBeVisible();
 let fail!:()=>void;const settingsHeld=new Promise<void>(resolve=>{fail=resolve;});
 await page.route("**/api/notifications",async route=>{await settingsHeld;return route.fulfill({status:500,json:{error:"알림 설정 조회 실패"}});});
 await page.goto("/ideal/mypage");await expect(popup).toBeVisible();fail();
 await expect(page.getByText("알림 설정 조회 실패",{exact:true})).toBeVisible();await expect(popup).toHaveCount(0);
 await page.route("**/api/notifications?sync=1",async route=>{await new Promise(resolve=>setTimeout(resolve,500));return route.fulfill({json:{unread:{},pushEnabled:false,quietHours:true,available:true,activities:[],messages:[]}});});
 const sync=page.waitForRequest(request=>request.url().includes("/api/notifications?sync=1"));
 await page.evaluate(()=>window.dispatchEvent(new Event("maite-checkins-refresh")));await sync;
 await expect(popup).toHaveCount(0);
});

test("character creation uses automatic framing without camera detail inputs",async({page})=>{
 await signIn(page);await accountRoutes(page);let calls=0,submittedFraming:boolean|undefined;
 const jpeg=await sharp({create:{width:72,height:128,channels:3,background:"#b9a6dc"}}).jpeg().toBuffer();
 await page.route("**/api/characters",async route=>{
  calls++;const form=await new Request("http://test/image",{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();submittedFraming=form.has("framing");
  expect(form.get("renderStyle")).toBe("modern-cel-anime");
  return route.fulfill({headers:{"Content-Type":"image/jpeg","X-Job-Id":jobId,"X-Character-Render-Style":"modern-cel-anime"},body:jpeg});
 });
 await page.goto("/ideal/new");await fillCharacterProfile(page);
 const styles = page.getByRole("combobox", { name: "화풍", exact: true });
 await expect(styles).toHaveValue("");
 await expect(styles.locator("option")).toHaveText(["무작위", "부드러운", "화려한", "또렷한", "귀여운"]);
 await styles.selectOption({ label: "또렷한" });
 await expect(page.locator(".image-framing-fields")).toHaveCount(0);
 await expect(page.getByLabel("촬영 범위",{exact:true})).toHaveCount(0);
 const saved = page.waitForRequest(request => request.url().endsWith("/api/account") && request.method() === "POST" && request.postDataJSON().action === "save");
 await page.getByRole("button",{name:"캐릭터 생성",exact:true}).click();
 const confirm = page.getByRole("dialog",{name:"새로운 캐릭터를 만날까요?"});
 await confirm.getByRole("button",{name:"캐릭터 생성",exact:true}).click();
 await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
 expect((await saved).postDataJSON().payload.art.renderStyle).toBe("modern-cel-anime");
 expect(submittedFraming).toBe(false);expect(calls).toBe(1);
});

test("camera controls are exclusive to story illustrations while chat keeps scene keywords",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.art.renderStyle="detailed-game-anime";saved.story.started=true;saved.story.committed=archive;
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 const jpeg=await sharp({create:{width:72,height:128,channels:3,background:"#bea7df"}}).jpeg().toBuffer();
 const scenes:any[]=[];
 await page.route("**/api/characters",async route=>{
  const form=await new Request("http://test/image",{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();
  expect(form.get("renderStyle")).toBe("detailed-game-anime");
  scenes.push(JSON.parse(String(form.get("scene"))));return route.fulfill({contentType:"image/jpeg",body:jpeg});
 });
 for(const mode of ["chat","story"]){
  await page.goto(`/ideal/characters/${characterId}`);
  if(mode==="story")await page.getByRole("tab",{name:"소설",exact:true}).click();
  await page.getByRole("tabpanel",{name:mode==="chat"?"대화 목록":"소설 목록"}).getByRole("button").click();
  await page.getByRole("button",{name:mode==="chat"?"이미지 생성":"삽화 생성",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:mode==="chat"?"대화 장면을 그릴까요?":"삽화를 그릴까요?"});
  await dialog.getByLabel("장면 장소",{exact:true}).fill("카페 창가");
  if(mode==="chat"){
   await expect(dialog.locator(".image-framing-fields")).toHaveCount(0);
   await expect(page.getByText("이미지 구도",{exact:true})).toHaveCount(0);
   await dialog.getByLabel("장면 의상",{exact:true}).fill("흰 셔츠");
  }else{
   await dialog.getByLabel("삽화 대상 인물",{exact:true}).fill("희진");
   await dialog.getByLabel("촬영 범위",{exact:true}).selectOption("face");
   await dialog.getByLabel("카메라 각도",{exact:true}).selectOption("profile");
   await expect(dialog.getByLabel("시선",{exact:true})).toBeVisible();
   await expect(dialog.getByLabel("표정 (선택)",{exact:true})).toBeVisible();
   await expect(dialog.getByRole("button",{name:"그림 만들기",exact:true})).toBeEnabled();
   await dialog.getByLabel("촬영 범위",{exact:true}).selectOption("detail");
   await expect(dialog.getByRole("button",{name:"그림 만들기",exact:true})).toBeDisabled();
   await dialog.getByLabel("집중 대상",{exact:true}).fill("책상 위의 꽃");
  }
  await expect(dialog.getByRole("button",{name:"그림 만들기",exact:true})).toBeEnabled();
  await page.screenshot({path:`.verification/image-framing-${mode}-confirm.png`,fullPage:true});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await dialog.getByRole("button",{name:"그림 만들기",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
  if(mode==="chat")expect(scenes.at(-1).selection.framing).toBeUndefined();
  else expect(scenes.at(-1).selection.framing).toMatchObject({shot:"detail",angle:"profile",focus:"책상 위의 꽃"});
  expect(scenes.at(-1).kind).toBe(mode==="chat"?"outfit":"illustration");
  await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
 }
 expect(scenes).toHaveLength(2);
});

test("both new-character entries clear the selected character and every form field without deleting it",async({page})=>{
 await signIn(page);const deleted:string[]=[];await accountRoutes(page,true,deleted);
 const footer=page.getByRole("navigation",{name:"하단 메뉴"});
 for(const entry of ["plus","card"]){
  await page.goto(`/ideal/characters/${characterId}`);
  await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
  await footer.getByRole("link",{name:"캐릭터",exact:true}).click();
  if(entry==="plus")await page.getByRole("link",{name:"새 캐릭터 만들기",exact:true}).click();
  else await page.locator(".new-character-card").click();
  await expect(page).toHaveURL(/\/ideal\/new$/);
  for(const label of ["캐릭터 이름","나이","외모","성격","컨셉"])await expect(page.getByLabel(label,{exact:true})).toHaveValue("");
  await expect(page.getByRole("combobox",{name:"성별",exact:true})).toHaveValue("");
  await expect(page.getByRole("button",{name:"캐릭터 이미지 전체화면 보기",exact:true})).toHaveCount(0);
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await fillCharacterProfile(page);
  await footer.getByRole("link",{name:"캐릭터",exact:true}).click();
  await page.getByRole("link",{name:"새 캐릭터 만들기",exact:true}).click();
  await expect(page.getByLabel("캐릭터 이름",{exact:true})).toHaveValue("");
  expect(deleted).toEqual([]);
 }
});

test("notification polling uses one combined request and collapses foreground event bursts",async({page})=>{
 await signIn(page);await accountRoutes(page);await page.clock.install();
 let combined=0,legacy=0;
 await page.route("**/api/notifications**",route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.has("sync"))combined++;
  if(url.searchParams.has("inbox")||url.searchParams.has("schedule"))legacy++;
  return route.fulfill({json:{unread:{},pushEnabled:false,quietHours:true,available:true,nickname:"테스트",activities:[],lastDeliveredByCharacter:[]}});
 });
 await page.goto("/ideal/characters");await expect.poll(()=>combined).toBe(1);
 await page.evaluate(()=>{for(let i=0;i<20;i++){window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("maite-foreground"));}});
 await page.clock.runFor(300);expect(combined).toBe(1);
 await page.clock.fastForward(60000);await expect.poll(()=>combined).toBe(2);
 expect(legacy).toBe(0);await expect(page.locator(".checkin-footer-dot")).toHaveCount(0);
});

test("bookshelf replaces newface and remembers a separate last-read chapter",async({page})=>{
 await signIn(page);await accountRoutes(page);
 await page.route("**/api/store",route=>route.fulfill({json:{listings:[],owned:[]}}));
 await page.goto("/ideal/library");
 const footer=page.getByRole("navigation",{name:"하단 메뉴"});await expect(footer.getByRole("link")).toHaveText(["캐릭터","서고","서점","스토어","내 정보"]);
 await page.getByRole("link",{name:/희진의 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("1번째 회차");
 await page.getByRole("button",{name:"다음 이야기 보기",exact:true}).click();await page.getByRole("button",{name:"다음 이야기 보기",exact:true}).click();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await footer.getByRole("link",{name:"서고",exact:true}).click();await page.getByRole("link",{name:/희진의 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await page.reload();await expect(page.locator(".novel-reader")).toContainText("3번째 회차");
 await footer.getByRole("link",{name:"캐릭터",exact:true}).click();await page.getByRole("link",{name:"새 캐릭터 만들기",exact:true}).click();await expect(page.getByLabel("캐릭터 이름")).toBeVisible();
});

test("calendar claims today's attendance and missed pass days only on explicit action",async({page})=>{
 await signIn(page);await accountRoutes(page);let calls:any[]=[];
 const calendar={today:"2026-11-18",month:"2026-11-01",claims:[] as {day:string;kind:string;amount:number}[],passes:[{starts_on:"2026-11-01",ends_on:"2026-12-01",daily_hearts:20}]};
 await page.route("**/api/rewards**",route=>{
  if(route.request().method()==="POST"){const body=route.request().postDataJSON();calls.push(body);const amount=body.kind==="pass"?20:5;calendar.claims.push({...body,amount});return route.fulfill({json:{claimed:amount}});}
  return route.fulfill({json:calendar});
 });
 await page.goto("/ideal/mypage");await page.getByRole("link",{name:"출석보상",exact:true}).click();
 await expect(page.getByRole("heading",{name:"출석·패스 보상"})).toBeVisible();expect(calls).toHaveLength(0);
 await page.getByRole("button",{name:"2026-11-17",exact:true}).click();
 await expect(page.getByRole("button",{name:"수령 불가",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"패스 보상 받기",exact:true}).click();await expect(page.getByRole("status")).toContainText("20");expect(calls).toEqual([{kind:"pass",day:"2026-11-17"}]);
 await page.getByRole("button",{name:"2026-11-18 오늘",exact:true}).click();await page.getByRole("button",{name:"보상 받기",exact:true}).click();await expect(page.getByRole("status")).toContainText("5");
 await page.getByRole("button",{name:"2026-11-19",exact:true}).click();await expect(page.getByRole("button",{name:"아직 받을 수 없어요",exact:true})).toHaveCount(2);
 await page.getByRole("button",{name:"2026-11-18 오늘",exact:true}).click();
 const rewardRow=page.locator(".reward-claim-row").first();
 expect((await rewardRow.locator("strong").boundingBox())!.width).toBeGreaterThan(80);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:".verification/reward-calendar.png",fullPage:true});
});

test("purchased chapters appear in the bookshelf and resume independently",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const listingA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",listingB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
 const listings=[{id:listingA,kind:"chapter",title:"구매작 #1",chapter:1,novel:{id:jobId,title:"구매한 이야기",chapters:2}},{id:listingB,kind:"chapter",title:"구매작 #2",chapter:2,novel:{id:jobId,title:"구매한 이야기",chapters:2}}];
 await page.route("**/api/store**",route=>{const id=new URL(route.request().url()).searchParams.get("id");return route.fulfill({json:id?{content:{text:id===listingA?"구매한 첫 회차":"구매한 둘째 회차"}}:{listings,owned:[listingA,listingB]}});});
 await page.goto("/ideal/library");await page.getByRole("link",{name:/구매한 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 첫 회차");
 await page.getByRole("button",{name:"다음화 보기",exact:true}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 둘째 회차");
 await expect(page.getByRole("button",{name:/다음화 (보기|구매)/})).toHaveCount(0);
 await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"서고",exact:true}).click();await page.getByRole("link",{name:/구매한 이야기/}).click();await expect(page.locator(".novel-reader")).toContainText("구매한 둘째 회차");
});

test("reader confirms and opens the next purchased chapter", async ({ page }) => {
  await signIn(page);
  await accountRoutes(page);
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const novel = { id: novelId, title: "연재 작품", chapters: 2 };
  const listings = [first, second].map((id, index) => ({
    id, kind: "chapter", title: `연재 작품 #${index + 1}`, chapter: index + 1, active: true, novel,
  }));
  let attempts = 0;
  let purchased = false;
  await page.route("**/api/store**", route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ action: "buy", listingId: second });
      if (++attempts === 1) return route.fulfill({ status: 402, json: { error: "하트가 부족합니다." } });
      purchased = true;
      return route.fulfill({ json: { listing_id: second } });
    }
    const params = new URL(route.request().url()).searchParams;
    const id = params.get("id");
    if (id) {
      expect(id === first || purchased).toBe(true);
      return route.fulfill({ json: { content: { text: id === first ? "첫 회차 원고" : "둘째 회차 원고" } } });
    }
    expect(params.get("novel")).toBe(novelId);
    return route.fulfill({ json: { listings, owned: purchased ? [first, second] : [first] } });
  });
  await page.goto(`/ideal/library/${novelId}`);
  await expect(page.getByText("첫 회차 원고")).toBeVisible();
  const buy = page.getByRole("button", { name: "다음화 구매 · 10하트" });
  await expect(buy.locator("svg.lucide-heart")).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "다음화를 구매할까요?" });
  await buy.click();
  await expect(dialog).toContainText("연재 작품 #2");
  await expect(dialog).toContainText("10");
  await expect(dialog).not.toContainText("구매 수수료");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(buy).toBeEnabled();
  expect(attempts).toBe(0);
  await buy.click();
  await dialog.getByRole("button", { name: "구매하기" }).click();
  await expect(page.getByText("가 부족합니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("첫 회차 원고")).toBeVisible();
  await buy.click();
  await dialog.getByRole("button", { name: "구매하기" }).click();
  await expect(page.getByText("둘째 회차 원고")).toBeVisible();
  await expect(buy).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("support opens from 내 정보 and lets the author manage inquiries and staff reply", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const created = new Date().toISOString();
  const inquiry = { id: novelId, title: "", body: "", author_name: "테스트", created_at: created, isOwn: true, replies: [] as { id: string; body: string; created_at: string }[] };
  let exists = false, admin = false;
  await page.route("**/api/support**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { inquiries: exists ? [{ ...inquiry, isOwn: !admin }] : [], isAdmin: admin, hasMore: false } });
    const input = route.request().postDataJSON();
    if (input.action === "delete") exists = false;
    else if (input.action === "reply") inquiry.replies.push({ id: jobId, body: input.body, created_at: created });
    else { exists = true; inquiry.title = input.title; inquiry.body = input.body; }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/ideal/mypage");
  await expect(page.getByRole("heading", { name: "내 정보", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 새로고침" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "문의하기" })).toBeVisible();
  await page.getByRole("link", { name: "문의하기" }).click();
  await page.getByLabel("제목", { exact: true }).fill("서비스 문의");
  await page.getByLabel("문의 내용", { exact: true }).fill("읽던 페이지를 다시 찾는 방법이 있나요?");
  await page.getByRole("button", { name: "문의 등록" }).click();
  await expect(page.getByRole("heading", { name: "서비스 문의" })).toBeVisible();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("서고 페이지 문의");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByRole("heading", { name: "서고 페이지 문의" })).toBeVisible();
  await expect(page.getByRole("button", { name: "답글 쓰기" })).toHaveCount(0);
  admin = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "전체 문의 내역" })).toBeVisible();
  await expect(page.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "답글 쓰기" }).click();
  await page.getByLabel("답글 내용").fill("서고를 다시 열면 마지막 회차로 이동해요.");
  await page.getByRole("button", { name: "답글 등록" }).click();
  admin = false;
  await page.reload();
  await expect(page.getByText("서고를 다시 열면 마지막 회차로 이동해요.")).toBeVisible();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByText("등록된 문의가 없어요.")).toBeVisible();
});

test("settlement records consent, protects account details and lets the owner cancel", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page);
  await accountRoutes(page);
  const created = new Date().toISOString();
  const entry = { id: novelId, payout_on: "2099-01-10", hearts: 500, amount_won: 1000, bank: "테스트 은행", account_holder: "테스트 예금주", created_at: created };
  let requested = false, operator = false, cancelled = false;
  await page.route("**/api/settlements**", route => {
    if (route.request().method() === "POST") {
      if (route.request().postDataJSON().action === "cancel") {
        expect(operator).toBe(false);
        expect(route.request().postDataJSON()).toEqual({ action: "cancel", id: entry.id });
        cancelled = true;
        return route.fulfill({ json: { ok: true } });
      }
      expect(route.request().postDataJSON()).toEqual({
        id: expect.any(String), month: "2099-01", hearts: 500, bank: entry.bank, accountNumber: "0123-456789", accountHolder: entry.account_holder, consent: true,
      });
      requested = true;
      return route.fulfill({ json: { ok: true } });
    }
    const item = { ...entry, ...(operator && !cancelled ? { account_number: "0123456789", consented_at: created } : {}), canCancel: !operator && !cancelled, cancelled_at: cancelled ? created : undefined };
    return route.fulfill({ json: { requests: requested ? [item] : [], isAdmin: operator, hasMore: false } });
  });
  await page.goto("/ideal/mypage");
  const balance = page.getByRole("link", { name: "하트 스토어" });
  await expect(balance.locator("span").first()).toHaveText("1,000");
  await expect(balance.locator(".blue-heart")).toHaveText("5");
  await page.getByRole("link", { name: "정산 요청", exact: true }).click();
  await page.getByLabel("정산 월", { exact: true }).fill("2099-01");
  await page.getByRole("spinbutton").fill("500");
  await page.getByLabel("은행명", { exact: true }).fill(entry.bank);
  await page.getByLabel("계좌번호", { exact: true }).fill("0123-456789");
  await page.getByLabel("예금주", { exact: true }).fill(entry.account_holder);
  const submit = page.getByRole("button", { name: "정산 요청하기" });
  await expect(submit).toBeDisabled();
  await page.getByRole("checkbox").check();
  await submit.click();
  await page.getByRole("dialog").getByRole("button", { name: "정산 요청", exact: true }).click();
  await expect(page.getByText("정산 요청을 접수했습니다.")).toBeVisible();
  await page.locator(".settlement-details summary").click();
  await expect(page.getByText(entry.bank, { exact: true })).toBeVisible();
  await expect(page.getByText("0123456789")).toHaveCount(0);
  operator = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "전체 정산 요청" })).toBeVisible();
  await page.locator(".settlement-details summary").click();
  await expect(page.getByText("0123456789", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "정산 취소", exact: true })).toHaveCount(0);
  operator = false;
  await page.reload();
  await page.locator(".settlement-details summary").click();
  await page.getByRole("button", { name: "정산 취소", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "정산 취소", exact: true }).click();
  await expect(page.locator(".settlement-details summary")).toContainText("취소됨");
  await expect(page.getByRole("button", { name: "정산 취소", exact: true })).toHaveCount(0);
});

test("the operator records settlement completion and the customer can refresh to see it", async ({ page, context }) => {
  const customer = await context.newPage();
  const createdAt = "2026-11-10T00:00:00Z", paidAt = "2026-11-27T01:00:00Z";
  const entry = { id: novelId, payout_on: "2099-01-10", hearts: 500, amount_won: 1000, bank: "테스트 은행", account_holder: "테스트 예금주", created_at: createdAt };
  let completed = false;
  for (const [view, isAdmin] of [[page, true], [customer, false]] as const) {
    await signIn(view);
    await accountRoutes(view);
    await view.route("**/api/settlements**", route => {
      if (route.request().method() === "POST") {
        expect(isAdmin).toBe(true);
        expect(route.request().postDataJSON()).toEqual({ action: "complete", id: entry.id });
        completed = true;
        return route.fulfill({ json: { ok: true, completedAt: paidAt } });
      }
      return route.fulfill({ json: { isAdmin, hasMore: false, requests: [{ ...entry, canCancel: !isAdmin && !completed, completed_at: completed ? paidAt : null }] } });
    });
  }
  await customer.goto("/ideal/settlements");
  const customerSummary = customer.locator(".settlement-details summary");
  await customerSummary.click();
  await expect(customer.getByRole("button", { name: "정산 취소", exact: true })).toBeVisible();
  await expect(customer.getByRole("button", { name: "정산 완료 처리", exact: true })).toHaveCount(0);

  await page.goto("/ideal/settlements");
  const operatorSummary = page.locator(".settlement-details summary");
  await operatorSummary.click();
  await page.getByRole("button", { name: "정산 완료 처리", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "정산을 완료할까요?" });
  await expect(dialog).toContainText("1,000원");
  await dialog.getByRole("button", { name: "정산 완료 처리", exact: true }).click();
  await expect(operatorSummary).toContainText("정산 완료");
  await expect(page.getByRole("button", { name: "정산 완료 처리", exact: true })).toHaveCount(0);

  await customer.getByRole("button", { name: "내역 새로고침", exact: true }).click();
  await expect(customerSummary).toContainText("정산 완료");
  await expect(customer.getByText("정산 완료 일시", { exact: true })).toBeVisible();
  await expect(customer.locator(`time[datetime="${paidAt}"]`)).toBeVisible();
  await expect(customer.getByRole("button", { name: "정산 취소", exact: true })).toHaveCount(0);
});

test("notices sit above attendance and can only be posted from the operator view", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let admin = false;
  const initial = { id: novelId, title: "점검 안내", body: "다음 주에 점검이 진행됩니다.", created_at: new Date().toISOString() };
  const notices = [initial];
  await page.route("**/api/notices**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { notices, isAdmin: admin, hasMore: false } });
    expect(admin).toBe(true);
    notices.unshift({ ...initial, ...route.request().postDataJSON(), id: jobId });
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto("/ideal/mypage");
  await expect(page.locator('.native-reward-entry').first()).toHaveText("공지사항");
  await page.getByRole("link", { name: "공지사항", exact: true }).click();
  await page.getByText(initial.title, { exact: true }).click();
  await expect(page.getByText(initial.body)).toBeVisible();
  await expect(page.getByRole("button", { name: "공지 등록" })).toHaveCount(0);
  admin = true;
  await page.reload();
  await page.getByLabel("제목", { exact: true }).fill("서비스 공지");
  await page.getByLabel("공지 내용").fill("새 갤러리를 열 수 있어요.");
  await page.getByRole("button", { name: "공지 등록" }).click();
  await expect(page.getByText("서비스 공지", { exact: true })).toBeVisible();
});

test("purchased character galleries open separately from the bookshelf", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  await page.route("**/api/store**", route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("id") === characterId && params.get("gallery") === "1") return route.fulfill({ json: {
      kind: "character", title: "구매한 희진", imageUrl: "https://example.test/image.jpg",
      images: [{ id: jobId, title: "대화 이미지", url: "https://example.test/scene.jpg" }],
    } });
    return route.fulfill({ json: { listings: [{ id: characterId, kind: "character", title: "구매한 희진" }], owned: [characterId] } });
  });
  await page.goto("/ideal/library");
  await page.getByRole("link", { name: /구매한 희진.*갤러리/ }).click();
  await expect(page).toHaveURL(new RegExp(`/ideal/library/gallery/${characterId}$`));
  await expect(page.getByRole("group", { name: "캐릭터 갤러리" }).getByRole("button")).toHaveCount(2);
  await page.getByRole("button", { name: "이미지 1 전체화면" }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 이미지 전체화면" })).toBeVisible();
});

async function signIn(page: Page, rewardLandingChecked = true) {
  await page.addInitScript(({ userId, rewardLandingChecked }) => {
    const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, user: { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.com", app_metadata: {}, user_metadata: { full_name: "테스트" }, created_at: new Date().toISOString() } };
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    if (rewardLandingChecked) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      sessionStorage.setItem(`maite-reward-landing:${userId}`, today);
    }
  }, { userId, rewardLandingChecked });
}
async function accountRoutes(page: Page, complete = true, deleted: string[] = []) {
  const saved = structuredClone(snapshot);
  await page.route("**/api/store?saleDocument=**", route => route.fulfill({ json: { sale: null } }));
  if (!complete) { saved.story.storyState!.chapter = 3; saved.story.storyState!.nextChapterGoal = "다음 사건"; const partial = archive.slice(0, 6); saved.story.archive = partial; saved.story.storyState!.previousProse = partial.at(-1)!.content; }
  await page.route("**/api/account**", async route => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe("Bearer test-access-token");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "deleteCharacter") deleted.push(body.id);
      return route.fulfill({ json: { ok: true, claimed: 0 } });
    }
    if (url.searchParams.has("document")) return route.fulfill({ json: { id: url.searchParams.get("document"), title: "희진의 이야기", payload: saved, media: { original: "https://example.test/image.jpg", gallery: {} } } });
    if (url.searchParams.has("job")) return route.fulfill({ json: { imageUrl: "https://example.test/image.jpg" } });
    return route.fulfill({ json: { userId, email: "test@example.com", profile: { display_name: "테스트" }, wallet: { transferable: 1000, bonus: 5, free_chats: 5 }, documents: deleted.length ? [] : [
      { id: characterId, title: "희진", kind: "studio", character_name: "희진", chapter: String(saved.story.storyState!.chapter), novel_id: novelId },
      { id: novelId, title: "희진의 이야기", kind: "chapter", chapter: String(saved.story.storyState!.chapter), next_goal: complete ? "" : "다음 사건", series_ending: complete ? "final" : "continue" },
    ], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.route("https://example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128"/>' }));
  await page.route("**/api/notifications**",route=>route.fulfill({json:{pushEnabled:false,quietHours:true,available:true,activities:[],messages:[]}}));
}

test("character thumbnails reuse display URLs after six minutes and restore from disk before metadata", async ({page}) => {
 await signIn(page);await accountRoutes(page);
 let downloads=0,previewReads=0,hold=false,offline=false;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const bytes=await sharp({create:{width:72,height:128,channels:3,background:"#bca5df"}}).webp().toBuffer();
 await page.route("**/api/account",route=>route.fulfill({json:{userId,email:"test@example.com",profile:{display_name:"테스트"},wallet:{transferable:1000,bonus:5,free_chats:5},documents:[{id:characterId,title:"희진",kind:"studio",character_name:"희진",job_id:jobId}],jobs:[]}}));
 await page.route("**/api/account?previews=1",async route=>{
  previewReads++;if(offline)return route.abort();if(hold)await gate;
  return route.fulfill({json:{images:{[jobId]:`https://example.test/thumb.webp?token=${previewReads}`}}});
 });
 await page.route("https://example.test/thumb.webp**",route=>{downloads++;return offline?route.abort():route.fulfill({contentType:"image/webp",body:bytes});});
 try {
  await page.goto("/ideal/characters");
  const image=page.locator(".native-character-card img");
  await expect(image).toBeVisible();await expect(image).toHaveAttribute("aria-busy","false");
  await expect(image).toHaveCSS("object-position", "50% 0%");
  expect(await image.evaluate(img => img.clientWidth - img.clientHeight)).toBe(0);
  const source=await image.getAttribute("src");expect(source).toMatch(/^blob:/);expect(downloads).toBe(1);
  await expect.poll(()=>page.evaluate(async()=>{const cache=await caches.open("maite-private-images-v1");return(await cache.keys()).length;})).toBeGreaterThan(0);
  const footer=page.getByRole("navigation",{name:"하단 메뉴"});
  await footer.getByRole("link",{name:"내 정보",exact:true}).click();
  await page.clock.setFixedTime(new Date(Date.now()+6*60*1000));hold=true;
  await footer.getByRole("link",{name:"캐릭터",exact:true}).click();
  await expect(image).toBeVisible();await expect(image).toHaveAttribute("src",source!);
  await expect(image).toHaveAttribute("aria-busy","false");expect(downloads).toBe(1);
  release();hold=false;
  await expect(image).toHaveAttribute("src",source!);
  offline=true;await page.reload();
  await expect(image).toBeVisible();await expect(image).toHaveAttribute("aria-busy","false");
  await expect(image).toHaveJSProperty("naturalWidth",72);expect(downloads).toBe(1);
 }finally{release();}
});

test("character thumbnails find a lower anime face and reuse the crop after a reload", async ({ page }) => {
  await signIn(page);
  await accountRoutes(page);
  const portrait = await sharp("public/references/female-nurse-style.jpg").resize(216, 384, { fit: "fill" })
    .extract({ left: 0, top: 0, width: 216, height: 264 }).jpeg().toBuffer();
  const thumbnail = await sharp(portrait).extend({ top: 120, right: 0, left: 0, bottom: 0, background: "#777777" }).png().toBuffer();
  await page.route("**/api/account", route => route.fulfill({ json: {
    userId, email: "test@example.com", profile: { display_name: "테스트" }, wallet: { transferable: 100, bonus: 0, free_chats: 5 },
    documents: [{ id: characterId, title: "희진", kind: "studio", character_name: "희진", job_id: jobId }], jobs: [],
  } }));
  await page.route("**/api/account?previews=1", route => route.fulfill({ json: { images: { [jobId]: "https://example.test/low-face.png" } } }));
  await page.route("https://example.test/low-face.png", route => route.fulfill({ contentType: "image/png", body: thumbnail }));
  const workerUrls: string[] = [];
  page.on("worker", worker => workerUrls.push(worker.url()));
  await page.goto("/ideal/characters");
  const image = page.getByAltText("희진", { exact: true });
  await expect(image).toHaveCSS("object-position", /50% [6-8]\d%/);
  const workerCount = workerUrls.length;
  expect(workerCount).toBeGreaterThan(0);
  await page.reload();
  await expect(image).toHaveCSS("object-position", /50% [6-8]\d%/);
  expect(workerUrls.length).toBe(workerCount);
});

test("initial anonymous launch requires Google login before showing the creation screen", async ({ page }) => {
  await page.goto("/ideal");
  await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
  await expect(page.getByLabel("캐릭터 이름")).toHaveCount(0);
  await page.route("http://127.0.0.1:54321/auth/v1/authorize**", route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:3101/ideal");
    return route.fulfill({ contentType: "text/html", body: "Google 로그인 테스트" });
  });
  await page.getByRole("button", { name: "Google로 로그인", exact: true }).click();
  await expect(page).toHaveURL(/auth\/v1\/authorize/);
});

test("a restored login opens unclaimed rewards once per day, including after the date changes", async ({ page }) => {
  await signIn(page, false);
  await accountRoutes(page);
  await page.clock.setFixedTime(new Date("2026-11-27T01:00:00+09:00"));
  let today = "2026-11-27", calls = 0;
  await page.route("**/api/rewards?month=*", route => {
    calls++;
    return route.fulfill({ json: { today, month: "2026-11-01", claims: [], passes: [] } });
  });
  await page.goto("/ideal");
  const heading = page.getByRole("heading", { name: "출석·패스 보상" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "보상 받기", exact: true })).toBeEnabled();
  expect(calls).toBe(1);

  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서고" }).click();
  const shelf = page.getByRole("heading", { name: "서고", exact: true });
  await expect(shelf).toBeVisible();
  await page.reload();
  await expect(shelf).toBeVisible();
  expect(calls).toBe(1);

  today = "2026-11-28";
  await page.clock.setFixedTime(new Date("2026-11-28T01:00:00+09:00"));
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: `${today} 오늘` })).toHaveAttribute("aria-pressed", "true");
  expect(calls).toBe(2);
});

for (const scenario of [
  { name: "attendance is unclaimed", attendance: false, pass: false, passClaimed: false, expected: "/ideal/rewards" },
  { name: "today's active pass is unclaimed", attendance: true, pass: true, passClaimed: false, expected: "/ideal/rewards" },
  { name: "today's eligible rewards are already claimed", attendance: true, pass: true, passClaimed: true, expected: "/ideal" },
  { name: "only a past pass reward is unclaimed", attendance: true, pass: false, passClaimed: false, expected: "/ideal" },
  { name: "a new account has completed profile setup", attendance: false, pass: false, passClaimed: false, setup: true, expected: "/ideal/rewards" },
]) {
  test(`Google login opens the right first page when ${scenario.name}`, async ({ page }) => {
    await accountRoutes(page);
    if (scenario.setup) {
      let onboarded = false;
      await page.route("**/api/account", route => {
        if (route.request().method() === "POST") {
          expect(route.request().postDataJSON().action).toBe("profile");
          onboarded = true;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { userId, profile: { display_name: "", onboarded }, wallet: { transferable: 0, bonus: 100, free_chats: 5 }, documents: [], jobs: [] } });
      });
    }
    await page.route("http://127.0.0.1:54321/auth/v1/authorize**", route => route.fulfill({
      status: 302, headers: { Location: "http://127.0.0.1:3101/ideal?code=test-login" },
    }));
    await page.route("http://127.0.0.1:54321/auth/v1/token**", route => route.fulfill({ json: {
      access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 86400,
      user: { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    } }));
    const today = koreaDay();
    const month = today.slice(0, 7) + "-01";
    let requests = 0;
    await page.route("**/api/rewards**", route => {
      expect(route.request().method()).toBe("GET");
      requests++;
      return route.fulfill({ json: {
        today, month,
        claims: [
          ...(scenario.attendance ? [{ day: today, kind: "attendance", amount: 5 }] : []),
          ...(scenario.passClaimed ? [{ day: today, kind: "pass", amount: 20 }] : []),
        ],
        passes: [{ starts_on: "2020-01-01", ends_on: scenario.pass ? "2099-01-01" : today, daily_hearts: 20 }],
      } });
    });
    await page.goto("/ideal");
    await page.getByRole("button", { name: "Google로 로그인", exact: true }).click();
    if (scenario.setup) {
      const nickname = page.getByLabel("사용자 닉네임", { exact: true });
      await nickname.fill("새로운 별빛");
      expect(requests).toBe(0);
      await page.getByRole("button", { name: "시작하기", exact: true }).click();
    }
    if (scenario.expected === "/ideal/rewards") {
      await expect(page.getByRole("heading", { name: "출석·패스 보상" })).toBeVisible();
      await expect(page.getByRole("button", { name: scenario.pass ? "패스 보상 받기" : "보상 받기", exact: true })).toBeEnabled();
    } else {
      await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeVisible();
    }
    expect(new URL(page.url()).pathname).toBe(scenario.expected);
    expect(requests).toBe(1);
    await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서고" }).click();
    await expect(page.getByRole("heading", { name: "서고", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "서고", exact: true })).toBeVisible();
    expect(requests).toBe(1);
  });
}

test("bookshop character and novel cards show their main character covers",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const characterListing="77777777-7777-4777-8777-777777777777",novelListing="88888888-8888-4888-8888-888888888888";
 await page.route("**/api/store",route=>route.fulfill({json:{owned:[],listings:[
  {id:characterListing,seller_id:jobId,kind:"character",title:"서하",description:"새 친구",active:true,thumbnailUrl:"https://example.test/character-cover.webp"},
  {id:novelListing,seller_id:jobId,kind:"chapter",title:"약속 #1",description:"완결",active:true,chapter:1,novel:{id:novelId,title:"마지막 약속",chapters:5},thumbnailUrl:"https://example.test/novel-cover.webp"},
 ]}}));
  await page.goto("/ideal/bookshop");await expect(page.getByAltText("서하 캐릭터 이미지")).toBeVisible();await expect(page.getByRole("button",{name:"신고",exact:true})).toHaveCount(0);
  await page.getByRole("tab",{name:"소설",exact:true}).click();await expect(page.getByAltText("마지막 약속 표지")).toBeVisible();await expect(page.getByRole("button",{name:"신고",exact:true})).toHaveCount(0);
 await page.screenshot({path:".verification/bookshop-main-covers.png"});
});

test("login warms character thumbnails into the shared cache without downloading the original",async({page})=>{
 await signIn(page);await accountRoutes(page);let thumbnails=0,originals=0;
 await page.route("**/api/account",route=>route.fulfill({json:{userId,email:"test@example.com",profile:{display_name:"테스트"},wallet:{transferable:1000,bonus:5,free_chats:5},documents:[{id:characterId,title:"희진",kind:"studio",character_name:"희진",job_id:jobId}],jobs:[]}}));
 await page.route("**/api/account?previews=1",route=>route.fulfill({json:{images:{[jobId]:"https://example.test/warm-thumb.webp"}}}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route("https://example.test/warm-thumb.webp",async route=>{thumbnails++;await gate;await route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128"/>'});});
 page.on("request",request=>{if(request.url().includes("original.jpg"))originals++;});
 try{
  await page.goto("/ideal/characters");await expect(page.getByRole("status")).toContainText("캐릭터 이미지를 준비");
  await expect.poll(()=>thumbnails).toBe(1);release();await expect(page.getByRole("heading",{name:"나의 캐릭터",exact:true})).toBeVisible();
  await expect(page.getByAltText("희진",{exact:true})).toBeVisible();expect(thumbnails).toBe(1);expect(originals).toBe(0);
 }finally{release();}
});

test("each character retains their saved register through switching and a full page reload",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const otherId="99999999-9999-4999-8999-999999999999";
 const first=structuredClone(snapshot),second=structuredClone(snapshot);first.chat.speechStyle="casual";second.id=otherId;second.art.profile.name="민수";second.art.title="민수";second.chat.speechStyle="polite";
 const documents=new Map([[characterId,first],[otherId,second]]);
 await page.route("**/api/account**",route=>{
  const url=new URL(route.request().url()),id=url.searchParams.get("document");
  if(route.request().method()==="POST"){
   const body=route.request().postDataJSON();if(body.action==="save"&&body.kind==="studio")documents.set(body.id,body.payload);
   return route.fulfill({json:{ok:true}});
  }
  if(id)return route.fulfill({json:{id,title:documents.get(id)!.art.title,payload:documents.get(id),media:{original:"https://example.test/image.jpg",gallery:{}}}});
  if(url.search)return route.fallback();
  return route.fulfill({json:{userId,email:"test@example.com",profile:{display_name:"테스트",age:30},wallet:{transferable:1000,bonus:0,free_chats:0},documents:[...documents.values()].map(saved=>({id:saved.id,title:saved.art.title,kind:"studio",character_name:saved.art.profile.name})),jobs:[]}});
 });
 const bodies:any[]=[];await page.route("**/api/chat",route=>{const body=route.request().postDataJSON();bodies.push(body);const speechStyle=body.speechStyle;return route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"delta",text:speechStyle==="casual"?"다시 만나서 좋아!":"다시 만나서 좋아요!"})}\n\ndata: ${JSON.stringify({type:"speech",speechStyle})}\n\ndata: {"type":"done"}\n\n`});});
 const open=async(id:string)=>{await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"캐릭터",exact:true}).click();await page.locator(`a[href="/ideal/characters/${id}"]`).click();await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();};
 const send=async()=>{await page.getByLabel("AI에게 보낼 메시지").fill("오랜만이야");await page.getByRole("button",{name:"AI 메시지 보내기"}).click();await expect(page.getByLabel("AI에게 보낼 메시지")).toBeEnabled();};
 await page.goto("/ideal/characters");await open(characterId);await send();await open(otherId);await send();await open(characterId);await send();
 expect(bodies.map(body=>body.speechStyle)).toEqual(["casual","polite","casual"]);
 await expect.poll(()=>documents.get(characterId)!.chat.archive?.length).toBe(4);
 await page.reload();await open(characterId);await send();expect(bodies.at(-1).speechStyle).toBe("casual");
});

test("character deletion requires confirmation and removes the private library entry", async ({ page }) => {
  const deleted: string[] = [];
  await signIn(page); await accountRoutes(page, true, deleted);
  await page.goto(`/ideal/characters/${characterId}`);
  const remove = page.getByRole("button", { name: "캐릭터 삭제", exact: true });
  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("기존 구매자의 작품");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(deleted).toEqual([]);
  await remove.click();
  await dialog.getByRole("button", { name: "캐릭터 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/ideal\/characters$/);
  await expect(page.locator(".native-character-card")).toHaveCount(0);
  expect(deleted).toEqual([characterId]);
});

test("signed-in launch shows creation, footer navigation, account details and character publication", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const published: unknown[] = [];
  await page.route("**/api/store", route => { published.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.goto("/ideal");
  await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "서고", "서점", "스토어", "내 정보"]);
  await footer.getByRole("link", { name: "내 정보", exact: true }).click();
  await expect(page.getByText("test@example.com", { exact: true })).toBeVisible();await expect(page.locator(".native-settings-list dt").filter({hasText:/^나이$/})).toHaveCount(0);
  await expect(page.locator(".heart-total")).toContainText("1,005");
  await page.screenshot({ path: ".verification/account-mypage.png", fullPage: true });
  await footer.getByRole("link", { name: "캐릭터", exact: true }).click();
  await page.locator(".native-character-card").filter({ hasText: "희진" }).click();
  await expect(page.locator(".character-detail")).toBeVisible();
  const detailImage = page.locator(".character-detail > img");
  await expect(detailImage).toBeVisible();
  const detailSize = await detailImage.boundingBox();
  expect(detailSize!.width / detailSize!.height).toBeCloseTo(9 / 16, 2);
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "판매 등록", exact: true }).click();
  await expect(page.getByText("서점에 판매 등록했습니다.", { exact: true })).toBeVisible();
  expect(published).toEqual([{ action: "publishCharacter", documentId: characterId, title: "희진", description: "서점에서 시작된 이야기" }]);
});

test("complete novel detail reads individual chapters and publishes a chosen work title", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let published: unknown;
  await page.route("**/api/store", route => { published = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto(`/ideal/novels/${novelId}`);
  await expect(page.locator(".novel-reader")).toBeVisible();
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await page.locator(".novel-reader").dispatchEvent("touchstart", { touches: [{ identifier: 0, clientX: 220, clientY: 300 }] });
  await page.locator(".novel-reader").dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 0, clientX: 100, clientY: 310 }] });
  await expect(page.locator(".novel-reader")).toContainText("3번째 회차의 원고입니다.");
  await expect(page.locator(".novel-reader")).not.toContainText("비공개 지시");
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  const sale=page.getByRole("dialog",{name:"소설 판매 등록",exact:true});await expect(sale).toBeVisible();
  const centered = await sale.evaluate(dialog => {
    const { left, right } = dialog.getBoundingClientRect();
    return Math.abs(left - (document.documentElement.clientWidth - right));
  });
  expect(centered).toBeLessThan(2);
  await page.getByLabel("소설 제목", { exact: true }).fill("서점에서의 마지막 약속");
  await sale.getByRole("button", { name: "판매 등록하기", exact: true }).click();
  await expect(page.getByText("서점에 판매 등록했습니다.", { exact: true })).toBeVisible();
  expect(published).toEqual({ action: "publishNovel", documentId: novelId, title: "서점에서의 마지막 약속", description: "서점에서 시작된 이야기" });
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeInViewport();
  await page.screenshot({ path: ".verification/account-novel-detail.png", fullPage: true });
});

test("novel text scrolls inside a bounded background while side arrows and sale toolbar remain visible",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.archive![1].content="소설의 긴 문단을 읽습니다.\n\n".repeat(180);saved.story.committed=saved.story.archive!;
 await page.route(`**/api/account?document=${novelId}`,route=>route.fulfill({json:{id:novelId,title:"긴 소설",payload:saved}}));
 await page.setViewportSize({width:390,height:844});await page.goto(`/ideal/novels/${novelId}`);
 const reader=page.locator(".saved-novel-reader"),scroll=page.getByLabel("소설 본문",{exact:true});
 await expect(reader).toBeVisible();await expect(page.locator(".saved-novel-background")).toBeVisible();
 const box=(await reader.boundingBox())!,next=page.getByRole("button",{name:"다음 이야기 보기",exact:true});
 const arrow=(await next.boundingBox())!;expect(Math.abs(arrow.y+arrow.height/2-box.y-box.height/2)).toBeLessThan(3);
 expect(box.height).toBeLessThan(720);expect(box.height).toBeGreaterThan(350);
 await scroll.evaluate(element=>element.scrollTop=600);expect(await scroll.evaluate(element=>element.scrollTop)).toBeGreaterThan(400);
 const after=(await next.boundingBox())!;expect(Math.abs(after.y-arrow.y)).toBeLessThan(1);
 const back=(await page.getByRole("link",{name:"서고",exact:true}).first().boundingBox())!,sale=(await page.getByRole("button",{name:"서점에 판매 등록",exact:true}).boundingBox())!;
 expect(Math.abs(back.y-sale.y)).toBeLessThan(3);await expect(next).toBeInViewport();
 await next.click();expect(await page.getByLabel("소설 본문",{exact:true}).evaluate(element=>element.scrollTop)).toBe(0);
 await expect(page.locator(".novel-reader")).toContainText("2번째 회차");
 await page.screenshot({path:".verification/novel-reader-centered.png"});
});

test("scene keywords appear in image confirmation dialogs rather than generation buttons",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);
 saved.chat.committed=[{role:"user",content:"여기 떡볶이집이야."},{role:"assistant",content:"응 들어가자."}];saved.chat.archive=saved.chat.committed;
 saved.chat.visualDetected=true;saved.chat.latestVisualChange=true;saved.chat.visualScene={location:"떡볶이집",outfit:"흰 셔츠",turn:1};
 saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;saved.story.archive![1].content="희진은 이곳에 없었다. 햄군은 민수와 카페에서 마주 앉았다. 민수는 검은 코트를 입었다.";saved.story.storyState!.characters.push({name:"민수",goal:"대화",knowledge:[],relationships:[]});
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let images=0;await page.route("**/api/characters",route=>{images++;return route.abort();});
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
 const button=page.getByRole("button",{name:"이미지 생성",exact:true});await expect(button.locator("small")).toHaveCount(0);await button.click();
 const popup=page.getByRole("dialog");await expect(popup.locator(".scene-details-list dt")).toHaveText(["장소","의상","등장인물"]);await expect(popup.getByLabel("장면 장소")).toHaveValue("떡볶이집");await expect(popup.getByLabel("장면 의상")).toHaveValue("흰 셔츠");await expect(popup.locator(".scene-details-list dd").last()).toHaveText("희진 (이미지 대상)");await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
 await page.getByRole("button",{name:"캐릭터 이미지로 돌아가기",exact:true}).click();await expect(page).toHaveURL(/\/ideal\/new$/);
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();
 const illustration=page.getByRole("button",{name:"삽화 생성",exact:true});await expect(illustration.locator("small")).toHaveCount(0);await illustration.click();
 await expect(popup.getByLabel("장면 장소")).toHaveValue("카페");await expect(popup.getByLabel("장면 의상")).toHaveValue("검은 코트");await expect(popup.locator(".scene-details-list dd").last()).toHaveText("민수 (이미지 대상)");await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
});

test("chat images can be requested before the first dialogue with user-selected location and outfit",async({page})=>{
 await signIn(page);await accountRoutes(page);
 let chats=0,images=0,selection:any;
 await page.route("**/api/chat",route=>{chats++;return route.abort();});
 await page.route("**/api/characters",async route=>{
  images++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();selection=JSON.parse(String(form.get("scene"))).selection;
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
 const button=page.getByRole("button",{name:"이미지 생성",exact:true});await expect(button).toBeEnabled();await button.click();
 const popup=page.getByRole("dialog");await popup.getByLabel("장면 장소").fill("해변 산책로");await popup.getByLabel("장면 의상").fill("흰 원피스");expect(images).toBe(0);
 await popup.getByRole("button",{name:"그림 만들기",exact:true}).click();await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");
 expect(selection).toMatchObject({confirmed:true,location:"해변 산책로",outfit:"흰 원피스",target:"희진"});expect(images).toBe(1);expect(chats).toBe(0);await expect(button).toBeEnabled();
});

test("a novel illustration can focus a manually entered counterpart while the original character is present",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;
 saved.story.archive![1].content="희진은 흰 드레스를 입고 왕궁 연회장에 들어갔다. 민수는 검은 갑옷을 입고 왕 앞에 무릎을 꿇었다.";
 saved.story.storyState!.characters.push({name:"민수",goal:"왕에게 보고",knowledge:[],relationships:[]});
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let images=0,scene:any;
 await page.route("**/api/characters",async route=>{
  images++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();scene=JSON.parse(String(form.get("scene")));
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();
 await page.getByRole("button",{name:"삽화 생성",exact:true}).click();const popup=page.getByRole("dialog");
 await expect(popup.getByLabel("삽화 대상 인물")).toHaveValue("희진");
 await popup.getByRole("button",{name:"취소",exact:true}).click();expect(images).toBe(0);
 await page.getByRole("button",{name:"삽화 생성",exact:true}).click();
 await popup.getByLabel("삽화 대상 인물").fill("민수");await expect(popup.getByLabel("장면 의상")).toHaveValue("");
 await expect(popup.getByRole("button",{name:"그림 만들기",exact:true})).toBeDisabled();
 await popup.getByLabel("장면 장소").fill("왕궁 연회장");await popup.getByLabel("장면 의상").fill("검은 갑옷");
 await popup.getByRole("button",{name:"그림 만들기",exact:true}).click();await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");
 expect(images).toBe(1);expect(scene.selection).toMatchObject({target:"민수",targetConfirmed:true,confirmed:true,location:"왕궁 연회장",outfit:"검은 갑옷"});
 expect(scene.selection.characters).toContain("민수");expect(scene.context).toContain("희진");
});

test("missing illustration details require concrete confirmation and use the edited scene",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const saved=structuredClone(snapshot);saved.story.started=true;saved.story.storyPage=0;saved.story.committed=saved.story.archive!;saved.story.archive![1].content="희진은 조용히 눈을 떴다.";
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 let selection:any;let calls=0;
 await page.route("**/api/characters",async route=>{
  calls++;const form=await new Request(route.request().url(),{method:"POST",headers:route.request().headers(),body:new Uint8Array(route.request().postDataBuffer()!)}).formData();selection=JSON.parse(String(form.get("scene"))).selection;
  return route.fulfill({status:503,json:{error:"검증용 생성 중단"}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작"}).click();
 await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"이야기 만들기",exact:true}).click();await page.getByRole("button",{name:"삽화 생성",exact:true}).click();
 const popup=page.getByRole("dialog"),generate=popup.getByRole("button",{name:"그림 만들기",exact:true});
 await expect(generate).toBeDisabled();await expect(popup.getByText("현재 장면에서 확인",{exact:true})).toHaveCount(0);await expect(popup.getByText("대상 인물의 장면 속 의상",{exact:true})).toHaveCount(0);expect(calls).toBe(0);
 await popup.getByLabel("장면 장소").fill("왕궁 연회장");await expect(generate).toBeDisabled();await popup.getByLabel("장면 의상").fill("붉은 비단 예복");await expect(generate).toBeEnabled();
 await expect(popup.getByText("부적절한 내용은 AI가 정상적으로 생성하지 않습니다.",{exact:true})).toBeVisible();await generate.click();
 await expect(page.locator(".character-visual-error")).toContainText("검증용 생성 중단");expect(selection).toMatchObject({location:"왕궁 연회장",outfit:"붉은 비단 예복",target:"희진",confirmed:true});expect(calls).toBe(1);
});

test("new illustrations retain the requested chapter when the reader moves before completion", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved = structuredClone(snapshot); saved.story.started = true; saved.story.storyPage = 0; saved.story.committed = archive;
  let persisted: any; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/account?document=${characterId}*`, route => route.fulfill({ json: { id: characterId, title: "희진", payload: saved, media: { original: "https://example.test/image.jpg", gallery: {} } } }));
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action === "save") persisted = body.payload;
    return route.fulfill({ json: { ok: true } });
  });
  const image = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#bda4dd" } }).jpeg().toBuffer();
  await page.route("**/api/characters", async route => { await gate; await route.fulfill({ contentType: "image/jpeg", headers: { "X-Job-Id": jobId }, body: image }); });
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    await page.getByRole("button", { name: "이 캐릭터로 대화·이야기 시작" }).click();
    await page.getByRole("group", { name: "캐릭터와 함께하기" }).getByRole("button", { name: "이야기 만들기", exact: true }).click();
    await expect(page.locator(".story-page>span")).toHaveText("이야기 #1");
    await page.getByRole("button", { name: "삽화 생성", exact: true }).click();
    await page.getByRole("dialog").getByLabel("장면 장소").fill("왕궁 연회장");
    await page.getByRole("dialog").getByRole("button", { name: "그림 만들기", exact: true }).click();
    await expect(page.getByRole("button", { name: "삽화 생성", exact: true })).toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
    await expect(page.locator(".story-page>span")).toHaveText("이야기 #2"); release();
    await expect.poll(() => persisted?.gallery?.find((image: any) => image.kind === "illustration")?.scene).toEqual({ novelId, chapter: 1 });
    await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"전체화면 닫기",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"캐릭터 이미지 전체화면",exact:true})).not.toBeVisible();
    const parsed = snapshotSchema.parse(persisted);
    expect(parsed.gallery.find(image => image.kind === "illustration")?.scene).toEqual({ novelId, chapter: 1 });
  } finally { release(); }
});

test("novel detail carries the nearest previous illustration forward and never uses a future scene", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const illustrationJob="55555555-5555-4555-8555-555555555555";
  const thirdJob="66666666-6666-4666-8666-666666666666";
  const requestedJobs:string[]=[];
  await page.route("**/api/account?job=*",route=>{requestedJobs.push(new URL(route.request().url()).searchParams.get("job")!);return route.fulfill({json:{imageUrl:"https://example.test/image.jpg"}});});
  const saved = snapshotSchema.parse({ ...snapshot, gallery: [
    { id: "legacy", title: "기존 삽화", kind: "illustration", jobId },
    { id: "chapter-two", title: "2회차 삽화", kind: "illustration", jobId:illustrationJob, scene: { novelId, chapter: 2 } },
    { id: "chapter-three", title: "3회차 삽화", kind: "illustration", jobId:thirdJob, scene: { novelId, chapter: 3 } },
    { id: "other-novel", title: "다른 소설", kind: "illustration", jobId, scene: { novelId: characterId, chapter: 2 } },
  ] });
  await page.route(`**/api/account?document=${novelId}`, route => route.fulfill({ json: { id: novelId, title: "테스트 소설", payload: saved } }));
  await page.goto(`/ideal/novels/${novelId}`);
  const background = page.locator(".saved-novel-background");
  await expect(background).toBeVisible(); await expect(background).toHaveCSS("opacity", "0.18");
  expect(requestedJobs).toEqual([jobId]);
  await expect(page.locator(".novel-reader")).toContainText("1번째 회차의 원고");
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await expect.poll(()=>requestedJobs).toEqual([jobId,illustrationJob]);
  await expect(background).toBeVisible();await expect(background).toHaveCSS("opacity","0.18");
  await expect(page.locator(".novel-reader")).toContainText("2번째 회차의 원고");
  await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
  await expect.poll(()=>requestedJobs).toEqual([jobId,illustrationJob,thirdJob]);
  await expect(background).toBeVisible();const thirdSource=await background.getAttribute("src");
  for(const chapter of [4,5]){
   await page.getByRole("button", { name: "다음 이야기 보기", exact: true }).click();
   await expect(page.locator(".novel-reader")).toContainText(`${chapter}번째 회차의 원고`);
   await expect(background).toHaveAttribute("src",thirdSource!);
  }
  expect(requestedJobs).toEqual([jobId,illustrationJob,thirdJob]);
  await page.getByRole("button", { name: "이전 이야기 보기", exact: true }).click();
  await expect(background).toBeVisible();
});

test("an ongoing novel can publish its generated chapters", async ({ page }) => {
  await signIn(page); await accountRoutes(page, false);
  let published:any;await page.route("**/api/store",route=>{published=route.request().postDataJSON();return route.fulfill({json:{ok:true}});});
  await page.goto(`/ideal/novels/${novelId}`);
  await page.getByRole("button", { name: "서점에 판매 등록", exact: true }).click();
  const dialog=page.getByRole("dialog",{name:"소설 판매 등록"});await expect(dialog).toContainText("연재 중인 소설도 판매");
  await dialog.getByRole("button",{name:"판매 등록하기"}).click();await expect(page.getByText("서점에 판매 등록했습니다.",{exact:true})).toBeVisible();
  expect(published.action).toBe("publishNovel");
});

test("character and novel sales use a square cover chosen from the gallery", async ({page}) => {
  await signIn(page); await accountRoutes(page);
  const coverJobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const payload = {...snapshot, gallery: [{id:"sale-cover",title:"창가 삽화",kind:"illustration",jobId:coverJobId}]};
  await page.route("**/api/account?document=*", route => route.fulfill({json:{title:"창가 이야기",payload,media:{original:"https://example.test/original.jpg",thumbnails:{[coverJobId]:"https://example.test/cover.webp"}}}}));
  const published: {action:string; coverJobId:string}[] = [];
  await page.route("**/api/store", route => { published.push(route.request().postDataJSON()); return route.fulfill({json:{ok:true}}); });
  for (const [path, action] of [[`characters/${characterId}`,"publishCharacter"],[`novels/${novelId}`,"publishNovel"]]) {
    await page.goto(`/ideal/${path}`);
    if (action === "publishNovel") await page.getByRole("button",{name:"서점에 판매 등록",exact:true}).click();
    await page.getByRole("button",{name:"갤러리에서 표지 선택"}).click();
    const choice = page.getByRole("button",{name:"표지 선택 창가 삽화"});
    await expect(choice).toBeVisible();
    await choice.click();
    const preview = page.locator(".sale-cover-preview");
    expect(await preview.evaluate(el => el.clientWidth - el.clientHeight)).toBe(0);
    await expect(page.locator(".sale-byline")).toContainText("작가 테스트");
    if (action === "publishCharacter") {
      await expect(page.locator(".sale-byline")).toContainText("희진 · 25세");
      await page.getByRole("button",{name:"서점에 판매 등록",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:"판매 등록",exact:true}).click();
    } else await page.getByRole("button",{name:"판매 등록하기",exact:true}).click();
    await expect(page.getByText("서점에 판매 등록했습니다.",{exact:true})).toBeVisible();
    expect(published.at(-1)).toMatchObject({action,coverJobId});
  }
});

test("the bookshop hides owned sales, and private details can pause or resume them", async ({page}) => {
  await signIn(page); await accountRoutes(page);
  const character = {id:characterId, seller_id:novelId, kind:"character", title:"새로운 동료", description:"조용한 서점의 주인", characterName:"희진", characterAge:25, authorNickname:"테스트", active:true, purchaseCount:10, created_at:new Date().toISOString()};
  const ownCharacter = {...character,id:jobId,seller_id:userId,characterName:"내 판매 캐릭터"};
  const others = Array.from({length:16}, (_, index) => ({...character,id:`character-${index}`,characterName:`친구 ${index + 1}`,purchaseCount:0,created_at:"2020-01-01"}));
  const chapters = [1,2].map(chapter => ({id:`chapter-${chapter}`, seller_id:characterId, kind:"chapter", title:`창가 이야기 #${chapter}`, description:"", authorNickname:"햄군", active:true, chapter, purchaseCount:5, created_at:character.created_at, novel:{id:novelId,title:"창가 이야기",chapters:2}}));
  const ownNovel = {...chapters[0],id:"own-chapter",seller_id:userId,novel:{id:jobId,title:"내 판매 소설",chapters:1}};
  const actions: {listingId:string;active:boolean}[] = [];
  await page.route("**/api/store?saleDocument=**", route => {
    const novel = new URL(route.request().url()).searchParams.get("kind") === "novel";
    const listing = novel ? ownNovel : ownCharacter;
    return route.fulfill({json:{sale:{listingId:listing.id,active:listing.active,count:novel ? 4 : 1}}});
  });
  await page.route("**/api/store", route => {
    if (route.request().method() === "POST") {
      const request=route.request().postDataJSON();
      expect(request.action).toBe("setSaleStatus"); actions.push(request);
      (request.listingId === ownCharacter.id ? ownCharacter : ownNovel).active=request.active;
      return route.fulfill({json:{ok:true}});
    }
    return route.fulfill({json:{listings:[ownCharacter,ownNovel,character,...others,...chapters],owned:[]}});
  });
  await page.goto("/ideal/bookshop");
  const grid = page.locator(".bookshop-character-grid");
  const tile = grid.getByRole("button",{name:/희진/});
  await expect(grid.getByText("내 판매 캐릭터")).toHaveCount(0);
  await expect(tile.getByText("Hot")).toBeVisible();
  await expect(tile.getByText("New")).toBeVisible();
  const layout = await grid.evaluate(element => {
    const cover = element.querySelector(".store-cover")!.getBoundingClientRect();
    const bottom = element.getBoundingClientRect().bottom;
    return { columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      difference: Math.abs(cover.width - cover.height), scrolls: element.scrollHeight > element.clientHeight,
      fullTiles: Array.from(element.children).filter(tile => tile.getBoundingClientRect().bottom <= bottom + 1).length };
  });
  expect(layout).toEqual({columns:3,difference:0,scrolls:true,fullTiles:15});
  await expect(grid.getByRole("button",{name:"친구 16",exact:true})).not.toBeInViewport();
  await grid.evaluate(element => {element.scrollTop = element.scrollHeight;});
  await expect(grid.getByRole("button",{name:"친구 16",exact:true})).toBeInViewport();
  await grid.evaluate(element => {element.scrollTop = 0;});
  await tile.click();
  await expect(page.getByRole("dialog",{name:"희진",exact:true})).toBeVisible();
  await expect(page.getByText("25세 · 작가 테스트")).toBeVisible();
  await expect(page.getByText(character.description)).toBeVisible();
  await page.getByRole("button",{name:"캐릭터 상세 닫기",exact:true}).click();
  await page.getByRole("tab",{name:"소설"}).click();
  await expect(page.getByText("내 판매 소설",{exact:true})).toHaveCount(0);
  const byline = page.locator(".store-novel-group .store-byline");
  await expect(byline).toContainText("작가 햄군 ·");
  const count = byline.locator(".bookshop-chapter-count");
  await expect(count.getByText("2편",{exact:true})).toBeVisible();
  await expect(count.getByText("Hot",{exact:true})).toBeVisible();
  await expect(count.getByText("New",{exact:true})).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  for (const [path, listingId] of [[`/ideal/characters/${characterId}`,ownCharacter.id], [`/ideal/novels/${novelId}`,ownNovel.id]]) {
    await page.goto(path);
    if (listingId === ownNovel.id) await expect(page.getByRole("button", {name:"서점에 판매 등록"})).toHaveText("새 회차 등록");
    const toggle=page.getByRole("switch",{name:"판매 상태"});
    await expect(toggle).toBeChecked(); await toggle.click(); await expect(toggle).not.toBeChecked();
    await toggle.click(); await expect(toggle).toBeChecked();
    expect(actions.slice(-2)).toMatchObject([{listingId,active:false},{listingId,active:true}]);
  }
});

test("logging out hides private library data and returns to the login screen", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  await page.route("http://127.0.0.1:54321/auth/v1/logout**", route => route.fulfill({ status: 204 }));
  await page.goto(`/ideal/characters/${characterId}`);
  const image=page.locator(".character-detail img");await expect(image).toBeVisible();
  const privateUrl=await image.getAttribute("src");expect(privateUrl).toMatch(/^blob:/);
  await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"내 정보",exact:true}).click();
  await expect(page.getByText("test@example.com", { exact: true })).toBeVisible();
  await page.evaluate(async () => { const cache = await caches.open("maite-private-images-v1"); await cache.put("/logout-cache-check", new Response("private")); });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
  await expect(page.getByText("test@example.com", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => caches.has("maite-private-images-v1"))).toBe(false);
  expect(await page.evaluate(async url=>{try{await fetch(url!);return false;}catch{return true;}},privateUrl)).toBe(true);
});

test("store groups a complete work, charges per chapter, and opens purchased prose", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page); await accountRoutes(page);
  const listingId = "55555555-5555-4555-8555-555555555555";
  const firstListing = "66666666-6666-4666-8666-666666666666";
  const illustration = "77777777-7777-4777-8777-777777777777";
  const novel = { id: novelId, title: "마지막 약속", chapters: 5 };
  const images = [
    { id: illustration, jobId: illustration, kind: "illustration", title: "두 번째 회차 삽화", scene: { novelId, chapter: 2 }, url: "https://example.test/illustration.jpg" },
    { id: jobId, jobId, kind: "illustration", title: "연결이 해제된 삽화", url: "https://example.test/detached.jpg" },
  ];
  let purchased = false;
  await page.route("**/api/store**", route => {
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); expect(body.action).toBe("buy"); expect(body.listingId).toBe(listingId); purchased = true; return route.fulfill({ json: { ok: true } }); }
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id === listingId) return route.fulfill({ json: {
      kind: "chapter", title: novel.title, novelId, content: { text: "구매한 두 번째 회차 원고" },
      images, imageUrl: "https://example.test/image.jpg",
    } });
    if (id === firstListing) return route.fulfill({ json: { kind: "chapter", content: { text: "구매한 첫 회차 원고" }, images, imageUrl: "https://example.test/image.jpg" } });
    const listings = [firstListing, listingId].map((id, index) => ({ id, seller_id: characterId, kind: "chapter", title: `마지막 약속 #${index + 1}`, description: "완결 소설", active: true, chapter: index + 1, novel }));
    return route.fulfill({ json: { listings, owned: purchased ? [firstListing, listingId] : [firstListing] } });
  });
  await page.goto("/ideal");
  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("link", { name: "서점", exact: true }).click();
  await page.getByRole("tab", { name: "소설", exact: true }).click();
  await page.getByRole("button",{name:/마지막 약속.*5편/}).click();
  const purchase = page.getByRole("button", { name: "10하트 구매", exact: true });
  await expect(purchase.locator("svg.lucide-heart")).toBeVisible();
  await expect(purchase).not.toContainText("하트");
  const row = page.getByRole("article").filter({ hasText: "마지막 약속 #2" });
  const layout = await row.evaluate(element => {
    const button = element.querySelector("button")!.getBoundingClientRect();
    const title = element.querySelector("h3")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return title.width > 80 && title.right <= button.left && button.right <= bounds.right + 1 &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
  expect(layout).toBe(true);
  await purchase.click();
  await page.getByRole("dialog").getByRole("button", { name: "구매하기", exact: true }).click();
  await page.getByRole("article").filter({ hasText: "마지막 약속 #2" }).getByRole("link", { name: "회차 읽기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ideal/library/${novelId}\\?listing=${listingId}`));
  await expect(page.getByText("구매한 두 번째 회차 원고", { exact: true })).toBeVisible();
  await expect(page.locator(".saved-novel-background")).toBeVisible();
  await page.getByRole("link", { name: "갤러리", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ideal/library/gallery/${listingId}$`));
  await expect(page.getByText("구매한 두 번째 회차 원고", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "소설 갤러리" }).getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: "삽화 2 전체화면" }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 이미지 전체화면" }).getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "전체화면 닫기" }).click();
  await page.getByRole("link", { name: "소설로 돌아가기" }).click();
  await expect(page.getByText("구매한 두 번째 회차 원고", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 이야기 보기" }).click();
  await expect(page.getByText("구매한 첫 회차 원고", { exact: true })).toBeVisible();
  await expect(page.locator(".saved-novel-background")).toBeVisible();
});

test("a purchased character imports its related images into the character gallery", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const listing = "55555555-5555-4555-8555-555555555555";
  const outfit = "66666666-6666-4666-8666-666666666666";
  const illustration = "77777777-7777-4777-8777-777777777777";
  const result = { id: listing, kind: "character", seller_id: characterId, title: "희진", active: true, description: "", characterName: "희진" };
  await page.route("**/api/store**", route => new URL(route.request().url()).searchParams.has("id")
    ? route.fulfill({ json: { ...result, content: { profile: snapshot.art.profile, renderStyle: "storybook-gouache" }, imageUrl: "https://example.test/image.jpg",
      images: [
        { id: "purchased-" + outfit, jobId: outfit, kind: "outfit", title: "대화 장면", url: "https://example.test/outfit.jpg" },
        { id: "purchased-" + illustration, jobId: illustration, kind: "illustration", title: "이야기 삽화", url: "https://example.test/illustration.jpg" },
      ] } })
    : route.fulfill({ json: { listings: [result], owned: [listing] } }));
  await page.goto("/ideal/bookshop");
  await page.locator(".bookshop-character-grid").getByRole("button",{name:"희진",exact:true}).click();
  const saved = page.waitForRequest(request => request.url().endsWith("/api/account") && request.method() === "POST" && request.postDataJSON().action === "save");
  await page.getByRole("button", { name: "내 캐릭터로 사용" }).click();
  await expect(page).toHaveURL(/\/ideal\/new$/);
  expect((await saved).postDataJSON().payload.art.renderStyle).toBe("storybook-gouache");
  await page.getByRole("button", { name: "대화하기", exact: true }).click();
  await page.getByRole("link", { name: "장면 갤러리" }).click();
  await expect(page.locator(".gallery-image-trigger")).toHaveCount(3);
  const image = page.getByRole("button", { name: "이미지 보기: 대화 장면" });
  await expect(image.getByRole("img")).toBeVisible();
  await image.click();
  await expect(page.getByRole("dialog", { name: "캐릭터 이미지 전체화면" }).getByRole("img")).toBeVisible();
});

test("first login collects a profile and restores it on the next launch", async ({ page }) => {
  await signIn(page);
  let profile: { display_name: string; gender?: string; age?: number; onboarded: boolean } = { display_name: "", onboarded: false };
  await page.route("**/api/account**", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "profile") { expect(body).toEqual({ action: "profile", nickname: "별빛", gender: "여성" }); profile = { display_name: body.nickname, gender: body.gender, onboarded: true }; }
      return route.fulfill({ json: { ok: true } });
    }
    if (new URL(route.request().url()).searchParams.has("previews")) return route.fulfill({ json: { images: {} } });
    return route.fulfill({ json: { userId, email: "test@example.com", profile, wallet: { transferable: 0, bonus: 5, free_chats: 5 }, documents: [], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.goto("/ideal");
  await expect(page.getByRole("heading", { name: "당신을 알려주세요" })).toBeVisible();
  await expect(page.locator(".profile-setup input[type=number]")).toHaveCount(0);
  await page.reload();await expect(page.getByRole("heading",{name:"당신을 알려주세요"})).toBeVisible();
  await expect(page.locator(".profile-setup input[type=number]")).toHaveCount(0);
  await page.getByLabel("사용자 닉네임").fill("별빛"); await page.getByLabel("사용자 성별").selectOption("여성"); await expect(page.getByLabel("사용자 나이")).toHaveCount(0);
  await page.screenshot({ path: ".verification/native-onboarding.png", caret: "initial" });
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  await expect(page.locator(".native-user")).toContainText("별빛");
  await page.reload(); await expect(page.getByRole("heading", { name: "나의 캐릭터", exact: true })).toBeVisible();
  await expect(page.getByLabel("사용자 닉네임")).toHaveCount(0);
});

test("character generation confirmation does not call the API until accepted", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const jpeg = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#cbb9ef" } }).jpeg().toBuffer();
  let requests = 0;
  await page.route("**/api/characters", route => { requests++; return route.fulfill({ contentType: "image/jpeg", headers: { "X-Character-Title": encodeURIComponent("서하") }, body: jpeg }); });
  await page.goto("/ideal/new"); await fillCharacterProfile(page);
  await page.screenshot({ path: ".verification/native-newface-account.png", caret: "initial" });
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "새로운 캐릭터를 만날까요?" });
  await expect(confirmation).toContainText("50"); await expect(confirmation).toContainText("955");
  await page.screenshot({ path: ".verification/native-confirm-character.png", caret: "initial" });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click(); expect(requests).toBe(0);
  await page.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await confirmation.getByRole("button", { name: "캐릭터 생성", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
});

test("profile photo previews, saves, survives reload and can be removed", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let avatarUrl: string | null = null; let uploads = 0; let avatarReads = 0;
  const photo = await sharp({ create: { width: 60, height: 80, channels: 3, background: "#ad9bea" } }).png().toBuffer();
  await page.route("https://example.test/avatar.jpg", route => { avatarReads++; return route.fulfill({ contentType: "image/png", body: photo }); });
  await page.route("**/api/account", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { userId, email: "test@example.com", profile: { display_name: "별빛", gender: "여성", age: 27, onboarded: true }, avatarUrl, wallet: { transferable: 1000, bonus: 5, free_chats: 5 }, documents: [], jobs: [], billingEnabled: false, adsEnabled: false } });
  });
  await page.route("**/api/account/profile", async route => {
    expect(route.request().headers().authorization).toBe("Bearer test-access-token");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    const body = route.request().postDataBuffer()!.toString();
    expect(body).toContain('name="profile"');
    if (body.includes('name="photo"')) { uploads++; avatarUrl = "https://example.test/avatar.jpg"; }
    else { expect(body).toContain('name="removePhoto"'); avatarUrl = null; }
    return route.fulfill({ json: { ok: true, avatarUrl } });
  });
  await page.goto("/ideal/mypage");
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로필 수정" });
  const chooserEvent = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "프로필 사진 변경" }).click();
  const chooser = await chooserEvent;
  await chooser.setFiles({ name: "avatar.png", mimeType: "image/png", buffer: photo });
  await expect(editor.getByAltText("프로필 사진 미리보기")).toBeVisible();
  await editor.getByRole("button", { name: "프로필 저장" }).click();
  await expect(editor).toHaveCount(0); await expect(page.locator(".native-profile-card img")).toBeVisible();
  expect(uploads).toBe(1);
  await expect.poll(() => page.evaluate(async () => { const cache = await caches.open("maite-private-images-v1"); return (await cache.keys()).length; })).toBeGreaterThan(0);
  const readsBeforeReload = avatarReads;
  await page.reload(); await expect(page.locator(".native-profile-card img")).toBeVisible();
  expect(avatarReads).toBe(readsBeforeReload);
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  await editor.getByRole("button", { name: "사진 삭제" }).click();
  await editor.getByRole("button", { name: "프로필 저장" }).click();
  await expect(editor).toHaveCount(0); await expect(page.locator(".native-profile-card img")).toHaveCount(0);
});

test("notification switches persist account-wide push and quiet-hour preferences", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let settings={pushEnabled:false,quietHours:true,available:true};const saved:unknown[]=[];
  await page.route("**/api/notifications", route=>{
    if(route.request().method()==="POST"){const body=route.request().postDataJSON();saved.push(body);settings={...settings,pushEnabled:body.pushEnabled,quietHours:body.quietHours};return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:settings});
  });
  await page.goto("/ideal/mypage");
  const push=page.getByRole("switch",{name:"안부 대화",exact:true}),quiet=page.getByRole("switch",{name:"야간 알림 제한",exact:true});
  await expect(push).toHaveAttribute("aria-checked","false");await expect(quiet).toHaveAttribute("aria-checked","true");
  await push.click();await expect(push).toHaveAttribute("aria-checked","true");
  await quiet.click();await expect(quiet).toHaveAttribute("aria-checked","false");
  await page.reload();await expect(push).toHaveAttribute("aria-checked","true");await expect(quiet).toHaveAttribute("aria-checked","false");
  expect(saved).toEqual([{action:"settings",pushEnabled:true,quietHours:true},{action:"settings",pushEnabled:true,quietHours:false}]);
});

test("web greeting settings recover from a failed read and enable without browser notification permission",async({page})=>{
 await signIn(page);await accountRoutes(page);let fail=true,enabled=false;
 await page.addInitScript(()=>{Object.defineProperty(window,"Notification",{configurable:true,value:class{static permission="denied";static requestPermission(){throw new Error("Browser notification permission must not be requested");}}});});
 await page.route("**/api/notifications",route=>{
  if(route.request().method()==="POST"){enabled=route.request().postDataJSON().pushEnabled;return route.fulfill({json:{ok:true}});}
  if(fail)return route.fulfill({status:503,json:{error:"안부 설정 연결을 확인해주세요."}});
  return route.fulfill({json:{pushEnabled:enabled,quietHours:true,available:true}});
 });
 await page.goto("/ideal/mypage");const toggle=page.getByRole("switch",{name:"안부 대화",exact:true});
 await expect(page.getByRole("status")).toContainText("안부 설정 연결을 확인해주세요.");await expect(toggle).toBeDisabled();
 fail=false;await page.getByRole("button",{name:"설정 다시 불러오기"}).click();await expect(toggle).toBeEnabled();
 await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","true");expect(enabled).toBe(true);
 await expect(page.locator(".notification-settings")).toContainText("브라우저 알림 권한 없이");
});

test("stored check-ins appear in their character chat once without generating an AI reply",async({page})=>{
 await signIn(page);await accountRoutes(page);
 let aiCalls=0;let requestBody:any;await page.route("**/api/chat",route=>{aiCalls++;requestBody=route.request().postDataJSON();return route.fulfill({contentType:"text/event-stream",body:'data: {"type":"delta","text":"반가워!"}\n\ndata: {"type":"done"}\n\n'});});
 await page.route(`**/api/notifications?document=${characterId}`,route=>route.fulfill({json:{messages:[{id:novelId,body:"나 안 보고 싶어?",user_turns:0,created_at:new Date().toISOString()}]}}));
 await page.goto(`/ideal/characters/${characterId}`);
 await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
 const greeting=page.getByRole("log").getByText("나 안 보고 싶어?",{exact:true});await expect(greeting).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event("maite-checkins-refresh")));await expect(greeting).toHaveCount(1);expect(aiCalls).toBe(0);
 await page.getByLabel("AI에게 보낼 메시지").fill("나도 보고 싶어");await page.getByRole("button",{name:"AI 메시지 보내기"}).click();
 await expect(page.getByRole("log").getByText("반가워!",{exact:true})).toBeVisible();expect(aiCalls).toBe(1);
 expect(requestBody.messages).toEqual([{role:"assistant",content:"나 안 보고 싶어?"},{role:"user",content:"나도 보고 싶어"}]);
});

test("an open local web chat receives its 24-hour greeting once without an AI call",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const now=new Date("2026-11-18T12:00:00+09:00");await page.clock.install({time:now});
 const saved=structuredClone(snapshot);saved.chat.committed=[{role:"user",content:"이따 봐"},{role:"assistant",content:"응, 이따 봐!"}];saved.chat.archive=saved.chat.committed;
 await page.route(`**/api/account?document=${characterId}*`,route=>route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{}}}}));
 const receipts:any[]=[];let aiCalls=0,messageReads=0;
 await page.route("**/api/chat",route=>{aiCalls++;return route.abort();});
 await page.route("**/api/notifications**",route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==="POST"){receipts.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}
  if(url.searchParams.has("document")){messageReads++;return route.fulfill({json:{messages:receipts.map(row=>({id:row.id,body:row.body,user_turns:row.userTurns,created_at:row.dueAt}))}});}
  const last=receipts.at(-1);
  return route.fulfill({json:{unread:Object.fromEntries(receipts.map(row=>[row.documentId,1])),pushEnabled:true,quietHours:false,available:true,nickname:"햄군",activities:[{documentId:characterId,userTurns:1,lastUserAt:now.toISOString(),characterName:"희진"}],lastDelivered:last??null}});
 });
 await page.goto(`/ideal/characters/${characterId}`);await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||"{}").pending?.dueAt,`maite-local-checkins:${userId}`)).toBe(new Date(now.getTime()+86400000).toISOString());
 await page.clock.fastForward(86370000);expect(receipts).toHaveLength(0);
 await page.clock.fastForward(40000);await expect(page.getByRole("log").getByText("나 안 보고 싶어?",{exact:true})).toBeVisible();
 expect(receipts).toHaveLength(1);expect(aiCalls).toBe(0);
 await page.clock.fastForward(240000);expect(receipts).toHaveLength(1);
 await page.getByRole("navigation",{name:"하단 메뉴"}).getByRole("link",{name:"내 정보",exact:true}).click();
 await expect(page.locator(".checkin-reservation-status")).toContainText("지난 안부에 답장");
 await expect(page.locator(".notification-settings")).toContainText("웹에서는 화면을 열어 둔 동안");
});

test("five tabs separate the heart store from the bookshop and preserve profile editing", async ({ page }) => {
  await signIn(page); await accountRoutes(page); await page.goto("/ideal/characters");
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(footer.getByRole("link")).toHaveText(["캐릭터", "서고", "서점", "스토어", "내 정보"]);
  await page.screenshot({ path: ".verification/native-characters.png", caret: "initial" });
  await footer.getByRole("link", { name: "스토어", exact: true }).click();
  await expect(page.getByRole("heading", { name: "하트 스토어" })).toBeVisible();
  await expect(page.locator(".heart-product")).toHaveCount(4);
  await expect(page.locator(".heart-product h3")).toHaveText(["하트 150개","하트 400개","하트 1,000개","하트 패스 · 총 800개"]);
  await expect(page.locator(".heart-product button")).toHaveText(["2,000원","5,000원","10,000원","5,000원"]);
  await expect(page.locator(".heart-store-page")).toContainText("즉시 200개 + 30일간 매일 20개");
  await expect(page.locator(".heart-product button").first()).toBeDisabled();
  await page.screenshot({ path: ".verification/native-hearts.png", caret: "initial" });
  await footer.getByRole("link", { name: "서점", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "서점 분류" })).toBeVisible();
  await footer.getByRole("link", { name: "내 정보", exact: true }).click();
  await expect(page.getByRole("heading", { name: "캐릭터 목록", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "프로필 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로필 수정" }); await expect(editor).toBeVisible();
  await page.keyboard.press("Escape"); await expect(editor).toHaveCount(0);
  await expect(page.locator(".heart-total")).toContainText("1,005");
});

test("restored duplicate image IDs stay selectable, naming uses the profile, and unchanged navigation avoids saves", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved = structuredClone(snapshot);
  saved.story.started = true;
  saved.gallery = [
    { id: "original", title: "희진", kind: "character", jobId },
    { id: "illustration-4", title: "첫 삽화", kind: "illustration", jobId },
    { id: "illustration-4", title: "다른 삽화", kind: "illustration", jobId: "66666666-6666-4666-8666-666666666666" },
  ];
  saved.backgrounds = { chat: "illustration-4", story: "original" };
  await page.route(`**/api/account?document=${characterId}*`, route => route.fulfill({ json: { id: characterId, title: "희진", payload: saved, media: { original: "https://example.test/image.jpg", gallery: { [jobId]: "https://example.test/image.jpg", "66666666-6666-4666-8666-666666666666": "https://example.test/image.jpg" } } } }));
  const errors: string[] = []; let saves = 0; let queries = 0;
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    const url = new URL(request.url()); if (url.pathname !== "/api/account") return;
    if (request.method() === "POST" && request.postDataJSON().action === "save") saves++;
    if (request.method() === "GET" && !url.search) queries++;
  });
  await page.goto(`/ideal/characters/${characterId}`);
  await page.getByRole("button", { name: "이 캐릭터로 대화·이야기 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "캐릭터 이미지 전체화면 보기", exact: true })).toBeVisible();
  await expect.poll(() => saves).toBeGreaterThan(0);
  await page.getByRole("group", { name: "캐릭터와 함께하기" }).getByRole("button", { name: "대화하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "캐릭터 설정", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "배경 변경", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "배경 변경", exact: true });
  await expect(picker.locator(".background-picker-grid > button")).toHaveCount(4);
  await picker.getByRole("button", { name: "배경 선택: 다른 삽화", exact: true }).click();
  await page.getByRole("button", { name: "배경 변경", exact: true }).click();
  await expect(picker.getByRole("button", { name: "배경 선택: 다른 삽화", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  let named = false;
  await page.route("**/api/chat", route => {
    expect(route.request().postDataJSON().character.userName).toBe("테스트"); named = true;
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"테스트, 반가워."}\n\ndata: {"type":"done"}\n\n' });
  });
  await page.getByLabel("AI에게 보낼 메시지").fill("안녕");
  await page.getByRole("button", { name: "AI 메시지 보내기" }).click();
  await expect(page.getByText("테스트, 반가워.", { exact: true })).toBeVisible();
  expect(named).toBe(true);
  const footer = page.getByRole("navigation", { name: "하단 메뉴" });
  await footer.getByRole("link", { name: "내 정보", exact: true }).click();
  await page.waitForTimeout(700); // Let completion refresh and the coalesced save settle.
  const previous = { saves, queries };
  await footer.getByRole("link", { name: "캐릭터", exact: true }).click();
  await footer.getByRole("link", { name: "내 정보", exact: true }).click();
  await page.waitForTimeout(700);
  expect({ saves, queries }).toEqual(previous);
  expect(errors.filter(message => /same key/.test(message))).toEqual([]);
  await expect(page.locator(".native-profile-card .native-outline svg")).toBeVisible();
  await expect(page.locator(".chat-header .account-trigger")).toHaveAttribute("href", "/ideal/store");
});

test("image slots hide browser broken-image indicators until the image decodes", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const image = await sharp({ create: { width: 72, height: 128, channels: 3, background: "#bba4df" } }).jpeg().toBuffer();
  await page.route("https://example.test/image.jpg", async route => { await gate; await route.fulfill({ contentType: "image/jpeg", body: image }); });
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    const preview = page.locator(".character-detail img");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("src", /^data:image\/gif/);
    await expect(preview).toHaveCSS("visibility", "hidden");
    const before = await preview.boundingBox();
    release();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("aria-busy", "false");
    await expect(preview).toHaveJSProperty("naturalWidth", 72);
    expect((await preview.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  } finally { release(); }
});

test("one bundled read opens a character before slow gallery downloads and preserves every saved image", async ({ page }) => {
  await signIn(page); await accountRoutes(page);
  const saved=structuredClone(snapshot);
  const otherJob="66666666-6666-4666-8666-666666666666";
  const firstSceneJob="77777777-7777-4777-8777-777777777777";
  saved.gallery=[{id:"original",title:"희진",kind:"character",jobId},{id:"scene-a",title:"서점",kind:"illustration",jobId:firstSceneJob},{id:"scene-b",title:"카페",kind:"illustration",jobId:otherJob}];
  saved.backgrounds={chat:"scene-a",story:"original"};
  let documentReads=0,jobReads=0,originalReads=0,secondSceneReads=0;const persisted:unknown[]=[];
  page.on("request",request=>{
    const url=new URL(request.url());if(url.hostname==="example.test"&&url.pathname==="/image.jpg")originalReads++;
    if(url.hostname==="example.test"&&url.pathname==="/slow-b.jpg")secondSceneReads++;
    if(url.pathname!=="/api/account")return;
    if(url.searchParams.has("job"))jobReads++;
    if(request.method()==="POST" && request.postDataJSON().action==="save")persisted.push(request.postDataJSON());
  });
  await page.route(`**/api/account?document=${characterId}*`,route=>{
    documentReads++;expect(new URL(route.request().url()).searchParams.get("media")).toBe("1");
    return route.fulfill({json:{id:characterId,title:"희진",payload:saved,media:{original:"https://example.test/image.jpg",gallery:{[firstSceneJob]:"https://example.test/slow-a.jpg",[otherJob]:"https://example.test/slow-b.jpg"},thumbnails:{[firstSceneJob]:"https://example.test/thumb-a.webp",[otherJob]:"https://example.test/thumb-b.webp"}}}});
  });
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const image=await sharp({create:{width:72,height:128,channels:3,background:"#bca4d8"}}).jpeg().toBuffer();
  const thumb=await sharp(image).resize({width:32}).webp().toBuffer();
  await page.route("https://example.test/thumb-*.webp",route=>route.fulfill({contentType:"image/webp",body:thumb}));
  await page.route("https://example.test/slow-*.jpg",async route=>{await gate;await route.fulfill({contentType:"image/jpeg",body:image}).catch(()=>{});});
  try {
    await page.goto(`/ideal/characters/${characterId}`);
    await expect(page.locator(".character-detail img")).toBeVisible();
    await page.getByRole("button",{name:"이 캐릭터로 대화·이야기 시작",exact:true}).click();
    await expect(page.getByRole("button",{name:"캐릭터 이미지 전체화면 보기",exact:true})).toBeVisible();
    expect(documentReads).toBe(1);expect(jobReads).toBe(0);expect(originalReads).toBe(1);
    await expect.poll(()=>persisted.filter((item:any)=>item.kind==="studio" && item.payload.gallery.length===3).length).toBeGreaterThan(0);
    await page.getByRole("group",{name:"캐릭터와 함께하기"}).getByRole("button",{name:"대화하기",exact:true}).click();
    await expect(page.getByLabel("AI에게 보낼 메시지")).toBeEnabled();
    await page.getByRole("link",{name:"장면 갤러리",exact:true}).click();
    await expect(page.locator(".generated-gallery-grid article")).toHaveCount(3);
    await expect.poll(()=>page.locator('.generated-gallery-grid img').nth(2).evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBe(32);
    expect(secondSceneReads).toBe(0);
    await page.getByRole("button",{name:"이미지 보기: 카페",exact:true}).click();
    await expect.poll(()=>secondSceneReads).toBe(1);
    release();
    await expect(page.locator('.generated-gallery-grid img[src^="blob:"]')).toHaveCount(3);
  } finally {release();}
});


test("each character has an unread greeting marker; only opening its visible chat clears it",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const otherId="55555555-5555-4555-8555-555555555555",greetingId="66666666-6666-4666-8666-666666666666";
 const unread:Record<string,number>={[characterId]:1,[otherId]:1};let reads=0;
 await page.route("**/api/account",route=>{
  if(route.request().method()==="POST")return route.fulfill({json:{ok:true}});
  return route.fulfill({json:{userId,email:"test@example.com",profile:{display_name:"테스트"},wallet:{transferable:1000,bonus:5,free_chats:5},documents:[{id:characterId,title:"희진",kind:"studio",character_name:"희진"},{id:otherId,title:"수아",kind:"studio",character_name:"수아"}],jobs:[]}});
 });
 await page.route("**/api/notifications**",route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==="POST"){
   const body=route.request().postDataJSON();expect(body.action).toBe("read");expect(body.documentId).toBe(characterId);expect(body.ids).toEqual([greetingId]);
   reads++;delete unread[characterId];return route.fulfill({json:{ok:true}});
  }
  if(url.searchParams.has("inbox")||url.searchParams.has("sync"))return route.fulfill({json:{unread,pushEnabled:false,quietHours:true,activities:[],lastDeliveredByCharacter:[]}});
  if(url.searchParams.has("document"))return route.fulfill({json:{messages:[{id:greetingId,body:"뭐해?",user_turns:0,created_at:new Date().toISOString(),read_at:unread[characterId]?null:new Date().toISOString()}]}});
  return route.fulfill({json:{pushEnabled:false,quietHours:true,activities:[],lastDeliveredByCharacter:[]}});
 });
 await page.goto("/ideal/characters");
 const footer=page.getByRole("navigation",{name:"하단 메뉴"});
 await expect(footer.locator(".checkin-footer-dot")).toBeVisible();
 await expect(page.locator(".native-character-card .checkin-arrival-badge")).toHaveCount(2);
 await page.getByRole("link",{name:/희진.*안부 도착/}).click();
 await expect(page.locator(".character-detail .checkin-arrival-badge")).toBeVisible();expect(reads).toBe(0);
 await page.getByRole("tabpanel",{name:"대화 목록"}).getByRole("button").click();
 await expect(page.getByRole("log").getByText("뭐해?",{exact:true})).toBeVisible();await expect.poll(()=>reads).toBe(1);
 await footer.getByRole("link",{name:"캐릭터",exact:true}).click();
 await expect(page.locator(".native-character-card .checkin-arrival-badge")).toHaveCount(1);
 await expect(page.getByRole("link",{name:/수아.*안부 도착/})).toBeVisible();await expect(footer.locator(".checkin-footer-dot")).toBeVisible();
 await page.reload();await expect(page.locator(".native-character-card .checkin-arrival-badge")).toHaveCount(1);
 delete unread[otherId];await page.evaluate(()=>window.dispatchEvent(new Event("maite-checkins-refresh")));
 await expect(footer.locator(".checkin-footer-dot")).toHaveCount(0);
});

test("all characters send their own 24-hour greeting while another menu is open",async({page})=>{
 await signIn(page);await accountRoutes(page);
 const now=new Date("2026-11-19T12:00:00+09:00");await page.clock.install({time:now});
 const otherId="55555555-5555-4555-8555-555555555555",receipts:any[]=[];
 await page.route("**/api/notifications**",route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==="POST"){const body=route.request().postDataJSON();expect(body.action).toBe("delivered");receipts.push(body);return route.fulfill({json:{ok:true}});}
  if(url.searchParams.has("inbox"))return route.fulfill({json:{unread:Object.fromEntries(receipts.map(row=>[row.documentId,1]))}});
  return route.fulfill({json:{unread:Object.fromEntries(receipts.map(row=>[row.documentId,1])),pushEnabled:true,quietHours:false,available:true,nickname:"햄군",activities:[{documentId:characterId,userTurns:1,lastUserAt:now.toISOString(),characterName:"희진"},{documentId:otherId,userTurns:2,lastUserAt:now.toISOString(),characterName:"희진"}],lastDeliveredByCharacter:receipts}});
 });
 await page.goto("/ideal/mypage");
 await expect.poll(()=>page.evaluate(key=>{const state=JSON.parse(localStorage.getItem(key)||"{}");return Number(!!state.pending)+(state.pendingOthers?.length??0);},`maite-local-checkins:${userId}`)).toBe(2);
 await page.clock.fastForward(86410000);await expect.poll(()=>receipts.length).toBe(2);
 expect(new Set(receipts.map(row=>row.documentId))).toEqual(new Set([characterId,otherId]));
 expect(receipts.map(row=>row.body).sort()).toEqual(["나 안 보고 싶어?","보고 싶어, 테스트야."].sort());
 await expect(page.locator(".checkin-footer-dot")).toBeVisible();
 await page.clock.fastForward(86400000);expect(receipts).toHaveLength(2);
});
