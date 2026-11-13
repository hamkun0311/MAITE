import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScene } from "../lib/cad/scene.ts";
const part = {
  id: "base",
  name: "base",
  type: "box",
  size: [10, 10, 10],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  mode: "add",
  target: "",
};
const scene = {
  title: "test",
  summary: "test",
  limitations: [],
  unit: "mm",
  parts: [part],
};
test("reject executable fields, unknown primitives and excessive complexity", () => {
  assert.throws(() => validateScene({ ...scene, code: "anything" }));
  assert.throws(() =>
    validateScene({ ...scene, parts: [{ ...part, type: "script" }] }),
  );
  assert.throws(() =>
    validateScene({
      ...scene,
      parts: Array.from({ length: 41 }, (_, i) => ({ ...part, id: `p${i}` })),
    }),
  );
});
test("enforce valid prior cut targets and unique ids", () => {
  assert.throws(() =>
    validateScene({
      ...scene,
      parts: [{ ...part, mode: "cut", target: "missing" }],
    }),
  );
  assert.throws(() => validateScene({ ...scene, parts: [part, part] }));
  assert.equal(
    validateScene({
      ...scene,
      parts: [part, { ...part, id: "hole", mode: "cut", target: "base" }],
    }).parts.length,
    2,
  );
});
test("bound transforms and reject misleading cylinder dimensions", () => {
  assert.throws(() =>
    validateScene({
      ...scene,
      parts: [{ ...part, position: [Infinity, 0, 0] }],
    }),
  );
  assert.throws(() =>
    validateScene({
      ...scene,
      parts: [{ ...part, type: "cylinder", size: [10, 20, 10] }],
    }),
  );
});
