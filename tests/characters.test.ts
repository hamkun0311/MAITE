import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POST } from "../app/api/characters/route.ts";
import {imageFramingSchema,framingDirection,defaultImageFraming} from "../lib/characters/framing.ts";
import { visualInstructions, visualRequestSchema, compositionSchema, OVERLAP_DIRECTION, COMPOSITION_DIRECTION } from "../lib/characters/visual.ts";
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
  const prompt = buildCharacterPrompt(brief, scene);
  assert.ok(COMPOSITION_DIRECTION.includes(OVERLAP_DIRECTION));
  assert.ok(prompt.includes(OVERLAP_DIRECTION));
  assert.match(prompt, /Preserve required contact and narrative actions/);
  assert.ok(prompt.includes(`REQUIRED NEW BODY STAGING: ${JSON.stringify(brief.pose)}`));
  assert.ok(prompt.includes(`REQUIRED CAMERA: ${JSON.stringify(brief.framing)}`));
  assert.match(prompt, /at least TWO unconstrained axes/);
  assert.match(prompt, /when sitting\/riding is required/);
  assert.ok(prompt.includes(composition.pose));
  assert.match(prompt, /AVOIDANCE metadata only/);
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
    f.set("profile", JSON.stringify({ name: "서하", age: 30, personality: "다정한 성격", concept: "도시의 비밀", genre: "막장드라마" }));
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
        if (sceneKind) {
          assert.equal(JSON.parse(body.input[0].content[0].text).scene.kind, sceneKind);
          assert.match(body.instructions, sceneKind === "outfit" ? /Change the named character's CLOTHING/ : /latest completed story scene/);
          if (sceneKind === "outfit") {
            assert.match(body.instructions, /latest ESTABLISHED current location/);
            assert.ok(body.text.format.schema.required.includes("sceneLocation"));
            assert.ok(body.text.format.schema.required.includes("outfit"));
            assert.match(body.instructions, /NOT recreating or describing the original portrait/);
            assert.doesNotMatch(body.instructions, /Preserve identity and unchanged details/);
          }
          if (sceneKind === "illustration") {
            assert.doesNotMatch(body.instructions, /Preserve identity and unchanged details/);
            assert.ok(body.text.format.schema.required.includes("sceneLocation"));
            assert.match(body.instructions, /latest ESTABLISHED current physical location/);
          }
        }
        assert.deepEqual(JSON.parse(body.input[0].content[0].text).profile, { name: "서하", age: 30, personality: "다정한 성격", concept: "도시의 비밀", genre: "막장드라마" });
        briefCalls++;
        const images = body.input[0].content.filter(
          (item: { type: string }) => item.type === "input_image",
        );
        assert.equal(images.length, includePrior && !sceneKind ? 1 : 0);
        assert.ok(body.instructions.includes("Shared rendering style:"));
        assert.ok(body.instructions.includes("variable-weight dark contours"));
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
                    prompt: profile === "female" ? "Adult woman with long hair in an elegant dress." : "A man wearing a blue coat, cheerful expression.",
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
      assert.equal(url, `https://image-gateway.example/v1/images/${includePrior && (!sceneKind || characterPresent) ? "edits" : "generations"}`);
      assert.equal(authorization, "Bearer image-gateway-key");
      if (!(options.body instanceof FormData)) {
        const body = JSON.parse(String(options.body));
        if (sceneKind === "illustration" && !characterPresent) {
          assert.match(body.prompt, /profile character is ABSENT/);
          assert.doesNotMatch(body.prompt, /FIRST input image is IDENTITY ONLY/);
        }
        assert.equal(body.model, "gpt-image-2.5-sunburst");
        assert.equal(body.size, "720x1280");
        assert.ok(body.prompt.includes(`Rendering profile: ${profile}`));
        if (profile === "male") assert.ok(body.prompt.includes("variable-weight dark contours"));
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
      if (sceneKind === "outfit") {
        assert.match(prompt, /FIRST input image is an IDENTITY reference/);
        assert.match(prompt, /reference background is NOT locked/);
        assert.match(prompt, /latest ESTABLISHED current location/);
        assert.doesNotMatch(prompt, /preserve its identity and unchanged details/i);
        assert.match(prompt, /REQUIRED CURRENT OUTFIT: "A blue coat with black trousers/);
        assert.match(prompt, /스포츠브라와 돌핀팬츠/);
        assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a clothing-store/);
      }
      if (sceneKind === "illustration") {
        assert.match(prompt, /FIRST input image is IDENTITY ONLY/);
        assert.match(prompt, /pose, gesture, expression, clothing and composition/);
        assert.match(prompt, /Do not merely replace the background/);
        assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a bookshop/);
      }
      assert.ok(prompt.includes(`Rendering profile: ${profile}`));
      assert.ok(prompt.includes("variable-weight dark contours"));
      assert.ok(!/fuller-busted|sexy mature charisma|glamorous/.test(prompt));
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
  const first = await POST(req(form()));
  assert.equal(first.status, 200);
  const result = Buffer.from(await first.arrayBuffer());
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.format, "jpeg");
  assert.equal(first.headers.get("X-Character-Width"), "720");
  assert.equal(first.headers.get("X-Character-Height"), "1280");
  assert.ok(decodeURIComponent(first.headers.get("X-Character-Prompt")!).includes("variable-weight dark contours"));
  const revision = form();
  source = await sharp(result).webp().toBuffer();
  sceneKind = "outfit";
  revision.set("scene", JSON.stringify({ kind: "outfit", context: "서하는 파란 코트를 입었다.", previousCompositions: [composition], selection: { confirmed:true, location:"체육관",outfit:"스포츠브라와 돌핀팬츠",characters:["서하"],target:"서하",profileName:"서하",userNames:["햄군"] } }));
  includePrior = true;
  revision.set("previousStyle", "female");
  revision.set(
    "image",
    new Blob([result], { type: "image/jpeg" }),
    "previous.jpg",
  );
  const revised = await POST(req(revision));
  assert.equal(revised.status, 200);
  assert.equal(revised.headers.get("Content-Type"), "image/jpeg");
  assert.equal((await sharp(Buffer.from(await revised.arrayBuffer())).metadata()).format, "jpeg");
  assert.ok(revised.headers.get("X-Character-Prompt")!.length <= 8000);
  assert.deepEqual(JSON.parse(decodeURIComponent(revised.headers.get("X-Character-Composition")!)), composition);
  sceneKind = undefined;
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
  maleRevision.set("previousStyle", "male");
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
  includePrior = false;
  profile = "neutral";
  now += 61000;
  for (const [width, height] of [[1024, 1536], [1200, 600]]) {
    source = await sharp({ create: { width, height, channels: 3, background: "#d8bd9f" } }).jpeg().toBuffer();
    const response = await POST(req(form()));
    assert.equal(response.headers.get("X-Character-Style"), "neutral");
    const output = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(output.width, 720);
    assert.equal(output.height, width === 1024 ? 1080 : 360);
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
   const body=JSON.parse(String(init.body));assert.match(body.instructions,/user explicitly chose that person as the PRIMARY subject/);
   assert.equal(JSON.parse(body.input[0].content[0].text).scene.selection.target,"민수");
   return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({title:"민수",summary:"민수의 보고",prompt:"An adult knight kneels before the king.",styleProfile:"male",characterPresent:true,...composition,sceneLocation:"A royal hall.",locationSource:"narrative"})}]}]});
  }
  assert.ok(url.endsWith("/images/generations"));assert.equal(init.body instanceof FormData,false);
  const body=JSON.parse(String(init.body));assert.match(body.prompt,/REQUIRED PRIMARY SUBJECT: "민수"/);assert.match(body.prompt,/NO character identity image is supplied/);assert.doesNotMatch(body.prompt,/FIRST input image is IDENTITY ONLY/);
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
    title:"인물",summary:"현재 장면",prompt:"A person with brown hair in a bookshop.",styleProfile:"neutral",
    ...(mode==="illustration"?{characterPresent:false,...composition,sceneLocation:"Inside a bookshop.",locationSource:"narrative"}:{})
   })}]}]});
  }
  assert.ok(url.endsWith("/images/generations"));
  assert.equal(init.body instanceof FormData,false);
  const {prompt}=JSON.parse(String(init.body));
  assert.match(prompt,/variable-weight dark contours/);
  assert.match(prompt,/Source design and cast facts/);
  if(mode==="illustration"){
   assert.match(prompt,/엘리는 분홍색 머리의 사제다/);
   assert.match(prompt,/NO character identity image is supplied/);
   assert.doesNotMatch(prompt,/검은 머리/);
  }else{
   assert.match(prompt,mode==="female"?/Rendering profile: female/:/Rendering profile: male/);
   assert.match(prompt,/검은 머리/);
   assert.match(prompt,/파란 코트/);
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
  assert.match(visualInstructions({ kind: "outfit", context: "파란 코트" }), /Preserve their identity/);
  assert.match(visualInstructions({ kind: "illustration", context: "서점" }), /latest completed story scene/);
});

