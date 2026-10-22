export const GRAPH_INDEX_PATH = ".financewiki/generated/graph/v1/graph-index.json";

const GRAPH_LAYERS = new Set(["link", "entity", "semantic"]);

function list(value) { return Array.isArray(value) ? value : []; }
function text(value) { return typeof value === "string" && value.trim().length > 0; }

export function graphVersion(index) {
  return [index?.schema_version, index?.source_commit, index?.generated_at].map((value) => String(value || "")).join(":");
}

// 그래프 화면은 이 파일 하나만 소비한다. Markdown 전체를 다시 훑지 않는다.
export function parseGraphIndex(payload) {
  if (!payload || typeof payload !== "object") throw new Error("그래프 인덱스 형식이 올바르지 않습니다.");
  const nodes = list(payload.nodes).filter((node) => text(node?.id) && (node.kind === "document" || node.kind === "entity"));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const documents = nodes.filter((node) => node.kind === "document" && text(node.path));
  const documentsByPath = new Map(documents.map((node) => [node.path, node]));
  const edges = list(payload.edges).filter((edge) => {
    if (!GRAPH_LAYERS.has(edge?.layer) || !nodesById.has(edge.source) || !nodesById.has(edge.target)) return false;
    return edge.layer !== "semantic" || (edge.status === "model_reviewed" && edge.review_required === false);
  });
  return { version: graphVersion(payload), nodes, nodesById, documents, documentsByPath, edges };
}

function include(edge, filters) {
  return (edge.layer === "link" && filters.links)
    || (edge.layer === "entity" && filters.entities)
    || (edge.layer === "semantic" && filters.semantic);
}

function linkedDocuments(graph, centerId, depth) {
  const ids = new Set([centerId]);
  let frontier = [centerId];
  for (let step = 0; step < depth && frontier.length; step += 1) {
    const next = [];
    for (const id of frontier) {
      for (const edge of graph.edges) {
        if (edge.layer !== "link" || (edge.source !== id && edge.target !== id)) continue;
        const other = edge.source === id ? edge.target : edge.source;
        if (graph.nodesById.get(other)?.kind !== "document" || ids.has(other)) continue;
        ids.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return ids;
}

function relatedEntities(graph, documentIds) {
  const ids = new Set();
  for (const edge of graph.edges) {
    if (edge.layer === "entity" && documentIds.has(edge.source) && graph.nodesById.get(edge.target)?.kind === "entity") ids.add(edge.target);
  }
  return ids;
}

export function createGraphModel(graph, options = {}) {
  const mode = ["local-1", "local-2", "global"].includes(options.mode) ? options.mode : "local-1";
  const filters = { links: options.links !== false, entities: options.entities === true, semantic: options.semantic === true };
  const center = graph.documentsByPath.get(options.centerPath);
  const documentIds = mode === "global"
    ? new Set(graph.documents.map((node) => node.id))
    : center ? linkedDocuments(graph, center.id, mode === "local-2" ? 2 : 1) : new Set();
  const nodeIds = new Set(documentIds);
  if (filters.entities) for (const id of relatedEntities(graph, documentIds)) nodeIds.add(id);
  const edges = graph.edges.filter((edge) => include(edge, filters) && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { mode, centerId: center?.id || "", nodes: [...nodeIds].map((id) => graph.nodesById.get(id)).filter(Boolean), edges, filters };
}

export function graphSummary(model) { return `${model.nodes.length}개 노드 · ${model.edges.length}개 관계`; }
