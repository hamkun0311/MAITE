import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POST } from "../app/api/characters/route.ts";
import { imageRetryToken } from "../lib/server/image-retry-token.ts";
import { characterRenderStyle, characterStyleHeader, legacyCharacterRenderStyles, newCharacterRenderStyles, renderStyleDirection } from "../lib/characters/render-style.ts";
import {imageFramingSchema,framingDirection,defaultImageFraming} from "../lib/characters/framing.ts";
import { visualInstructions, visualRequestSchema, compositionSchema } from "../lib/characters/visual.ts";
import {
  MAX_CHARACTER_REQUEST,
  buildCharacterPrompt,
  characterBrief,
  illustrationBrief,
  outfitBrief,
} from "../lib/characters/schema.ts";

const composition = { pose: "Standing with torso turned left, gaze toward the doorway, both hands holding a folded coat, feet apart.", framing: "Eye-level side view, full figure with environment." };

test("scene composition is explicit and recent pose metadata is bounded", () => {
  const scene = { kind: "illustration" as const, context: "마차 안에 앉아 대화", previousCompositions: [composition] };
  assert.equal(visualRequestSchema.safeParse({ ...scene, previousCompositions: Array(4).fill(composition) }).success, false);
  assert.equal(compositionSchema.safeParse({ ...composition, pose: "x".repeat(241) }).success, false);
  const brief = { title: "마차", summary: "마차 안의 대화", prompt: "Seated in a carriage.", styleProfile: "female" as const,
    sceneLocation: "Inside a carriage.", locationSource: "narrative" as const,
    pose: "Seated facing right, leaning toward a companion, left hand on seat, right palm open, feet braced.",
    framing: "Wide interior shot from the opposite seat." };
  const prompt = buildCharacterPrompt(illustrationBrief.parse(brief));
  assert.match(prompt, /Staging: Seated facing right/);
  assert.match(prompt, /Camera: Wide interior shot/);
  assert.ok(!prompt.includes(composition.pose));
  assert.equal(illustrationBrief.safeParse({ ...brief, pose: undefined }).success, false);
});

