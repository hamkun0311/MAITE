import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POST } from "../app/api/characters/route.ts";
import {
  MAX_CHARACTER_REQUEST,
  buildCharacterPrompt,
  characterBrief,
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
  const source = await sharp({
    create: { width: 720, height: 1280, channels: 3, background: "#d8bd9f" },
  })
    .jpeg()
    .toBuffer();
  let calls = 0,
    blocks = false,
    briefCalls = 0;
  let includePrior = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls++;
      if (url.endsWith("/moderations"))
        return Response.json({
          results: [{ categories: { "sexual/minors": blocks } }],
        });
      if (url.endsWith("/responses")) {
        const body = JSON.parse(String(options.body));
        briefCalls++;
        const images = body.input[0].content.filter(
          (item: { type: string }) => item.type === "input_image",
        );
        assert.equal(images.length, includePrior ? 1 : 0);
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
  const first = await POST(req(form()));
  assert.equal(first.status, 200);
  const result = Buffer.from(await first.arrayBuffer());
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.format, "jpeg");
  assert.ok(first.headers.get("X-Character-Prompt")!.includes("STYLE ONLY"));
  const revision = form();
  includePrior = true;
  revision.set("previousStyle", "female");
  revision.set(
    "image",
    new Blob([result], { type: "image/jpeg" }),
    "previous.jpg",
  );
  assert.equal((await POST(req(revision))).status, 200);
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
  maleRevision.set("image", new Blob([result], { type: "image/jpeg" }), "previous.jpg");
  maleRevision.set("previousStyle", "male");
  includePrior = true;
  assert.equal((await POST(req(maleRevision))).status, 200);
  includePrior = false;
  profile = "neutral";
  assert.equal((await POST(req(form()))).headers.get("X-Character-Style"), "neutral");
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
