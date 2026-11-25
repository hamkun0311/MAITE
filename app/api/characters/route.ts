import { imageDescriptionReasoningOptions, imageQuality, textModel } from "../../../lib/ai-model.ts";
import { openAIImageEndpoint, openAIImageKey, openAIResponsesEndpoint, openAITextKey } from "../../../lib/openai-endpoint.ts";
import { blocksImageGeneration, GENERATION_POLICY_MESSAGE } from "../../../lib/generation-policy.ts";
import { withGeneration, preflight } from "../../../lib/server/generation.ts";
import { allowedOrigin } from "../../../lib/server/http.ts";
import { imageAttempt, imageFingerprint } from "../../../lib/server/image-checkpoints.ts";
import { imageRetryToken, type ImageRetryProgress } from "../../../lib/server/image-retry-token.ts";
import sharp from "sharp";
import { z } from "zod";
import { trackUsage, type UsageRecord } from "../../../lib/usage.ts";
import { characterProfileSchema } from "../../../lib/chat/character.ts";
import {imageFramingSchema,framingDirection,requestedCamera} from "../../../lib/characters/framing.ts";
import { compositionSchema, visualInstructions, visualRequestSchema, confirmedIllustrationTarget } from "../../../lib/characters/visual.ts";
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
  characterStyleProfile,
  buildCharacterPrompt,
  isJpeg,
} from "../../../lib/characters/schema.ts";