test("GPT Image uses separate text and image gateway keys, attaches identity and returns a 720x1280 JPEG", async (t) => {
  const names = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_TEXT_API_KEY",
    "OPENAI_IMAGE_BASE_URL",
    "OPENAI_IMAGE_API_KEY",
    "OPENAI_IMAGE_MODEL",
    "OPENAI_IMAGE_QUALITY",
  ];
  const old = names.map((name) => process.env[name]);
  let now = Date.now();
  let profile: "female" | "male" | "neutral" = "female";
  t.mock.method(Date, "now", () => now);
  t.after(() =>
    names.forEach((name, i) => {
      if (old[i] === undefined) delete process.env[name];
      else process.env[name] = old[i];
    }),
  );
  const form = () => {
    const f = new FormData();
    f.set("profile", JSON.stringify({ name: "서하", age: 30, gender: profile === "female" ? "여성" : profile === "male" ? "남성" : undefined, personality: "다정한 성격", funElement: "서로 놀리며 티키타카", concept: "도시의 비밀", genre: "막장드라마" }));
    f.set(
      "messages",
      JSON.stringify([
        { role: "user", content: profile === "female" ? "30대 성인 여성, 우아한 원피스" : profile === "male" ? "파란 코트를 입고 밝게 웃는 남자 캐릭터" : "나무 정령 캐릭터" },
      ]),
    );
    return f;
  };
  const req = (body: FormData) =>
    new Request("http://localhost/api/characters", { method: "POST", body });
  delete process.env.OPENAI_API_KEY;
  assert.equal((await POST(req(form()))).status, 503);
  process.env.OPENAI_API_KEY = "fake-openai";
  process.env.OPENAI_BASE_URL = "https://text-gateway.example/v1/";
  process.env.OPENAI_TEXT_API_KEY = "text-gateway-key";
  process.env.OPENAI_IMAGE_BASE_URL = "https://image-gateway.example/v1";
  delete process.env.OPENAI_IMAGE_API_KEY;
  assert.equal((await POST(req(form()))).status, 503);
  process.env.OPENAI_IMAGE_API_KEY = "image-gateway-key";
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_IMAGE_QUALITY;
  let source = await sharp({
    create: { width: 720, height: 1280, channels: 3, background: "#d8bd9f" },
  })
    .png()
    .toBuffer();
  let calls = 0,
    blocks = false,
    briefCalls = 0;
  let includePrior = false;
  let sceneKind: "outfit" | "illustration" | undefined;
  let characterPresent = true;
  let sceneStyle: ReturnType<typeof characterRenderStyle.parse> | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls++;
      const authorization = new Headers(options.headers).get("Authorization");
      assert.equal(options.redirect, "error");
      if (url.endsWith("/moderations")) {
        assert.equal(url, "https://api.openai.com/v1/moderations");
        assert.equal(authorization, "Bearer fake-openai");
        assert.match(JSON.parse(String(options.body)).input, /다정한 성격/);
        if (sceneKind) assert.match(JSON.parse(String(options.body)).input, /파란 코트|서점/);
        return Response.json({
          results: [{ categories: { "sexual/minors": blocks } }],
        });
      }
      if (url.endsWith("/responses")) {
        assert.equal(url, "https://text-gateway.example/v1/responses");
        assert.equal(authorization, "Bearer text-gateway-key");
        const body = JSON.parse(String(options.body));
        assert.deepEqual(body.reasoning,{effort:"low"});
        assert.equal(body.instructions.includes("waist-up crop in prompt"), !sceneKind);
        if (!sceneKind) {
          assert.match(body.instructions, /has not specified footwear/);
          assert.match(body.instructions, /specifies footwear, choose a crop that shows it/);
          assert.match(body.instructions, /explicitly requested crop or camera framing takes precedence/);
        }
        if (sceneKind) {
          const scene = JSON.parse(body.input[0].content[0].text).scene;
          assert.equal(scene.kind, sceneKind);
          assert.equal(scene.previousCompositions, undefined);
          assert.match(body.instructions, sceneKind === "outfit" ? /current dialogue scene/ : /latest completed chapter/);
          if (sceneKind === "outfit") {
            assert.match(body.instructions, /latest established outfit/);
            assert.ok(body.text.format.schema.required.includes("sceneLocation"));
            assert.ok(body.text.format.schema.required.includes("outfit"));
            assert.match(body.instructions, /keep the established location/);
            assert.doesNotMatch(body.instructions, /Preserve identity and unchanged details/);
          }
          if (sceneKind === "illustration") {
            assert.doesNotMatch(body.instructions, /Preserve identity and unchanged details/);
            assert.ok(body.text.format.schema.required.includes("sceneLocation"));
            assert.match(body.instructions, /actual location, actions and visible cast/);
          }
        }
        const expectedGender = profile === "female" ? "여성" : profile === "male" ? "남성" : undefined;
        assert.deepEqual(JSON.parse(body.input[0].content[0].text).profile, { name: "서하", age: 30, ...(expectedGender ? { gender: expectedGender } : {}), personality: "다정한 성격", concept: "도시의 비밀", genre: "막장드라마" });
        assert.doesNotMatch(body.instructions, /B-cup|anime game key visual/);
        briefCalls++;
        const images = body.input[0].content.filter(
          (item: { type: string }) => item.type === "input_image",
        );
        assert.equal(images.length, 0);
        assert.doesNotMatch(body.input[0].content[0].text, /이전 외모와 의상/);
        assert.match(body.instructions, /explicit appearance, style and scene details/);
        assert.match(body.instructions, /Leave written dialogue, thoughts, bubbles, captions and overlays out/);
        return Response.json({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "캐릭터",
                    summary: "설명에 맞춰 새로 그리는 구성입니다.",
                    prompt: body.input[0].content[0].text.includes("현재 모습은 일상복")
                      ? "A man wearing a blue coat and jeans, glancing away bashfully."
                      : profile === "female" ? "Adult woman with long hair in an elegant dress." : "A man wearing a blue coat, cheerful expression.",
                    styleProfile: profile,
                    ...(sceneKind ? composition : {}),
                    ...(sceneKind === "illustration" ? { characterPresent, sceneLocation: "Inside a bookshop, bookshelves beside a reading table.", locationSource: "narrative" } : {}),
                    ...(sceneKind === "outfit" ? { characterPresent, sceneLocation: "Inside a clothing-store fitting room with mirrors and racks.", locationSource: "conversation", outfit: "A blue coat with black trousers.", outfitSource: "conversation" } : {}),
                  }),
                },
              ],
            },
          ],
        });
      }
      assert.equal(url, `https://image-gateway.example/v1/images/${sceneKind && includePrior && characterPresent ? "edits" : "generations"}`);
      assert.equal(authorization, "Bearer image-gateway-key");
      if (!(options.body instanceof FormData)) {
        const body = JSON.parse(String(options.body));
        if (sceneKind === "illustration" && !characterPresent) {
          assert.doesNotMatch(body.prompt, /identity reference/);
        }
        assert.equal(body.model, "gpt-image-2.5-sunburst");
        assert.equal(body.size, "720x1280");
        assert.match(body.prompt, /Keep the canvas vertical at 9:16/);
        assert.match(body.prompt, /Render a text-free illustration/);
        assert.match(body.prompt, /Adult woman with long hair|A man wearing a blue coat/);
        if (sceneStyle) assert.ok(body.prompt.includes(renderStyleDirection(sceneStyle)));
        else assert.match(body.prompt, /Fixed rendering style:/);
        assert.doesNotMatch(body.prompt, /Rendering profile:/);
        assert.doesNotMatch(body.prompt, /B-cup|anime game key visual/);
        assert.doesNotMatch(body.prompt, /이전 외모와 의상/);
        assert.ok(!body.prompt.includes("LAST input image is STYLE ONLY"));
        return Response.json({ data: [{ b64_json: source.toString("base64") }] });
      }
      const body = options.body;
      assert.equal(body.get("model"), "gpt-image-2.5-sunburst");
      assert.equal(body.get("size"), "720x1280");
      assert.equal(body.get("quality"), "medium");
      assert.equal(body.get("output_format"), "jpeg");
      assert.equal(body.has("steps"), false);
      const prompt = String(body.get("prompt"));
      assert.match(prompt, /Keep the canvas vertical at 9:16/);
      assert.match(prompt, /Omit all lettering, dialogue and thought bubbles/);
      assert.ok(prompt.includes(renderStyleDirection(sceneStyle!)));
      assert.match(prompt, /identity reference/);
      if (sceneKind === "outfit") {
        assert.match(prompt, /Outfit: 스포츠브라와 돌핀팬츠/);
        assert.match(prompt, /Location: 체육관/);
      }
      if (sceneKind === "illustration") {
        assert.match(prompt, /Location: Inside a bookshop/);
        assert.match(prompt, /Staging: /);
      }
      assert.doesNotMatch(prompt, /B-cup|anime game key visual/);
      const images = body.getAll("image[]") as File[];
      assert.equal(images.length, 1);
      if (includePrior) {
        assert.equal(images[0].name, "previous-character.jpg");
        assert.equal((await sharp(Buffer.from(await images[0].arrayBuffer())).metadata()).width, 720);
      }
      return Response.json({
        data: [{ b64_json: source.toString("base64") }],
      });
    },
  );
  const blocked = form();
  blocked.set("messages", JSON.stringify([{role:"user",content:"성인물 이미지를 만들어줘"}]));
  const filtered = await POST(req(blocked));
  assert.equal(filtered.status, 422);
  assert.equal((await filtered.json()).error, "정책을 위반한 요청입니다.");
  const oversized = new Request("http://localhost/api/characters", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=a",
      "Content-Length": String(MAX_CHARACTER_REQUEST + 1),
    },
    body: "x",
  });
  assert.equal((await POST(oversized)).status, 413);
  const invalid = form();
  invalid.set("scene", JSON.stringify({ kind: "outfit", context: "파란 코트" }));
  invalid.set("image", new Blob(["not-jpeg"], { type: "image/jpeg" }), "x.jpg");
  assert.equal((await POST(req(invalid))).status, 400);
  assert.equal(calls, 0);
  const noReference = form();
  noReference.set("scene", JSON.stringify({ kind: "outfit", context: "파란 코트" }));
  assert.equal((await POST(req(noReference))).status, 400);
  assert.equal(calls, 0);
  const invalidProfile = form();
  invalidProfile.set("profile", JSON.stringify({ name: "서하", age: -1 }));
  assert.equal((await POST(req(invalidProfile))).status, 400);
  assert.equal(calls, 0);
  const invalidStyle = form();
  invalidStyle.set("renderStyle", "watercolor");
  assert.equal((await POST(req(invalidStyle))).status, 400);
  assert.equal(calls, 0);
  const first = await POST(req(form()));
  assert.equal(first.status, 200);
  const result = Buffer.from(await first.arrayBuffer());
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.format, "jpeg");
  assert.equal(first.headers.get("X-Character-Width"), "720");
  assert.equal(first.headers.get("X-Character-Height"), "1280");
  assert.match(decodeURIComponent(first.headers.get("X-Character-Prompt")!), /Adult woman with long hair|A man wearing a blue coat/);
  const revision = form();
  source = await sharp(result).webp().toBuffer();
  sceneKind = "outfit";
  revision.set("scene", JSON.stringify({ kind: "outfit", context: "서하는 파란 코트를 입었다.", previousCompositions: [composition], selection: { confirmed:true, location:"체육관",outfit:"스포츠브라와 돌핀팬츠",characters:["서하"],target:"서하",profileName:"서하",userNames:["햄군"] } }));
  includePrior = true;
  sceneStyle = characterRenderStyle.parse(first.headers.get(characterStyleHeader));
  assert.ok(newCharacterRenderStyles.some(style => style === sceneStyle));
  revision.set("renderStyle", sceneStyle);
  revision.set(
    "image",
    new Blob([result], { type: "image/jpeg" }),
    "previous.jpg",
  );
  const revised = await POST(req(revision));
  assert.equal(revised.status, 200);
  assert.equal(revised.headers.get(characterStyleHeader), sceneStyle);
  assert.equal(revised.headers.get("Content-Type"), "image/jpeg");
  assert.equal((await sharp(Buffer.from(await revised.arrayBuffer())).metadata()).format, "jpeg");
  assert.ok(revised.headers.get("X-Character-Prompt")!.length <= 8000);
  assert.deepEqual(JSON.parse(decodeURIComponent(revised.headers.get("X-Character-Composition")!)), composition);
  sceneKind = undefined;
  sceneStyle = undefined;
  blocks = true;
  const before = calls;
  assert.equal((await POST(req(form()))).status, 422);
  assert.equal(calls, before + 1);
  assert.equal((await POST(req(form()))).status, 429);
  now += 61000;
  blocks = false;
  profile = "male";
  includePrior = false;
  const male = await POST(req(form()));
  assert.equal(male.status, 200);
  assert.equal(male.headers.get("X-Character-Style"), "male");
  const maleRevision = form();
  sceneKind = "illustration";
  maleRevision.set("scene", JSON.stringify({ kind: "illustration", context: "서점의 창가에서 다시 만났다." }));
  maleRevision.set("image", new Blob([result], { type: "image/jpeg" }), "previous.jpg");
  sceneStyle = characterRenderStyle.parse(male.headers.get(characterStyleHeader));
  maleRevision.set("renderStyle", sceneStyle);
  includePrior = true;
  assert.equal((await POST(req(maleRevision))).status, 200);
  characterPresent = false;
  now += 61000;
  const emptyScene = new FormData();
  for (const [key, value] of maleRevision) emptyScene.set(key, value);
  emptyScene.set("scene", JSON.stringify({ kind: "illustration", context: "희진은 이곳에 없다. 텅 빈 서점에서 열린 창문으로 바람만 들어왔다." }));
  assert.equal((await POST(req(emptyScene))).status, 200);
  sceneKind = "outfit";
  const counterpartScene = new FormData();
  for (const [key, value] of maleRevision) counterpartScene.set(key, value);
  counterpartScene.set("scene", JSON.stringify({ kind: "outfit", context: "서하는 이곳에 없다. 당신은 흰 셔츠를 입은 민수와 대화한다.", selection: { profileName: "서하", userNames: ["당신"], characters: ["민수"], target: "민수" } }));
  assert.equal((await POST(req(counterpartScene))).status, 200);
  characterPresent = true;
  sceneKind = undefined;
  sceneStyle = undefined;
  includePrior = false;
  profile = "neutral";
  now += 61000;
  const legacy = form();
  legacy.set("renderStyle", "chibi-game");
  legacy.set("image", new Blob([result], { type: "image/jpeg" }), "previous.jpg");
  legacy.set("messages", JSON.stringify([
    { role: "user", content: "이전 외모와 의상" },
    { role: "assistant", content: "이전 외모와 의상" },
    { role: "user", content: "현재 모습은 일상복. 속마음이 자막처럼 보인다. '사실 오래전부터 좋아했어'." },
  ]));
  const regenerated = await POST(req(legacy));
  assert.equal(regenerated.status, 200);
  assert.equal(regenerated.headers.get(characterStyleHeader), "chibi-game");
  const regeneratedPrompt = decodeURIComponent(regenerated.headers.get("X-Character-Prompt")!);
  assert.ok(regeneratedPrompt.includes(renderStyleDirection("chibi-game")));
  assert.match(regeneratedPrompt, /blue coat and jeans, glancing away bashfully/);
  assert.doesNotMatch(regeneratedPrompt, /속마음이 자막|사실 오래전부터 좋아했어/);
  now += 61000;
  for (const [width, height] of [[1024, 1536], [1200, 600]]) {
    source = await sharp({ create: { width, height, channels: 3, background: "#d8bd9f" } }).jpeg().toBuffer();
    const response = await POST(req(form()));
    assert.equal(response.headers.get("X-Character-Style"), "neutral");
    const output = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(output.width, 720);
    assert.equal(output.height, 1280);
    assert.equal(response.headers.get("X-Character-Width"), String(output.width));
    assert.equal(response.headers.get("X-Character-Height"), String(output.height));
  }
  source = Buffer.from("89504e470d0a1a0a", "hex");
  const corrupted = await POST(req(form()));
  assert.equal(corrupted.status, 502);
  assert.equal((await corrupted.json()).error, "이미지 응답 형식이 올바르지 않습니다.");
});

