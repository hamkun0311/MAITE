import { imageDescriptionReasoningOptions, imageQuality, textModel } from "../../../lib/ai-model.ts";
import { withGeneration, preflight } from "../../../lib/server/generation.ts";
import { allowedOrigin } from "../../../lib/server/http.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { trackUsage, type UsageRecord } from "../../../lib/usage.ts";
import { characterProfileSchema } from "../../../lib/chat/character.ts";
import { ILLUSTRATION_DIRECTION, OVERLAP_DIRECTION, COMPOSITION_DIRECTION, compositionSchema, OUTFIT_DIRECTION, visualInstructions, visualRequestSchema, confirmedIllustrationTarget } from "../../../lib/characters/visual.ts";
import {
  characterMessages,
  characterBrief,
  illustrationBrief,
  outfitBrief,
  CHARACTER_DIRECTION,
  MAX_CHARACTER_IMAGE,
  MAX_CHARACTER_REQUEST,
  CHARACTER_WIDTH,
  CHARACTER_HEIGHT,
  CHARACTER_SIZE,
  CHARACTER_STYLES,
  characterStyleProfile,
  buildCharacterPrompt,
  isJpeg,
} from "../../../lib/characters/schema.ts";

export const runtime = "nodejs";
export const maxDuration = 300;
const usage: { count: number; until: number } = { count: 0, until: 0 };
class RequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new RequestError("요청 형식이 올바르지 않습니다.", 400);
  if (Number(request.headers.get("content-length")) > MAX_CHARACTER_REQUEST)
    throw new RequestError(
      "이미지가 너무 큽니다. 새 대화에서 다시 시작해주세요.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("요청 내용이 없습니다.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_CHARACTER_REQUEST) {
        await reader.cancel();
        throw new RequestError("요청 크기를 초과했습니다.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
}
async function checked(response: Response, finish?: ReturnType<typeof trackUsage>) {
  const data = response.ok ? await response.json() : await response.json().catch(() => null);
  finish?.(data, response.ok && (!data?.status || data.status === "completed") ? "completed" : "failed");
  if (response.ok) return data;
  const code = data?.error?.code;
  if (code === "content_policy_violation" || code === "moderation_blocked")
    throw new RequestError(
      "이 요청으로는 이미지를 만들 수 없습니다. 의상이나 장면 설명을 바꿔주세요.",
      422,
    );
  if (response.status === 429)
    throw new RequestError(
      "이미지 생성 요청이 많거나 API 사용량 한도에 도달했습니다. 잠시 후 다시 시도해주세요.",
      429,
    );
  throw new RequestError(
    "이미지 생성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
    502,
  );
}
export const OPTIONS = preflight;
export const POST = withGeneration(handle, true);
async function handle(request: Request) {
  const records = new Map<string, UsageRecord>();
  const usageHeaders = (): Record<string, string> => request.headers.get("X-Track-Usage") === "1" ? { "X-Token-Usage": JSON.stringify([...records.values()]) } : {};
  async function measured(feature: string, model: string, url: string, init: RequestInit) {
    const finish = trackUsage(feature, model, record => { records.set(record.id, record); });
    try { return await checked(await fetch(url, init), finish); }
    catch (error) { finish(undefined, "unknown"); throw error; }
  }
  try {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(request))
      throw new RequestError("허용되지 않은 요청입니다.", 403);
    const key = process.env.OPENAI_API_KEY;
    if (!key)
      throw new RequestError("서버의 OPENAI_API_KEY를 설정해주세요.", 503);
    const now = Date.now();
    if (now > usage.until) {
      usage.count = 0;
      usage.until = now + 60000;
    }
    if (usage.count >= 3)
      throw new RequestError(
        "잠시 후 다시 생성해주세요. 분당 3회까지 요청할 수 있습니다.",
        429,
      );
    const form = await readForm(request);
    const messages = characterMessages.parse(
      JSON.parse(String(form.get("messages") || "null")),
    );
    const profile = form.has("profile") ? characterProfileSchema.parse(JSON.parse(String(form.get("profile")))) : undefined;
    const scene = form.has("scene") ? visualRequestSchema.parse(JSON.parse(String(form.get("scene")))) : undefined;
    if (messages.at(-1)?.role !== "user")
      throw new RequestError("캐릭터 설명을 입력해주세요.", 400);
    const priorProfile = form.get("previousStyle");
    const previousStyle = priorProfile === null ? null : characterStyleProfile.parse(priorProfile);
    const prior = form.get("image");
    if (scene && (!profile || !(prior instanceof File)))
      throw new RequestError("삽화와 의상 변경에는 캐릭터 설정과 원본 이미지가 필요합니다.", 400);
    if (prior !== null && !(prior instanceof File))
      throw new RequestError("이미지 형식이 올바르지 않습니다.", 400);
    if (prior instanceof File) {
      if (
        prior.size > MAX_CHARACTER_IMAGE ||
        prior.type !== "image/jpeg" ||
        !isJpeg(new Uint8Array(await prior.arrayBuffer()))
      )
        throw new RequestError(
          "이전 이미지 형식을 확인해주세요. JPEG 이미지만 지원합니다.",
          400,
        );
    }
    usage.count++;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(270000),
    ]);
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    // Reject sexual-minor requests rather than silently reinterpreting them as adult designs.
    const moderation = await checked(
      await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: [profile ? JSON.stringify(profile) : "", scene?.context || "", scene?.selection ? JSON.stringify(scene.selection) : "", ...messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)]
            .join("\n"),
        }),
      }),
    );
    if (
      moderation.results?.some(
        (r: { categories?: Record<string, boolean> }) =>
          r.categories?.["sexual/minors"],
      )
    )
      throw new RequestError(
        "이 요청으로는 이미지를 만들 수 없습니다. 캐릭터의 외형과 의상을 비성적인 내용으로 설명해주세요.",
        422,
      );
    const previousData =
      prior instanceof File
        ? Buffer.from(await prior.arrayBuffer()).toString("base64")
        : null;
    const briefSchema = scene?.kind === "illustration" ? illustrationBrief : scene?.kind === "outfit" ? outfitBrief : characterBrief;
    const briefResponse = await measured("image.description", textModel(),
      "https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          model: textModel(),
          ...imageDescriptionReasoningOptions(),
          store: false,
          max_output_tokens: 5000,
          instructions:
            (scene?.kind === "illustration" ? ILLUSTRATION_DIRECTION : scene?.kind === "outfit" ? OUTFIT_DIRECTION : CHARACTER_DIRECTION) +
            " Reference style analysis: " +
            JSON.stringify(CHARACTER_STYLES) +
            (profile?.appearance ? " Use profile.appearance for the explicitly requested physical features only when the profile character is present. In scene images, never transfer an absent profile character's appearance to a counterpart. For a present profile character, current scene clothing, pose and location override initial outfit or setting. " : "") +
            " If profile.gender is 남성 or 여성, use that explicit gender when selecting the rendering profile and resolving identity. Use the actual described subjects/concept for appearance and rendering. Do not add gender-based stereotypes." +
            (scene ? "" : " " + OVERLAP_DIRECTION) + (scene ? " The profile's concept is backstory only. scene.context is the current scene; preserve previousStyle unless an explicit gender change requires another rendering profile. " : " Resolve the full revised subject from the conversation, supplied character profile, and any previous result. The profile defines the character's name, age, personality, concept and genre; reflect these in age-appropriate appearance, expression and setting. Match the selected genre's atmosphere (romance, slice of life, healing, fantasy, adventure, mystery, thriller, comedy, science fiction or makjang melodrama with dramatic expressions and tense relationships) while preserving the user's specific concept and setting. Do not add gender-based appearance defaults.") + visualInstructions(scene) + (scene ? " " + COMPOSITION_DIRECTION : ""),
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: JSON.stringify({ messages, profile, previousStyle, scene }) },
                ...(previousData && !scene
                  ? [
                      {
                        type: "input_image",
                        image_url: `data:image/jpeg;base64,${previousData}`,
                        detail: "low",
                      },
                    ]
                  : []),
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "character_brief",
              strict: true,
              schema: z.toJSONSchema(briefSchema),
            },
          },
        }),
      },
    );
    if (briefResponse.status !== "completed")
      throw new RequestError(
        "캐릭터 설명을 정리하지 못했습니다. 요청을 간단하게 다시 작성해주세요.",
        422,
      );
    const output = briefResponse.output
      ?.flatMap(
        (item: { content?: { type: string; text?: string }[] }) =>
          item.content || [],
      )
      .find((c: { type: string }) => c.type === "output_text")?.text;
    const brief = briefSchema.parse(JSON.parse(output || "null"));
    const target = confirmedIllustrationTarget(scene);
    // A manually selected counterpart must never inherit the original character's identity image.
    if (target && target !== profile?.name && "characterPresent" in brief) brief.characterPresent = false;
    const prompt = buildCharacterPrompt(brief, scene);
    const parameters = {
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst",
      prompt, size: CHARACTER_SIZE,
      quality: imageQuality(),
      output_format: "jpeg", output_compression: 85, n: 1,
    };
    const useStyleImage = brief.styleProfile === "female" && !scene;
    const useIdentity = prior instanceof File && (!scene || (scene.kind === "illustration" ? illustrationBrief.parse(brief).characterPresent : outfitBrief.parse(brief).characterPresent));
    const useEdit = useStyleImage || useIdentity;
    let imageBody: FormData | string;
    if (useEdit) {
      const imageForm = new FormData();
      for (const [name, value] of Object.entries(parameters)) imageForm.set(name, String(value));
      if (useIdentity && prior instanceof File) imageForm.append("image[]", prior, "previous-character.jpg");
      if (useStyleImage) {
        const reference = await readFile(path.join(process.cwd(), "public/references/anime-style.png"));
        imageForm.append("image[]", new Blob([reference], { type: "image/png" }), "style-reference.png");
      }
      imageBody = imageForm;
    } else imageBody = JSON.stringify(parameters);
    const generated = await measured("image.generate", parameters.model,
      `https://api.openai.com/v1/images/${useEdit ? "edits" : "generations"}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          ...(!useEdit ? { "Content-Type": "application/json" } : {}),
        },
        body: imageBody,
        signal,
      },
    );
    const encoded = generated.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > 16_000_000)
      throw new RequestError(
        "이미지를 전달하지 못했습니다. 다시 시도해주세요.",
        502,
      );
    const raw = Buffer.from(encoded, "base64");
    if (!isJpeg(raw))
      throw new RequestError("이미지 응답 형식이 올바르지 않습니다.", 502);
    const { data: image, info } = await sharp(raw, { limitInputPixels: 16_777_216 })
      .resize(CHARACTER_WIDTH, CHARACTER_HEIGHT, {
        fit: "inside",
      })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (image.length > MAX_CHARACTER_IMAGE)
      throw new RequestError("이미지 크기 제한을 초과했습니다.", 502);
    return new Response(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Character-Title": encodeURIComponent(brief.title),
        "X-Character-Summary": encodeURIComponent(brief.summary),
        "X-Character-Prompt": encodeURIComponent(prompt),
        "X-Character-Style": brief.styleProfile,
        ...(scene ? { "X-Character-Composition": encodeURIComponent(JSON.stringify(compositionSchema.strip().parse(brief))) } : {}),
        "X-Character-Width": String(info.width),
        "X-Character-Height": String(info.height),
        ...usageHeaders(),
      },
    });
  } catch (error) {
    const status =
      error instanceof RequestError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof Error &&
              (error.name === "AbortError" || error.name === "TimeoutError")
            ? 504
            : 500;
    return Response.json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : status === 400
              ? "캐릭터 요청 형식을 확인해주세요."
              : status === 504
                ? "이미지 생성 시간이 초과되었거나 취소되었습니다. 다시 시도해주세요."
                : "이미지를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
      },
      { status, headers: { "Cache-Control": "no-store", ...usageHeaders() } },
    );
  }
}
