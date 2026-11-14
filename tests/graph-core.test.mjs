import assert from "node:assert/strict";
import test from "node:test";
import { createGraphModel, graphSummary, parseGraphIndex } from "../core/graph-core.mjs";

const graph = parseGraphIndex({
  schema_version: "2.0",
  nodes: [
    { id: "doc:a", kind: "document", path: "a.md", title: "A" },
    { id: "doc:b", kind: "document", path: "b.md", title: "B" },
    { id: "doc:c", kind: "document", path: "c.md", title: "C" },
    { id: "tag:회사채", kind: "topic", title: "회사채", category: "금융시장" },
  ],
  edges: [
    { source: "doc:a", target: "doc:b", layer: "link" },
    { source: "doc:b", target: "doc:c", layer: "link" },
    { source: "doc:a", target: "tag:회사채", layer: "topic" },
    { source: "doc:c", target: "tag:회사채", layer: "topic" },
  ],
});

const briefingGraph = parseGraphIndex({
  schema_version: "2.0",
  nodes: [
    { id: "core-a", kind: "document", title: "핵심 A", path: "wiki/issues/core-a.md", type: "issue" },
    { id: "core-b", kind: "document", title: "핵심 B", path: "wiki/issues/core-b.md", type: "issue" },
    { id: "brief-old", kind: "document", title: "오래된 브리핑", path: "wiki/briefings/blog-watch/2026년 9월1일.md", type: "overview" },
    { id: "brief-cutoff", kind: "document", title: "경계 브리핑", path: "wiki/briefings/pressreader/2026년 10월16일.md", type: "briefing" },
    { id: "brief-recent", kind: "document", title: "최근 브리핑", path: "wiki/briefings/pressreader/2026년 11월14일.md", type: "source" },
    { id: "brief-undated", kind: "document", title: "날짜 없는 주간 브리핑", path: "wiki/briefings/weekly/latest.md", type: "briefing" },
    { id: "tag:AI 투자", kind: "topic", title: "AI 투자", category: "산업" },
  ],
  edges: [
    { source: "core-a", target: "brief-old", layer: "link" },
    { source: "core-a", target: "tag:AI 투자", layer: "topic" },
    { source: "core-b", target: "tag:AI 투자", layer: "topic" },
    { source: "brief-old", target: "tag:AI 투자", layer: "topic" },
    { source: "brief-cutoff", target: "tag:AI 투자", layer: "topic" },
    { source: "brief-recent", target: "tag:AI 투자", layer: "topic" },
    { source: "brief-undated", target: "tag:AI 투자", layer: "topic" },
  ],
});

test("Local 1 contains directly linked Wiki documents", () => {
  const model = createGraphModel(graph, { centerPath: "b.md" });
  assert.deepEqual(model.nodes.map(node => node.id).sort(), ["doc:a", "doc:b", "doc:c"]);
});

test("Local topic discovery links shared-tag documents", () => {
  const model = createGraphModel(graph, { centerPath: "a.md", mode: "local-1" });
  assert.deepEqual(model.nodes.map(node => node.id).sort(), ["doc:a", "doc:b", "doc:c", "tag:회사채"]);
  assert.equal(model.edges.filter(edge => edge.layer === "topic").length, 2);
});

test("Disabling topics keeps only directly linked documents", () => {
  const model = createGraphModel(graph, { centerPath: "a.md", topics: false });
  assert.deepEqual(model.nodes.map(node => node.id).sort(), ["doc:a", "doc:b"]);
  assert.deepEqual(model.edges.map(edge => edge.layer), ["link"]);
});

test("Global includes all document and topic nodes", () => {
  const model = createGraphModel(graph, { centerPath: "a.md", mode: "global" });
  assert.equal(model.nodes.length, 4);
  assert.equal(model.edges.length, 4);
});

test("Retired graph schema is not accepted", () => {
  assert.throws(() => parseGraphIndex({ nodes: [], edges: [] }), /Topic Graph v2/);
});

test("Knowledge scope is the mobile default and protects local topic slots", () => {
  const model = createGraphModel(briefingGraph, { centerPath: "wiki/issues/core-a.md" });
  assert.deepEqual(model.nodes.map((node) => node.id).sort(), ["core-a", "core-b", "tag:AI 투자"]);
  assert.equal(model.briefingScope, "knowledge");
  assert.equal(model.hiddenBriefingCount, 4);
  assert.match(graphSummary(model), /브리핑 4건 접힘/);
});

test("The current briefing stays visible without peer briefings", () => {
  const model = createGraphModel(briefingGraph, { centerPath: "wiki/briefings/blog-watch/2026년 9월1일.md" });
  assert.deepEqual(model.nodes.map((node) => node.id).sort(), ["brief-old", "core-a", "core-b", "tag:AI 투자"]);
  assert.equal(model.visibleBriefingCount, 1);
  assert.equal(model.hiddenBriefingCount, 3);
});

test("Recent scope uses an inclusive 30-day window from the newest indexed briefing", () => {
  const model = createGraphModel(briefingGraph, { mode: "global", briefings: "recent" });
  assert.deepEqual(model.nodes.map((node) => node.id).sort(), ["brief-cutoff", "brief-recent", "core-a", "core-b", "tag:AI 투자"]);
  assert.equal(model.visibleBriefingCount, 2);
  assert.equal(model.hiddenBriefingCount, 2);
});

test("All scope restores every briefing", () => {
  const model = createGraphModel(briefingGraph, { mode: "global", briefings: "all" });
  assert.equal(model.nodes.length, 7);
  assert.equal(model.edges.length, 7);
  assert.equal(model.hiddenBriefingCount, 0);
});

test("Unknown briefing scope fails closed to knowledge", () => {
  const model = createGraphModel(briefingGraph, { mode: "global", briefings: "unexpected" });
  assert.equal(model.briefingScope, "knowledge");
  assert.equal(model.visibleBriefingCount, 0);
});
