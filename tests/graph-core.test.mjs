import assert from "node:assert/strict";
import test from "node:test";
import { createGraphModel, parseGraphIndex } from "../core/graph-core.mjs";

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
