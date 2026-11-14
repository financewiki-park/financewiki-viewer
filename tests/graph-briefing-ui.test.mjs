import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("index.html");
const app = read("app.mjs");
const graphView = read("core/graph-view.mjs");
const css = read("viewer.css");

test("mobile graph exposes three briefing scopes with knowledge as the default", () => {
  for (const scope of ["knowledge", "recent", "all"]) {
    assert.match(html, new RegExp('data-graph-briefings="' + scope + '"'));
  }
  assert.match(html, /data-graph-briefings="knowledge" aria-pressed="true"/);
  assert.match(app, /graphBriefings: "knowledge"/);
  assert.match(app, /briefings: state\.graphBriefings/);
});

test("mobile controls scroll safely and graph failures stay inside graph rendering", () => {
  assert.match(css, /\.graph-briefing-group \{/);
  assert.match(css, /overflow-x: auto/);
  assert.match(app, /Graph rendering failed without interrupting the mobile viewer/);
  assert.match(app, /문서 열람은 계속할 수 있습니다/);
  assert.match(graphView, /setStatus\(text\)/);
});
