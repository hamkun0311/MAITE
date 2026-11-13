import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLATE,
  makeSpecification,
  plateSchema,
} from "../lib/cad/schema.ts";

test("default plate has four Z-axis holes at ±40, ±20", () => {
  const spec = makeSpecification(DEFAULT_PLATE);
  assert.equal(spec.operations.length, 5);
  assert.deepEqual(
    spec.operations
      .slice(1)
      .map((operation) =>
        "center" in operation ? operation.center : undefined,
      ),
    [
      [-40, -20, 0],
      [-40, 20, 0],
      [40, -20, 0],
      [40, 20, 0],
    ],
  );
});
test("rejects holes crossing the boundary or overlapping", () => {
  assert.equal(
    plateSchema.safeParse({ ...DEFAULT_PLATE, edgeOffset: 3 }).success,
    false,
  );
  assert.equal(
    plateSchema.safeParse({ ...DEFAULT_PLATE, edgeOffset: 28 }).success,
    false,
  );
});
test("rejects nonfinite and excessive dimensions and unknown fields", () => {
  for (const width of [NaN, Infinity, 0, -10, 301])
    assert.equal(
      plateSchema.safeParse({ ...DEFAULT_PLATE, width }).success,
      false,
    );
  assert.equal(
    plateSchema.safeParse({ ...DEFAULT_PLATE, script: "anything" }).success,
    false,
  );
});
test("solid block does not enforce unused hole constraints", () => {
  const p = { ...DEFAULT_PLATE, holes: false, edgeOffset: 30 };
  assert.equal(plateSchema.safeParse(p).success, true);
  assert.equal(makeSpecification(p).operations.length, 1);
});
