import { z } from "zod";

export const plateSchema = z
  .object({
    width: z.number().finite().min(20).max(300),
    height: z.number().finite().min(20).max(300),
    thickness: z.number().finite().min(1).max(30),
    holeDiameter: z.number().finite().min(1).max(40),
    edgeOffset: z.number().finite().min(2).max(100),
    holes: z.boolean(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!p.holes) return;
    if (p.edgeOffset <= p.holeDiameter / 2 + 0.5)
      ctx.addIssue({
        code: "custom",
        path: ["edgeOffset"],
        message: "구멍 가장자리와 판재 사이에 0.5 mm보다 큰 여유가 필요합니다.",
      });
    if (2 * p.edgeOffset + p.holeDiameter + 0.5 >= Math.min(p.width, p.height))
      ctx.addIssue({
        code: "custom",
        path: ["edgeOffset"],
        message:
          "구멍이 겹칩니다. 판재 크기를 늘리거나 모서리 간격을 줄여주세요.",
      });
  });

export type PlateParameters = z.infer<typeof plateSchema>;
export const DEFAULT_PLATE: PlateParameters = {
  width: 100,
  height: 60,
  thickness: 5,
  holeDiameter: 6,
  edgeOffset: 10,
  holes: true,
};
export function makeSpecification(p: PlateParameters) {
  const { width: w, height: h, thickness: t } = plateSchema.parse(p);
  return {
    schemaVersion: "1.0",
    modelType: "mechanical",
    unit: "mm",
    coordinateSystem: "Z-up, centered",
    operations: [
      { id: "base", type: "box", size: [w, h, t], center: [0, 0, 0] },
      ...(p.holes
        ? [-1, 1].flatMap((x) =>
            [-1, 1].map((y) => ({
              id: `hole_${x > 0 ? "r" : "l"}${y > 0 ? "t" : "b"}`,
              type: "cylinder_cut",
              target: "base",
              radius: p.holeDiameter / 2,
              depth: t + 2,
              center: [
                x * (w / 2 - p.edgeOffset),
                y * (h / 2 - p.edgeOffset),
                0,
              ],
              axis: "Z",
            })),
          )
        : []),
    ],
    outputs: ["step"],
  };
}

export type CadMesh = {
  vertices: number[];
  normals: number[];
  triangles: number[];
};
export type CadResult = {
  mesh: CadMesh;
  step: ArrayBuffer;
  volume: number;
  bounds: number[];
  roundTrip: boolean;
  elapsed: number;
};
export type WorkerMessage =
  | { type: "progress"; progress: number; message: string }
  | { type: "result"; result: CadResult }
  | { type: "error"; message: string };
