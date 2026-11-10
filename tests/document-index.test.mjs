import assert from "node:assert/strict";
import test from "node:test";
import { DocumentIndex, partitionPinnedWikiIndex } from "../core/document-index.mjs";

const documents = [
  { title: "wiki/위키 인덱스.md", path: "articles/path-shaped-title.md" },
  { title: "wiki/없는 문서.md", path: "wiki/concepts/path-shaped-title.md" },
  { title: "위키 인덱스", path: "wiki/위키 인덱스.md" },
  { title: "상대 문서", path: "wiki/companies/상대 문서.md" },
];

test("repository-root Markdown paths resolve exactly before titles", () => {
  const index = new DocumentIndex({ version: 1, documents });
  assert.equal(index.resolve("wiki/위키 인덱스.md", "wiki/companies/현재.md")?.document.path, "wiki/위키 인덱스.md");
  assert.equal(index.resolve("wiki/위키 인덱스.md".normalize("NFD"))?.document.path, "wiki/위키 인덱스.md");
  assert.equal(index.resolve("wiki/없는 문서.md", "wiki/companies/현재.md"), null);
  assert.equal(index.resolve("상대 문서.md", "wiki/companies/현재.md")?.document.path, "wiki/companies/상대 문서.md");
});

test("the exact wiki index is pinned once outside the folder tree", () => {
  const result = partitionPinnedWikiIndex(documents);
  assert.equal(result.pinned, documents[2]);
  assert.deepEqual(result.documents, [documents[0], documents[1], documents[3]]);
});
