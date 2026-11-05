import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TopicIndex, TOPIC_INDEX_PATH } from "../core/topic-index.mjs";
import { createGraphModel, parseGraphIndex, GRAPH_INDEX_PATH, LEGACY_GRAPH_INDEX_PATH } from "../core/graph-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viewerIndex = { documents: [
  { path: "wiki/a.md", title: "A", hash: "aaa" },
  { path: "wiki/b.md", title: "B", hash: "bbb" },
  { path: "wiki/c.md", title: "C", hash: "ccc" },
] };
const topics = {
  schema_version: "2.0",
  topics: [
    { name: "회사채", category: "금융시장" },
    { name: "금리", category: "금융시장" },
    { name: "미사용", category: "금융시장" },
  ],
  documents: [
    { path: "wiki/a.md", tags: ["회사채", "회사채", "unapproved"] },
    { path: "wiki/b.md", tags: ["회사채", "금리"] },
    { path: "wiki/c.md", tags: [] },
    { path: "wiki/not-in-viewer.md", tags: ["금리"] },
  ],
};

test("approved topics only, without loading Markdown bodies", () => {
  const index = new TopicIndex(topics, viewerIndex);
  assert.equal(TOPIC_INDEX_PATH, ".financewiki/generated/topics/v2/topic-index.json");
  assert.deepEqual(index.tagsFor("wiki/a.md"), ["회사채"]);
  assert.deepEqual(index.documentsFor("회사채").map(x => x.path), ["wiki/a.md", "wiki/b.md"]);
  assert.deepEqual(index.documentsFor("금리").map(x => x.path), ["wiki/b.md"]);
  assert.equal(index.find("미사용"), null);
  assert.equal(index.find("unapproved"), null);
  assert.equal(index.topics.length, 2);
  assert.equal(index.groups()[0].topics[0].count, 2);
});
test("old format and conflicting tag ids are rejected", () => {
  assert.throws(() => new TopicIndex({ schema_version: "1.0", topics: [], documents: [] }, viewerIndex), /주제 인덱스/);
  assert.throws(() => new TopicIndex({ schema_version: "2.0", topics: [
    { name: "회사채", category: "금융시장" }, { name: "회사채", category: "다른 범주" },
  ], documents: [] }, viewerIndex), /중복 태그/);
});
test("v2 graph supports topic neighborhoods and optional direct-link-only view", () => {
  const graph = parseGraphIndex({
    schema_version: "2.0", source_commit: "abc",
    nodes: [
      { id: "a", kind: "document", title: "A", path: "wiki/a.md", type: "issue" },
      { id: "b", kind: "document", title: "B", path: "wiki/b.md", type: "source" },
      { id: "c", kind: "document", title: "C", path: "wiki/c.md", type: "briefing" },
      { id: "tag:회사채", kind: "topic", title: "회사채", category: "금융시장", document_count: 2 },
    ],
    edges: [
      { layer: "link", source: "a", target: "b", directed: true },
      { layer: "topic", source: "a", target: "tag:회사채", directed: false },
      { layer: "topic", source: "c", target: "tag:회사채", directed: false },
    ],
  });
  assert.equal(GRAPH_INDEX_PATH, ".financewiki/generated/topics/v2/graph-index.json");
  assert.equal(LEGACY_GRAPH_INDEX_PATH, ".financewiki/generated/graph/v1/graph-index.json");
  assert.equal(graph.nodesById.get("a").document_type, "issue");
  assert.deepEqual(createGraphModel(graph, { centerPath: "wiki/a.md" }).nodes.map(n => n.id).sort(),
    ["a", "b", "c", "tag:회사채"]);
  assert.deepEqual(createGraphModel(graph, { centerPath: "wiki/a.md", topics: false }).nodes.map(n => n.id).sort(),
    ["a", "b"]);
});
test("static shell includes topic controls, does not embed private metadata or token", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const script = readFileSync(resolve(root, "app.mjs"), "utf8");
  const worker = readFileSync(resolve(root, "sw.js"), "utf8");
  for (const id of ["topicTab", "topicCatalog", "topicSelection", "documentTopics", "relatedTopicDocuments", "graphTopics"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(script, /fetchJson\(TOPIC_INDEX_PATH\)/);
  assert.match(script, /fetchJson\(LEGACY_GRAPH_INDEX_PATH\)/);
  assert.match(script, /onOpenTopic\(tag\)/);
  assert.match(worker, /\.\/core\/topic-index\.mjs/);
  assert.doesNotMatch(worker, /topic-index\.json/);
  assert.doesNotMatch(html, /github_pat_[a-zA-Z0-9]{20,}/);
});