test("a confirmed novel counterpart omits the profile identity even when the scene editor reports the profile present",async t=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="fake-openai";
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;});
 t.mock.method(Date,"now",()=>Date.parse("2030-01-01T00:00:00Z"));
 const jpeg=await sharp({create:{width:72,height:128,channels:3,background:"#cbb9ef"}}).jpeg().toBuffer();
 let rendered=false;
 t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init:RequestInit)=>{
  const url=String(input);
  if(url.endsWith("/moderations"))return Response.json({results:[{categories:{"sexual/minors":false}}]});
  if(url.endsWith("/responses")){
   const body=JSON.parse(String(init.body));assert.match(body.instructions,/the selected primary subject/);
   assert.equal(JSON.parse(body.input[0].content[0].text).scene.selection.target,"민수");
   return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({title:"민수",summary:"민수의 보고",prompt:"An adult knight kneels before the king.",styleProfile:"male",characterPresent:true,...composition,sceneLocation:"A royal hall.",locationSource:"narrative"})}]}]});
  }
  assert.ok(url.endsWith("/images/generations"));assert.equal(init.body instanceof FormData,false);
  const body=JSON.parse(String(init.body));assert.match(body.prompt,/Primary subject: 민수/);assert.doesNotMatch(body.prompt,/identity reference/);
  rendered=true;return Response.json({data:[{b64_json:jpeg.toString("base64")}]});
 });
 const form=new FormData();
 form.set("profile",JSON.stringify({name:"희진",age:25,personality:"다정함",concept:"왕궁의 친구"}));
 form.set("messages",JSON.stringify([{role:"user",content:"민수의 보고 장면"}]));form.set("image",new Blob([jpeg],{type:"image/jpeg"}),"original.jpg");
 form.set("scene",JSON.stringify({kind:"illustration",context:"희진은 왕궁 연회장에 있었다. 민수는 왕 앞에서 보고했다.",selection:{confirmed:true,targetConfirmed:true,target:"민수",profileName:"희진",userNames:["햄군"],characters:["희진","민수"],location:"왕궁 연회장",outfit:"검은 갑옷"}}));
 const result=await POST(new Request("http://localhost/api/characters",{method:"POST",body:form}));
 assert.equal(result.status,200);assert.equal(rendered,true);
});

