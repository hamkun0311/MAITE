import {
  makeBox,
  makeCylinder,
  measureVolume,
  exportSTEP,
  importSTEP,
  getOC,
  type Shape3D,
} from "replicad";
import { plateSchema, type PlateParameters, type CadResult } from "./schema";

// Called only in a Worker or a validation script after setOC(). No server CAD.
export async function buildPlate(
  input: PlateParameters,
  report: (progress: number, message: string) => void,
): Promise<CadResult> {
  const p = plateSchema.parse(input);
  const start = performance.now();
  report(35, "판재 B-Rep 구성 중");
  let shape: Shape3D = makeBox(
    [-p.width / 2, -p.height / 2, -p.thickness / 2],
    [p.width / 2, p.height / 2, p.thickness / 2],
  );
  let imported: Awaited<ReturnType<typeof importSTEP>> | undefined;
  try {
    if (p.holes) {
      let count = 0;
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          const tool = makeCylinder(
            p.holeDiameter / 2,
            p.thickness + 2,
            [
              x * (p.width / 2 - p.edgeOffset),
              y * (p.height / 2 - p.edgeOffset),
              -p.thickness / 2 - 1,
            ],
            [0, 0, 1],
          );
          try {
            const cut: Shape3D = shape.cut(tool);
            shape.delete();
            shape = cut;
          } finally {
            tool.delete();
          }
          report(40 + ++count * 7, `관통 구멍 Boolean cut · ${count}/4`);
        }
    }
    report(72, "미리보기 메시 생성 중");
    const mesh = shape.mesh({ tolerance: 0.08, angularTolerance: 0.15 });
    const volume = measureVolume(shape);
    report(82, "STEP 파일 내보내는 중");
    const blob = exportSTEP([{ shape, name: "MAITE Mounting Plate" }], {
      unit: "MM",
      modelUnit: "MM",
    });
    const step = await blob.arrayBuffer();
    report(92, "STEP 다시 읽기 · 치수와 체적 확인 중");
    imported = await importSTEP(blob);
    const oc = getOC();
    const analyzer = new oc.BRepCheck_Analyzer(imported.wrapped);
    const explorer = new oc.TopExp_Explorer(
      imported.wrapped,
      oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    );
    try {
      let solids = 0;
      while (explorer.More()) {
        solids++;
        explorer.Next();
      }
      if (!analyzer.IsValid() || solids !== 1)
        throw new Error("STEP 형상이 유효한 단일 솔리드가 아닙니다.");
    } finally {
      explorer.delete();
      analyzer.delete();
    }
    const box = imported.boundingBox;
    const [min, max] = box.bounds;
    const bounds = max.map((v, i) => v - min[i]);
    box.delete();
    if (!("cut" in imported))
      throw new Error("STEP을 솔리드 형상으로 다시 읽지 못했습니다.");
    const expectedVolume =
      p.width * p.height * p.thickness -
      (p.holes ? 4 * Math.PI * (p.holeDiameter / 2) ** 2 * p.thickness : 0);
    const restoredVolume = measureVolume(imported as Shape3D);
    const roundTrip =
      bounds.every(
        (v, i) => Math.abs(v - [p.width, p.height, p.thickness][i]) < 0.001,
      ) &&
      Math.abs(restoredVolume - expectedVolume) < 0.01 &&
      Math.abs(volume - expectedVolume) < 0.01;
    if (!roundTrip)
      throw new Error(
        "STEP 재검증에 실패했습니다. 치수 또는 체적이 원본과 다릅니다.",
      );
    return {
      mesh: {
        vertices: mesh.vertices,
        normals: mesh.normals,
        triangles: mesh.triangles,
      },
      step,
      volume,
      bounds,
      roundTrip,
      elapsed: performance.now() - start,
    };
  } finally {
    imported?.delete();
    shape?.delete();
  }
}
