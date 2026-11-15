import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POST } from "../app/api/characters/route.ts";
import { visualInstructions, visualRequestSchema } from "../lib/characters/visual.ts";
import {
  MAX_CHARACTER_REQUEST,
  buildCharacterPrompt,
  characterBrief,
  illustrationBrief,
  outfitBrief,
} from "../lib/characters/schema.ts";

test("GPT Image route sends separate style and revision references and returns a real 720x1280 JPEG", async (t) => {
  const names = [
    "OPENAI_API_KEY",
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
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_IMAGE_QUALITY;
  let source = await sharp({
    create: { width: 720, height: 1280, channels: 3, background: "#d8bd9f" },
  })
    .jpeg()
    .toBuffer();
  let calls = 0,
    blocks = false,
    briefCalls = 0;
  let includePrior = false;
  let sceneKind: "outfit" | "illustration" | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls++;
      if (url.endsWith("/moderations")) {
        assert.match(JSON.parse(String(options.body)).input, /다정한 성격/);
        if (sceneKind) assert.match(JSON.parse(String(options.body)).input, /파란 코트|서점/);
        return Response.json({
          results: [{ categories: { "sexual/minors": blocks } }],
        });
      }
      if (url.endsWith("/responses")) {
        const body = JSON.parse(String(options.body));
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
        assert.ok(body.instructions.includes("Reference style analysis:"));
        assert.ok(body.instructions.includes("fine tapered dark linework"));
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
                    ...(sceneKind === "illustration" ? { sceneLocation: "Inside a bookshop, bookshelves beside a reading table.", locationSource: "narrative" } : {}),
                    ...(sceneKind === "outfit" ? { sceneLocation: "Inside a clothing-store fitting room with mirrors and racks.", locationSource: "conversation", outfit: "A blue coat with black trousers.", outfitSource: "conversation" } : {}),
                  }),
                },
              ],
            },
          ],
        });
      }
      assert.equal(url, `https://api.openai.com/v1/images/${profile === "female" || includePrior ? "edits" : "generations"}`);
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer fake-openai",
      );
      if (!(options.body instanceof FormData)) {
        const body = JSON.parse(String(options.body));
        assert.equal(body.model, "gpt-image-2.5-sunburst");
        assert.equal(body.size, "720x1280");
        assert.ok(body.prompt.includes(`Rendering profile: ${profile}`));
        if (profile === "male") assert.ok(body.prompt.includes("fine tapered dark linework"));
        assert.ok(!body.prompt.includes("LAST input image is STYLE ONLY"));
        return Response.json({ data: [{ b64_json: source.toString("base64") }] });
      }
      const body = options.body;
      assert.equal(body.get("model"), "gpt-image-2.5-sunburst");
      assert.equal(body.get("size"), "720x1280");
      assert.equal(body.get("quality"), "low");
      assert.equal(body.get("output_format"), "jpeg");
      assert.equal(body.has("steps"), false);
      const prompt = String(body.get("prompt"));
      if (sceneKind === "outfit") {
        assert.match(prompt, /FIRST input image is an IDENTITY reference/);
        assert.match(prompt, /reference background is NOT locked/);
        assert.match(prompt, /latest ESTABLISHED current location/);
        assert.doesNotMatch(prompt, /preserve its identity and unchanged details/i);
        assert.match(prompt, /REQUIRED CURRENT OUTFIT: "A blue coat with black trousers/);
        assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a clothing-store/);
      }
      if (sceneKind === "illustration") {
        assert.match(prompt, /FIRST input image is IDENTITY ONLY/);
        assert.match(prompt, /pose, gesture, expression, clothing and composition/);
        assert.match(prompt, /Do not merely replace the background/);
        assert.match(prompt, /REQUIRED CURRENT SCENE LOCATION: "Inside a bookshop/);
      }
      assert.ok(prompt.includes(`Rendering profile: ${profile}`));
      if (profile === "female") {
        assert.ok(prompt.includes("STYLE ONLY"));
        assert.ok(prompt.includes("Adult woman with long hair in an elegant dress."));
      } else {
        assert.ok(prompt.includes("fine tapered dark linework"));
        assert.ok(!prompt.includes("LAST input image is STYLE ONLY"));
      }
      assert.ok(!/fuller-busted|sexy mature charisma|glamorous/.test(prompt));
      const images = body.getAll("image[]") as File[];
      assert.equal(images.length, (profile === "female" ? 1 : 0) + (includePrior ? 1 : 0));
      if (profile === "female") {
        assert.equal(images.at(-1)!.name, "style-reference.png");
        assert.equal(images.at(-1)!.type, "image/png");
        assert.ok(images.at(-1)!.size > 1000);
      }
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
  assert.ok(first.headers.get("X-Character-Prompt")!.includes("STYLE ONLY"));
  const revision = form();
  sceneKind = "outfit";
  revision.set("scene", JSON.stringify({ kind: "outfit", context: "서하는 파란 코트를 입었다." }));
  includePrior = true;
  revision.set("previousStyle", "female");
  revision.set(
    "image",
    new Blob([result], { type: "image/jpeg" }),
    "previous.jpg",
  );
  assert.equal((await POST(req(revision))).status, 200);
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
    const prompt = buildCharacterPrompt({ title: "백화점의 새 의상", summary: "의류 매장에서 갈아입었다", prompt: "A woman in a blue dress in a department-store fitting area, mirrors and clothing racks.", styleProfile, sceneLocation: "Inside a department-store fitting room with mirrors and racks.", locationSource: "conversation", outfit: "A blue one-piece dress without a work apron.", outfitSource: "conversation" }, scene);
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
  const brief = outfitBrief.parse({ ...stale, sceneLocation: "Inside a clothing-store fitting room with mirrors and clothing racks.", locationSource: "conversation", outfit: "A blue one-piece dress, no work apron.", outfitSource: "conversation" });
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
  const prompt = buildCharacterPrompt({ ...brief, sceneLocation: "Inside a cafe, seated at a window table with coffee cups and a pastry display.", locationSource: "narrative" }, scene);
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
  assert.ok(prompt.includes("fine tapered dark linework"));
  const female = buildCharacterPrompt({ ...base, styleProfile: "female" });
  assert.ok(female.includes("warm luminous finish"));
  assert.ok(!female.includes("fine tapered dark linework"));
  const neutral = buildCharacterPrompt({ ...base, styleProfile: "neutral" });
  assert.ok(!neutral.includes("STYLE ONLY"));
  assert.ok(!/fuller-busted|glamorous|sexy|Clearly adult|golden highlights|emerald accents/.test(prompt));
  assert.ok(!/[\r\n]/.test(prompt));
  assert.throws(() =>
    characterBrief.parse({ ...base, prompt: "x".repeat(801) }),
  );
});