test("all genders share text rendering and a counterpart gets concept facts without a portrait",async t=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="fake-openai";
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;});
 let now=Date.parse("2031-01-01T00:00:00Z");t.mock.method(Date,"now",()=>now);
 const jpeg=await sharp({create:{width:72,height:128,channels:3,background:"#cbb9ef"}}).jpeg().toBuffer();
 let mode="female",rendered=0;
 const castConcept="엘리는 분홍색 머리의 사제다.";
 t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init:RequestInit)=>{
  const url=String(input);
  if(url.endsWith("/moderations"))return Response.json({results:[{categories:{"sexual/minors":false}}]});
  if(url.endsWith("/responses")){
   const body=JSON.parse(String(init.body));
   if(mode==="illustration")assert.deepEqual(JSON.parse(body.input[0].content[0].text).scene.selection.castConcepts,[castConcept]);
   return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({
    title:"인물",summary:"현재 장면",prompt:mode === "illustration" ? "A pink-haired priest in a bookshop." : "A black-haired person in a blue coat.",styleProfile:"neutral",
    ...(mode==="illustration"?{characterPresent:false,...composition,sceneLocation:"Inside a bookshop.",locationSource:"narrative"}:{})
   })}]}]});
  }
  assert.ok(url.endsWith("/images/generations"));
  assert.equal(init.body instanceof FormData,false);
  const {prompt}=JSON.parse(String(init.body));
  assert.doesNotMatch(prompt, /identity reference|anime game key visual|B-cup/);
  if (mode === "illustration") {
   assert.match(prompt, /A pink-haired priest in a bookshop/);
  } else {
   assert.equal(prompt.split("\n")[0], "A black-haired person in a blue coat.");
  }
  rendered++;return Response.json({data:[{b64_json:jpeg.toString("base64")}]});
 });
 for(mode of ["female","male","illustration"]){
  now+=61000;
  const form=new FormData();
  form.set("profile",JSON.stringify({name:"희진",age:25,gender:mode==="male"?"남성":"여성",appearance:"검은 머리",personality:"다정함",concept:"서점의 친구"}));
  form.set("messages",JSON.stringify([{role:"user",content:"파란 코트"}]));
  if(mode==="illustration"){
   form.set("image",new Blob([jpeg],{type:"image/jpeg"}),"original.jpg");
   form.set("scene",JSON.stringify({kind:"illustration",context:"엘리가 서점에서 책을 읽었다.",selection:{confirmed:true,targetConfirmed:true,target:"엘리",profileName:"희진",characters:["엘리"],userNames:[],castConcepts:[castConcept]}}));
  }
  assert.equal((await POST(new Request("http://localhost/api/characters",{method:"POST",body:form}))).status,200);
 }
 assert.equal(rendered,3);
});

