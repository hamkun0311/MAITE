import { z } from "zod";

const vector = (min: number, max: number) =>
  z.array(z.number().min(min).max(max)).length(3);
export const sceneSchema = z
  .object({
    title: z.string().min(1).max(80),
    summary: z.string().max(1000),
    limitations: z.array(z.string().max(300)).max(8),
    unit: z.literal("mm"),
    parts: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
            name: z.string().min(1).max(80),
            type: z.enum(["box", "ellipsoid", "cylinder", "roof"]),
            size: vector(0.5, 300),
            position: vector(-300, 300),
            rotation: vector(-180, 180),
            mode: z.enum(["add", "cut"]),
            target: z.string().max(40),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
export type Scene = z.infer<typeof sceneSchema>;
export function validateScene(value: unknown): Scene {
  const scene = sceneSchema.parse(value);
  const ids = new Set<string>(),
    targets = new Set<string>();
  for (const part of scene.parts) {
    if (
      part.type === "cylinder" &&
      Math.abs(part.size[0] - part.size[1]) > 0.001
    )
      throw new Error("원통의 X/Y 지름은 같아야 합니다.");
    if (ids.has(part.id)) throw new Error("중복된 부품 ID입니다.");
    if (part.mode === "cut" && !targets.has(part.target))
      throw new Error("절삭 대상은 앞서 추가한 부품이어야 합니다.");
    if (part.mode === "add") {
      if (part.target !== "")
        throw new Error("추가 부품의 target은 빈 문자열이어야 합니다.");
      targets.add(part.id);
    }
    ids.add(part.id);
  }
  return scene;
}
export const conversationSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(3000),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();
