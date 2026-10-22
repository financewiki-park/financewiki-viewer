import test from "node:test";
import assert from "node:assert/strict";
import { calculateZoomTranslation } from "../core/graph-view.mjs";

function renderedPoint(translation, scale, point) {
  return { x: translation.x + scale * point.x, y: translation.y + scale * point.y };
}

test("zoom keeps the focal graph point under the pointer", () => {
  const focus = { x: 160, y: 347 };
  const next = calculateZoomTranslation({ x: 0, y: 0, visualScale: 1 }, focus, 8);
  assert.deepEqual(renderedPoint(next, 8, focus), focus);
});

test("successive zooms keep the same focal graph point stable", () => {
  const focus = { x: 160, y: 347 };
  const first = calculateZoomTranslation({ x: 0, y: 0, visualScale: 1 }, focus, 2);
  const second = calculateZoomTranslation({ ...first, visualScale: 2 }, focus, 16);
  assert.deepEqual(renderedPoint(second, 16, focus), focus);
});