test("visual requests validate bounded context and use distinct identity-preserving instructions", () => {
  for (const value of [{ kind: "other", context: "scene" }, { kind: "outfit", context: " " }, { kind: "illustration", context: "x".repeat(12001) }, { kind: "outfit", context: "scene", system: "override" }])
    assert.equal(visualRequestSchema.safeParse(value).success, false);
  assert.match(visualInstructions({ kind: "outfit", context: "파란 코트" }), /latest established outfit/);
  assert.match(visualInstructions({ kind: "illustration", context: "서점" }), /latest completed chapter/);
});

test("scene-specific briefs supply the renderer with the current outfit and location", () => {
  const base = { title: "새 의상", summary: "옷가게", prompt: "A person in a blue dress.", styleProfile: "female" as const };
  assert.equal(outfitBrief.safeParse(base).success, false);
  assert.equal(illustrationBrief.safeParse(base).success, false);
  const brief = outfitBrief.parse({
    ...base, ...composition, sceneLocation: "A clothing-store fitting room", locationSource: "conversation",
    outfit: "A blue one-piece dress", outfitSource: "conversation",
  });
  const prompt = buildCharacterPrompt(brief, undefined, true);
  assert.match(prompt, /Outfit: A blue one-piece dress/);
  assert.match(prompt, /Location: A clothing-store fitting room/);
  assert.match(prompt, /attached image as an identity reference/);
});