export const runtime = "nodejs";
export const maxDuration = 300;
const usage: { count: number; until: number } = { count: 0, until: 0 };
class RequestError extends Error {
  readonly status: number;
  readonly policyRejected: boolean;
  constructor(message: string, status: number, policyRejected = false) {
    super(message);
    this.status = status;
    this.policyRejected = policyRejected;
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
      true,
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
// The full design goes to the renderer. Limit the client-facing diagnostic header.
function promptPreview(prompt: string) {
  let preview = "";
  for (const char of prompt) {
    const encoded = encodeURIComponent(char);
    if (preview.length + encoded.length > 8000) break;
    preview += encoded;
  }
  return preview;
}

export const OPTIONS = preflight;
export const POST = withGeneration(handle, true);
async function handle(request: Request, _story?: unknown, owner?: string) {
  let retry: ReturnType<typeof imageRetryToken>;
  let progress: ImageRetryProgress = {};
  const records = new Map<string, UsageRecord>();
  const usageHeaders = (): Record<string, string> => request.headers.get("X-Track-Usage") === "1" ? { "X-Token-Usage": JSON.stringify([...records.values()]) } : {};
  const retryHeaders = (): Record<string, string> => {
    const token = retry?.issue(progress);
    return token ? { "X-Image-Retry": token } : {};
  };
  async function measured(feature: string, model: string, url: string, init: RequestInit) {
    const finish = trackUsage(feature, model, record => { records.set(record.id, record); });
    try { return await checked(await fetch(url, init), finish); }
    catch (error) { finish(undefined, "unknown"); throw error; }
  }
  try {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(request))
      throw new RequestError("허용되지 않은 요청입니다.", 403);
    const key = openAITextKey();
    const imageKey = openAIImageKey();
    const moderationKey = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new RequestError("서버에 GPT API 키를 설정해주세요.", 503);
    if (!imageKey) throw new RequestError("서버에 OPENAI_IMAGE_API_KEY를 설정해주세요.", 503);
    if (!moderationKey) throw new RequestError("이미지 안전 검사용 OPENAI_API_KEY를 설정해주세요.", 503);
    const responsesEndpoint = openAIResponsesEndpoint();
    const generateEndpoint = openAIImageEndpoint("generations");
    const editEndpoint = openAIImageEndpoint("edits");
    const now = Date.now();
    if (now > usage.until) {
      usage.count = 0;
      usage.until = now + 60000;
    }
    const form = await readForm(request);
    const messages = characterMessages.parse(
      JSON.parse(String(form.get("messages") || "null")),
    );
    const profile = form.has("profile") ? characterProfileSchema.parse(JSON.parse(String(form.get("profile")))) : undefined;
    const sceneInput=form.has("scene")?JSON.parse(String(form.get("scene"))):undefined;
    // Old tabs may still send crop settings: only novel illustrations use them.
    if(sceneInput?.kind!=="illustration"&&sceneInput?.selection&&typeof sceneInput.selection==="object"&&!Array.isArray(sceneInput.selection)){
      const {framing:_ignored,...selection}=sceneInput.selection;sceneInput.selection=selection;
    }
    const scene = form.has("scene") ? visualRequestSchema.parse(sceneInput) : undefined;
    const framing=scene?.kind==="illustration"?(form.has("framing")?imageFramingSchema.parse(JSON.parse(String(form.get("framing")))):scene.selection?.framing):undefined;
    if (messages.at(-1)?.role !== "user")
      throw new RequestError("캐릭터 설명을 입력해주세요.", 400);
    const priorProfile = form.get("previousStyle");
    if (priorProfile !== null) characterStyleProfile.parse(priorProfile);
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
    const attempt = imageAttempt(request);
    if (blocksImageGeneration({messages, profile, scene})) throw new RequestError(GENERATION_POLICY_MESSAGE, 422);
    if (attempt) retry = imageRetryToken(owner, attempt.attempt, attempt.scope, await imageFingerprint(form));
    progress = retry?.read(request.headers.get("X-Image-Retry")) ?? {};
    if (progress.rejection) throw new RequestError(progress.rejection, 422);
    if (usage.count >= 3) throw new RequestError("잠시 후 다시 생성해주세요. 분당 3회까지 요청할 수 있습니다.", 429);
    usage.count++;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(270000),
    ]);
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (!progress.approved) {
      const moderation = await checked(
        await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          redirect: "error",
          headers: { ...headers, Authorization: `Bearer ${moderationKey}` },
          signal,
          body: JSON.stringify({
            model: "omni-moderation-latest",
            input: [profile ? JSON.stringify(profile) : "", scene?.context || "", scene?.selection ? JSON.stringify(scene.selection) : "", framing?JSON.stringify(framing):"", ...messages
              .filter((m) => m.role === "user")
              .map((m) => m.content)]
              .join("\n"),
          }),
        }),
      );
      if (moderation.results?.some((r: { categories?: Record<string, boolean> }) => r.categories?.["sexual/minors"])) {
        throw new RequestError("이 요청으로는 이미지를 만들 수 없습니다. 캐릭터의 외형과 의상을 비성적인 내용으로 설명해주세요.", 422, true);
      }
      if (Array.isArray(moderation.results) && moderation.results.length) progress.approved = true;
    }
    const briefSchema = scene?.kind === "illustration" ? illustrationBrief : scene?.kind === "outfit" ? outfitBrief : characterBrief;
    const savedBrief = briefSchema.safeParse(progress.approved ? progress.brief : undefined);
    const brief = savedBrief.success ? savedBrief.data : await (async () => {
      const sceneDetails = scene && { kind: scene.kind, context: scene.context, selection: scene.selection };
      const previousData = prior instanceof File && !scene ? Buffer.from(await prior.arrayBuffer()).toString("base64") : null;
      const briefResponse = await measured("image.description", textModel(),
        responsesEndpoint, {
          method: "POST",
          redirect: "error",
          headers,
          signal,
          body: JSON.stringify({
            model: textModel(),
            ...imageDescriptionReasoningOptions(),
            store: false,
            max_output_tokens: 5000,
            instructions: CHARACTER_DIRECTION + (scene ? visualInstructions(scene) : "") + framingDirection(framing),
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: JSON.stringify({ messages, profile, scene: sceneDetails, framing }) },
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
      const parsed = briefSchema.parse(JSON.parse(output || "null"));
      progress.brief = parsed;
      return parsed;
    })();
    const camera=requestedCamera(framing);
    if(camera&&"framing" in brief)brief.framing=camera;
    // Keep the saved cast classification consistent with an explicit profile gender.
    if (!scene && brief.styleProfile !== "mixed" && profile?.gender === "여성") brief.styleProfile = "female";
    if (!scene && brief.styleProfile !== "mixed" && profile?.gender === "남성") brief.styleProfile = "male";
    const target = confirmedIllustrationTarget(scene);
    // A manually selected counterpart must never inherit the original character's identity image.
    if (target && target !== profile?.name && "characterPresent" in brief) brief.characterPresent = false;
    const useIdentity = prior instanceof File && (!scene || (scene.kind === "illustration" ? illustrationBrief.parse(brief).characterPresent : outfitBrief.parse(brief).characterPresent));
    const prompt = buildCharacterPrompt(brief, framing, useIdentity, scene?.selection);
    const parameters = {
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst",
      prompt, size: CHARACTER_SIZE,
      quality: imageQuality(),
      output_format: "jpeg", output_compression: 85, n: 1,
    };
    let imageBody: FormData | string;
    if (useIdentity && prior instanceof File) {
      const imageForm = new FormData();
      for (const [name, value] of Object.entries(parameters)) imageForm.set(name, String(value));
      imageForm.append("image[]", prior, "previous-character.jpg");
      imageBody = imageForm;
    } else imageBody = JSON.stringify(parameters);
    if (process.env.NODE_ENV === "development" && process.env.DEBUG_IMAGE_RENDER_PROMPT === "1") {
      console.info("image-render-prompt", JSON.stringify({
        model: parameters.model,
        endpoint: useIdentity ? "edits" : "generations",
        kind: scene?.kind ?? "character",
        hasReferenceImage: useIdentity,
        prompt: parameters.prompt,
      }));
    }
    const generated = await measured("image.generate", parameters.model,
      useIdentity ? editEndpoint : generateEndpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${imageKey}`,
          ...(!useIdentity ? { "Content-Type": "application/json" } : {}),
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
    const png = raw.length >= 8 && raw.readUInt32BE(0) === 0x89504e47 && raw.readUInt32BE(4) === 0x0d0a1a0a;
    const webp = raw.length >= 12 && raw.toString("ascii", 0, 4) === "RIFF" && raw.toString("ascii", 8, 12) === "WEBP";
    if (!isJpeg(raw) && !png && !webp)
      throw new RequestError("이미지 응답 형식이 올바르지 않습니다.", 502);
    const { data: image, info } = await sharp(raw, { limitInputPixels: 16_777_216 })
      .resize(CHARACTER_WIDTH, CHARACTER_HEIGHT, {
        fit: "inside",
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
      .catch(() => { throw new RequestError("이미지 응답 형식이 올바르지 않습니다.", 502); });
    if (image.length > MAX_CHARACTER_IMAGE)
      throw new RequestError("이미지 크기 제한을 초과했습니다.", 502);
    return new Response(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Character-Title": encodeURIComponent(brief.title),
        "X-Character-Summary": encodeURIComponent(brief.summary),
        "X-Character-Prompt": promptPreview(prompt),
        "X-Character-Style": brief.styleProfile,
        ...(scene ? { "X-Character-Composition": encodeURIComponent(JSON.stringify(compositionSchema.strip().parse(brief))) } : {}),
        "X-Character-Width": String(info.width),
        "X-Character-Height": String(info.height),
        ...usageHeaders(),
        ...retryHeaders(),
      },
    });
  } catch (error) {
    if (error instanceof RequestError && error.policyRejected) progress = { rejection: error.message };
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
      { status, headers: { "Cache-Control": "no-store", ...usageHeaders(), ...retryHeaders() } },
    );
  }
}