test("outfit changes prioritize the current store over an older workshop at both image stages", () => {
  const scene = { kind: "outfit" as const, context: "작업실을 나와 백화점 의류 매장에 도착했다. 피팅룸에서 파란 원피스로 갈아입었다. 다음에는 카페로 가기로 했다." };
  const instructions = visualInstructions(scene);
  assert.match(instructions, /latest ESTABLISHED current location/);
  assert.match(instructions, /not a future destination, recollection/);
  assert.match(instructions, /retain the reference setting rather than inventing a move/);
  for (const styleProfile of ["female", "male", "neutral"] as const) {
    const prompt = buildCharacterPrompt({ ...composition, title: "백화점의 새 의상", summary: "의류 매장에서 갈아입었다", prompt: "A woman in a blue dress in a department-store fitting area, mirrors and clothing racks.", styleProfile, sceneLocation: "Inside a department-store fitting room with mirrors and racks.", locationSource: "conversation", outfit: "A blue one-piece dress without a work apron.", outfitSource: "conversation" }, scene);
    assert.match(prompt, /department-store fitting area/);
    assert.match(prompt, /reference background is NOT locked/);
    assert.doesNotMatch(prompt, /preserve its identity and unchanged details/i);
  }
});

test("outfit briefs require both wardrobe and location and override a stale cafe subject", () => {
  const scene = { kind: "outfit" as const, context: "카페를 나와 옷가게 피팅룸에서 파란 원피스를 입었다." };
  const stale = { title: "카페 근무복", summary: "예전 설명", prompt: "Cafe worker wearing an apron and holding a coffee drink behind a cafe counter.", styleProfile: "female" as const };
  assert.equal(outfitBrief.safeParse(stale).success, false);
  assert.throws(() => buildCharacterPrompt(stale, scene));
  const brief = outfitBrief.parse({ ...stale, ...composition, sceneLocation: "Inside a clothing-store fitting room with mirrors and clothing racks.", locationSource: "conversation", outfit: "A blue one-piece dress, no work apron.", outfitSource: "conversation" });
  const prompt = buildCharacterPrompt(brief, scene);
  assert.match(prompt, /REQUIRED CURRENT OUTFIT: "A blue one-piece dress/);
  assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a clothing-store/);
  assert.match(prompt, /override the reference image's outfit, background/);
  assert.match(prompt, /do not layer the new dress over the old uniform/);
});

test("illustration location is required separately and carried to the final image prompt", () => {
  const scene = { kind: "illustration" as const, context: "서하는 카페 창가에 앉아 커피를 마셨다. 작업실에서의 사건을 회상했다. 내일은 서점에 갈 계획이다." };
  const brief = { title: "카페의 대화", summary: "카페 창가에서 나눈 대화", prompt: "A woman recalling an incident in her workshop.", styleProfile: "female" as const };
  assert.equal(illustrationBrief.safeParse(brief).success, false);
  assert.throws(() => buildCharacterPrompt(brief, scene));
  const prompt = buildCharacterPrompt({ ...brief, ...composition, sceneLocation: "Inside a cafe, seated at a window table with coffee cups and a pastry display.", locationSource: "narrative" }, scene);
  assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a cafe/);
  assert.match(prompt, /takes precedence over any conflicting background/);
  assert.match(prompt, /not an earlier scene in the chapter/);
  assert.match(prompt, /flashbacks, another person's location and future destinations/);
  assert.match(prompt, /reference background is NOT locked/);
});
test("style-only prompts preserve requested subject without gender defaults", () => {
  const base = {
    title: "test",
    summary: "test",
    prompt: "A quiet boy in a blue raincoat beside a cat, serious expression.",
    styleProfile: "male" as const,
  };
  const prompt = buildCharacterPrompt(characterBrief.parse(base));
  assert.ok(prompt.endsWith(base.prompt));
  assert.ok(prompt.includes("2D anime"));
  assert.ok(prompt.includes("variable-weight dark contours"));
  const female = buildCharacterPrompt({ ...base, styleProfile: "female" });
  assert.ok(female.includes("warm luminous skin"));
  assert.equal(female.replace("Rendering profile: female","Rendering profile: male"),prompt);
  const neutral = buildCharacterPrompt({ ...base, styleProfile: "neutral" });
  assert.ok(!neutral.includes("STYLE ONLY"));
  assert.ok(!/fuller-busted|glamorous|sexy|Clearly adult|golden highlights|emerald accents/.test(prompt));
  assert.ok(!/[\r\n]/.test(prompt));
  assert.throws(() =>
    characterBrief.parse({ ...base, prompt: "x".repeat(801) }),
  );
});

test("image crops validate required focus and override visible anatomy without changing identity or canvas",()=>{
 assert.equal(framingDirection(defaultImageFraming()),"");
 assert.equal(imageFramingSchema.safeParse({shot:"detail"}).success,false);
 assert.equal(imageFramingSchema.safeParse({shot:"invalid"}).success,false);
 assert.equal(imageFramingSchema.safeParse({shot:"face",expression:"x".repeat(121)}).success,false);
 const framing=imageFramingSchema.parse({shot:"face",angle:"threeQuarter",expression:"shy smile",pose:"show all legs"});
 const prompt=buildCharacterPrompt({title:"test",summary:"test",styleProfile:"male",prompt:"A man in a blue shirt."},undefined,framing);
 assert.match(prompt,/tight face close-up/);assert.match(prompt,/three-quarter view/);assert.match(prompt,/9:16/);
 assert.match(prompt,/shy smile/);assert.doesNotMatch(prompt,/show all legs/);
 assert.match(prompt,/do not zoom out/);assert.match(prompt,/Preserve identity, age/);
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
   else{assert.doesNotMatch(body.instructions,/USER IMAGE FRAMING/);assert.equal(input.framing,undefined);assert.equal(input.scene?.selection?.framing,undefined);}
   const brief={title:"새 구도",summary:"얼굴 중심",styleProfile:"male",prompt:"A man in a blue shirt.",...(kind?{characterPresent:true,pose:"standing, arms at sides",framing:"full body",sceneLocation:"cafe",locationSource:kind==="outfit"?"conversation":"narrative"}:{}),...(kind==="outfit"?{outfit:"blue shirt",outfitSource:"conversation"}:{})};
   return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(brief)}]}]});
  }
  const body=init?.body instanceof FormData?Object.fromEntries(init.body.entries()):JSON.parse(String(init?.body));
  if(kind==="illustration"){assert.match(String(body.prompt),/tight face close-up/);assert.match(String(body.prompt),/three-quarter view/);assert.match(String(body.prompt),/only visible outfit details|only visible clothing details/);}
  else assert.doesNotMatch(String(body.prompt),/USER IMAGE FRAMING/);
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