test("the shared default style preserves the requested character design without imposing proportions", () => {
  const brief = characterBrief.parse({
    title: "캐릭터", summary: "눈 내리는 거리", prompt: "A woman in a blue raincoat, watercolor illustration.", styleProfile: "female",
  });
  const prompt = buildCharacterPrompt(brief);
  assert.equal(prompt.split("\n")[0], brief.prompt);
  assert.match(prompt, /defined cel shadows softened at selected edges/);
  assert.match(prompt, /If the brief explicitly requests another art style, follow that request/);
  assert.doesNotMatch(prompt, /B-cup/);
  assert.equal(buildCharacterPrompt({ ...brief, styleProfile: "male" }), prompt);
  const fixed = newCharacterRenderStyles.map(style => buildCharacterPrompt(brief, undefined, false, undefined, undefined, style));
  assert.equal(new Set(fixed).size, 4);
  assert.match(fixed[0], /luminous rim highlights/);
  assert.match(fixed[1], /existing accessories intricate finish/);
  assert.match(fixed[2], /one or two clean graphic shadow shapes/);
  assert.match(fixed[3], /large head, compact rounded limbs/);
  for (const style of legacyCharacterRenderStyles) {
    assert.equal(characterRenderStyle.parse(style), style);
    assert.ok(!fixed.includes(buildCharacterPrompt(brief, undefined, false, undefined, undefined, style)));
  }
  fixed.forEach(value => {
    assert.match(value, /Fixed rendering style:/);
    assert.doesNotMatch(value, /Default rendering style:/);
    assert.ok(value.includes(brief.prompt));
  });
  assert.throws(() => characterBrief.parse({ ...brief, prompt: "x".repeat(801) }));
});

