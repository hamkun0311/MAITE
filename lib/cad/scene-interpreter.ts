import {
  makeBox,
  makeCylinder,
  makeEllipsoid,
  draw,
  makeCompound,
  exportSTEP,
  importSTEP,
  getOC,
  measureVolume,
  type Shape3D,
  type AnyShape,
} from "replicad";
import { validateScene, type Scene } from "./scene";
import type { CadResult } from "./schema";

export async function buildScene(
  input: Scene,
  report: (progress: number, message: string) => void,
): Promise<CadResult> {
  const scene = validateScene(input),
    start = performance.now();
  const parts = new Map<string, Shape3D>();
  let combined: AnyShape | undefined, imported: AnyShape | undefined;
  try {
    for (const [index, part] of scene.parts.entries()) {
      const [x, y, z] = part.size;
      let shape: Shape3D;
      if (part.type === "box")
        shape = makeBox([-x / 2, -y / 2, -z / 2], [x / 2, y / 2, z / 2]);
      else if (part.type === "ellipsoid")
        shape = makeEllipsoid(x / 2, y / 2, z / 2);
      else if (part.type === "cylinder")
        shape = makeCylinder(x / 2, z, [0, 0, -z / 2], [0, 0, 1]);
      else
        shape = draw([-x / 2, -z / 2])
          .lineTo([x / 2, -z / 2])
          .lineTo([0, z / 2])
          .close()
          .sketchOnPlane("XZ")
          .extrude(y)
          .translate([0, y / 2, 0]) as Shape3D;
      try {
        part.rotation.forEach((angle, axis) => {
          if (angle)
            shape = shape.rotate(
              angle,
              [0, 0, 0],
              axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1],
            );
        });
        shape = shape.translate(part.position as [number, number, number]);
        if (part.mode === "cut") {
          const target = parts.get(part.target)!;
          const cut = target.cut(shape);
          target.delete();
          parts.set(part.target, cut);
          shape.delete();
        } else parts.set(part.id, shape);
      } catch (error) {
        shape.delete();
        throw error;
      }
      report(
        25 + Math.round(((index + 1) / scene.parts.length) * 45),
        `${part.name} · ${index + 1}/${scene.parts.length}`,
      );
    }
    combined = makeCompound([...parts.values()]);
    parts.clear();
    const box = combined.boundingBox;
    const [min, max] = box.bounds;
    box.delete();
    const center = min.map((v, i) => (v + max[i]) / 2);
    combined = combined.translate(
      center.map((v) => -v) as [number, number, number],
    );
    const bounds = max.map((v, i) => v - min[i]);
    if (bounds.some((v) => !Number.isFinite(v) || v > 600 || v < 0.01))
      throw new Error("형상 범위를 초과했습니다.");
    report(75, "3D 미리보기 메시 생성 중");
    const mesh = combined.mesh({ tolerance: 0.15, angularTolerance: 0.2 });
    report(85, "STEP 내보내기 중");
    const blob = exportSTEP([{ shape: combined, name: scene.title }], {
      unit: "MM",
      modelUnit: "MM",
    });
    imported = await importSTEP(blob);
    const oc = getOC(),
      analyzer = new oc.BRepCheck_Analyzer(imported.wrapped);
    try {
      if (!analyzer.IsValid())
        throw new Error("STEP 형상의 유효성 검사에 실패했습니다.");
    } finally {
      analyzer.delete();
    }
    const restored = imported.boundingBox;
    const [lo, hi] = restored.bounds;
    restored.delete();
    if (!bounds.every((v, i) => Math.abs(v - (hi[i] - lo[i])) < 0.01))
      throw new Error("STEP 재읽기 치수가 일치하지 않습니다.");
    return {
      mesh: {
        vertices: mesh.vertices,
        normals: mesh.normals,
        triangles: mesh.triangles,
      },
      step: await blob.arrayBuffer(),
      bounds,
      volume: measureVolume(combined as Shape3D),
      roundTrip: true,
      elapsed: performance.now() - start,
    };
  } finally {
    imported?.delete();
    combined?.delete();
    parts.forEach((shape) => shape.delete());
  }
}
