import assert from "node:assert/strict";
import test from "node:test";
import { createGraphModel, parseGraphIndex } from "../core/graph-core.mjs";

const graph = parseGraphIndex({
  schema_version: "1.0",
  nodes: [
    { id: "doc:a", kind: "document", path: "a.md", title: "A" },
    { id: "doc:b", kind: "document", path: "b.md", title: "B" },
    { id: "doc:c", kind: "document", path: "c.md", title: "C" },
    { id: "ent:x", kind: "entity", label: "X", entity_type: "company" },
  ],
  edges: [
    { source: "doc:a", target: "doc:b", layer: "link" },
    { source: "doc:b", target: "doc:c", layer: "link" },
    { source: "doc:a", target: "ent:x", layer: "entity" },
    { source: "doc:a", target: "doc:c", layer: "semantic", status: "model_reviewed", review_required: false },
    { source: "doc:b", target: "doc:c", layer: "semantic", status: "candidate", review_required: true },
  ],
});

test("Local 1 contains direct wiki links and backlinks only", () => {
  const model = createGraphModel(graph, { centerPath: "a.md" });
  assert.deepEqual(model.nodes.map((node) => node.id).sort(), ["doc:a", "doc:b"]);
});

test("Local 2 adds second-degree documents and optional entity overlay", () => {
  const model = createGraphModel(graph, { centerPath: "a.md", mode: "local-2", entities: true });
  assert.deepEqual(model.nodes.map((node) => node.id).sort(), ["doc:a", "doc:b", "doc:c", "ent:x"]);
});

test("Global reads the full index and excludes unreviewed semantic edges", () => {
  const model = createGraphModel(graph, { centerPath: "a.md", mode: "global", semantic: true });
  assert.equal(model.nodes.filter((node) => node.kind === "document").length, 3);
  assert.deepEqual(model.edges.filter((edge) => edge.layer === "semantic").map((edge) => edge.target), ["doc:c"]);
});