test("image retries reuse the approved brief, replace it after an input change and remember policy rejections", async t => {
 const keys=["OPENAI_API_KEY","ACCOUNT_FEATURES_ENABLED","NODE_ENV","DEBUG_IMAGE_RENDER_PROMPT"];
 const previous=keys.map(key=>process.env[key]);
 Object.assign(process.env,{OPENAI_API_KEY:"fixture",ACCOUNT_FEATURES_ENABLED:"false",NODE_ENV:"development",DEBUG_IMAGE_RENDER_PROMPT:"1"});
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 let now=Date.parse("2031-06-01T00:00:00Z"); t.mock.method(Date,"now",()=>now);
 let moderation=0,description=0,render=0;
 const sources: { traceId: string; reusedBrief: boolean; input: { messages: { content: string }[] } }[] = [];
 const prompts: { traceId: string; prompt: string; descriptionPrompt: string }[] = [];
 t.mock.method(console, "info", (event: string, data: string) => {
  if (event === "image-description-source") sources.push(JSON.parse(data));
  if (event === "image-render-prompt") prompts.push(JSON.parse(data));
 });
 t.mock.method(globalThis,"fetch",async(input:unknown, init: RequestInit)=>{
  const url=String(input);
  if(url.endsWith("/moderations")){moderation++;return Response.json({results:[{categories:{}}]});}
  if(url.endsWith("/responses")){
   description++;
   const body=JSON.parse(String(init.body));
   assert.deepEqual(sources.at(-1)?.input, JSON.parse(body.input[0].content[0].text));
   assert.match(body.instructions, /Preserve specified visible clothing items, colors, patterns/);
   return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({title:"캐릭터",summary:"장면",prompt:"A person sitting by a window.",styleProfile:"neutral"})}]}]});
  }
  render++;
  const source = sources.at(-1)!;
  const logged = prompts.at(-1)!;
  assert.equal(logged.traceId, source.traceId);
  assert.equal(logged.prompt, JSON.parse(String(init.body)).prompt);
  assert.equal(logged.descriptionPrompt, "A person sitting by a window.");
  assert.doesNotMatch(logged.prompt, /창가에 앉아 있어요|딸기 무늬가 들어간 노란 코트를 입었어요/);
  if (render === 3) assert.match(logged.prompt, /Current user appearance data: "딸기 무늬가 들어간 노란 코트"/);
  return render < 3 ? Response.json({error:{code:"overloaded"}},{status:503}) : Response.json({error:{code:"moderation_blocked"}},{status:400});
 });
 const attempt=crypto.randomUUID();
 let token: string | null = null;
 const send=async(content:string)=>{
  now+=61000;
  const form=new FormData(); form.set("messages",JSON.stringify([{role:"user",content}]));
  if (content.includes("코트")) form.set("profile", JSON.stringify({name:"지수", age:25, personality:"다정함", concept:"친구", appearance:"딸기 무늬가 들어간 노란 코트"}));
  const response=await POST(new Request("http://localhost/api/characters",{method:"POST",headers:{"X-Image-Attempt":attempt,...(token?{"X-Image-Retry":token}:{})},body:form}));
  token=response.headers.get("X-Image-Retry");
  assert.ok(token);
  return response;
 };
 assert.equal((await send("창가에 앉아 있어요")).status,502);
 assert.equal((await send("창가에 앉아 있어요")).status,502);
 assert.deepEqual([moderation,description,render],[1,1,2]);
 assert.equal(prompts[0].prompt, prompts[1].prompt);
 assert.equal((await send("딸기 무늬가 들어간 노란 코트를 입었어요")).status,422);
 assert.equal((await send("딸기 무늬가 들어간 노란 코트를 입었어요")).status,422);
 assert.deepEqual([moderation,description,render],[2,2,3]);
 assert.equal(prompts.length, 3);
 assert.deepEqual(sources.map(source => source.reusedBrief), [false, true, false]);
});

test("image retry tokens reject tampering, expiry and a different account or request", t => {
 const original=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-key";
 t.after(()=>{if(original===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=original;});
 let now=Date.now();t.mock.method(Date,"now",()=>now);
 const retry=imageRetryToken("owner","attempt","scope","fingerprint")!;
 const token=retry.issue({approved:true,brief:{prompt:"Private description"},renderStyle:"chibi-game"})!;
 assert.doesNotMatch(Buffer.from(token,"base64url").toString(),/Private description/);
 assert.deepEqual(retry.read(token)?.brief,{prompt:"Private description"});
 assert.equal(retry.read(token)?.renderStyle,"chibi-game");
 assert.equal(retry.read(`${token[0]==="A"?"B":"A"}${token.slice(1)}`),undefined);
 for(const [owner,attempt,scope,fingerprint] of [["other","attempt","scope","fingerprint"],["owner","next","scope","fingerprint"],["owner","attempt","other","fingerprint"],["owner","attempt","scope","changed"]]) {
  assert.equal(imageRetryToken(owner,attempt,scope,fingerprint)?.read(token),undefined);
 }
 now+=3600000;assert.equal(retry.read(token),undefined);
});

test("image crops validate required focus and override visible anatomy without changing identity or canvas",()=>{
 assert.equal(framingDirection(defaultImageFraming()),"");
 assert.equal(imageFramingSchema.safeParse({shot:"detail"}).success,false);
 assert.equal(imageFramingSchema.safeParse({shot:"invalid"}).success,false);
 assert.equal(imageFramingSchema.safeParse({shot:"face",expression:"x".repeat(121)}).success,false);
 const framing=imageFramingSchema.parse({shot:"face",angle:"threeQuarter",expression:"shy smile",pose:"show all legs"});
 const prompt=buildCharacterPrompt({title:"test",summary:"test",styleProfile:"male",prompt:"A man in a blue shirt."},framing);
 assert.match(prompt,/tight face close-up/);assert.match(prompt,/three-quarter view/);
 assert.match(prompt,/shy smile/);assert.doesNotMatch(prompt,/show all legs/);

 assert.match(framingDirection(imageFramingSchema.parse({shot:"detail",focus:"hand holding a flower"})),/hand holding a flower/);
});

test("only illustrations apply camera settings; legacy creation and chat settings are ignored without extra calls",async t=>{
 const keys=["OPENAI_API_KEY","ACCOUNT_FEATURES_ENABLED","OPENAI_IMAGE_QUALITY"],before=keys.map(key=>process.env[key]);
 Object.assign(process.env,{OPENAI_API_KEY:"fixture",ACCOUNT_FEATURES_ENABLED:"false",OPENAI_IMAGE_QUALITY:"medium"});
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 let now=Date.parse("2032-01-01T00:00:00Z");t.mock.method(Date,"now",()=>now);
 const jpeg=await sharp({create:{width:720,height:1280,channels:3,background:"#bda8de"}}).jpeg().toBuffer();
 let calls=0,kind:"outfit"|"illustration"|undefined;
 const framing=imageFramingSchema.parse({shot:"face",angle:"threeQuarter",expression:"shy smile"});
 t.mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
  calls++;
  if(String(url).endsWith("/moderations")){if(kind==="illustration")assert.match(JSON.parse(String(init?.body)).input,/shy smile/);else assert.doesNotMatch(JSON.parse(String(init?.body)).input,/shy smile/);return Response.json({results:[{categories:{}}]});}
  if(String(url).endsWith("/responses")){
   const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input[0].content[0].text);
   if(kind==="illustration"){assert.match(body.instructions,/tight face close-up/);assert.deepEqual(input.framing,framing);}
   else{assert.doesNotMatch(body.instructions,/Requested framing/);assert.equal(input.framing,undefined);assert.equal(input.scene?.selection?.framing,undefined);}
   const brief={title:"새 구도",summary:"얼굴 중심",styleProfile:"male",prompt:"A man in a blue shirt.",...(kind?{characterPresent:true,pose:"standing, arms at sides",framing:"full body",sceneLocation:"cafe",locationSource:kind==="outfit"?"conversation":"narrative"}:{}),...(kind==="outfit"?{outfit:"blue shirt",outfitSource:"conversation"}:{})};
   return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(brief)}]}]});
  }
  const body=init?.body instanceof FormData?Object.fromEntries(init.body.entries()):JSON.parse(String(init?.body));
  if(kind==="illustration"){assert.match(String(body.prompt),/tight face close-up/);assert.match(String(body.prompt),/three-quarter view/);assert.match(String(body.prompt),/shy smile/);}
  else assert.doesNotMatch(String(body.prompt),/Requested framing/);
  assert.equal(body.size,"720x1280");assert.equal(body.quality,"medium");
  return Response.json({data:[{b64_json:jpeg.toString("base64")}]});
 });
 const make=()=>{const form=new FormData();form.set("messages",JSON.stringify([{role:"user",content:"민수의 얼굴을 그려줘"}]));form.set("profile",JSON.stringify({name:"민수",age:25,gender:"남성",personality:"다정함",concept:"카페의 친구"}));return form;};
 for(const value of [undefined,"outfit","illustration"] as const){
  kind=value;now+=60001;const form=make();
  if(kind){form.set("image",new Blob([jpeg],{type:"image/jpeg"}),"original.jpg");form.set("scene",JSON.stringify({kind,context:"민수는 카페 창가에 있다.",selection:{confirmed:true,location:"카페",characters:["민수"],target:"민수",profileName:"민수",userNames:["당신"],framing:kind==="illustration"?framing:{shot:"detail"}}}));}
  else form.set("framing",JSON.stringify({shot:"detail"}));
  const previous=calls,response=await POST(new Request("http://localhost/api/characters",{method:"POST",body:form}));
  assert.equal(response.status,200,response.status!==200?`${kind}: ${await response.text()}`:undefined);await response.arrayBuffer();assert.equal(calls-previous,3);
  if(kind==="illustration")assert.match(JSON.parse(decodeURIComponent(response.headers.get("X-Character-Composition")!)).framing,/tight face close-up/);
 }
 now+=60001;const invalid=make();invalid.set("scene",JSON.stringify({kind:"illustration",context:"민수는 카페에 있다.",selection:{characters:["민수"],target:"민수",framing:{shot:"detail"}}}));const previous=calls;
 assert.equal((await POST(new Request("http://localhost/api/characters",{method:"POST",body:invalid}))).status,400);assert.equal(calls,previous);
});
