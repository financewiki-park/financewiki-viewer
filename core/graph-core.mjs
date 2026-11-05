export const GRAPH_INDEX_PATH = ".financewiki/generated/topics/v2/graph-index.json";

const GRAPH_LAYERS = new Set(["link", "topic"]);
function strings(values) { return Array.isArray(values) ? values : []; }
function hasText(value) { return typeof value === "string" && value.trim().length > 0; }

export function graphVersion(index) {
  if (!index || typeof index !== "object") return "";
  return [index.schema_version, index.source_commit, index.generated_at].map((value) => String(value || "")).join(":");
}

export function parseGraphIndex(payload) {
  if (payload?.schema_version !== "2.0" || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error("Topic Graph v2 인덱스 형식이 올바르지 않습니다.");
  const nodes = strings(payload.nodes)
    .filter((node) => hasText(node?.id) && ["document", "topic"].includes(node.kind))
    .map((node) => node.kind === "document" ? {
      ...node,
      document_type: node.document_type || node.type || "document",
      folder: node.folder || String(node.path || "").split("/").slice(0, 2).join("/"),
    } : node);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const documents = nodes.filter((node) => node.kind === "document" && hasText(node.path));
  const documentsByPath = new Map(documents.map((node) => [node.path, node]));
  const edges = strings(payload.edges).filter((edge) =>
    GRAPH_LAYERS.has(edge?.layer) && nodesById.has(edge.source) && nodesById.has(edge.target));
  return { version: graphVersion(payload), nodes, nodesById, documents, documentsByPath, edges };
}

function visibleEdge(edge, filters) {
  return (edge.layer === "link" && filters.links) || (edge.layer === "topic" && filters.topics);
}

function linkNeighbors(graph, startId, depth) {
  const ids = new Set([startId]);
  let frontier = [startId];
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

function connectedTopicIds(graph, documentIds) {
  const ids = new Set();
  for (const edge of graph.edges) {
    if (edge.layer !== "topic") continue;
    const document = graph.nodesById.get(edge.source)?.kind === "document" ? edge.source : edge.target;
    const topic = document === edge.source ? edge.target : edge.source;
    if (documentIds.has(document) && graph.nodesById.get(topic)?.kind === "topic") ids.add(topic);
  }
  return ids;
}

export function createGraphModel(graph, options = {}) {
  const mode = ["local-1", "local-2", "global"].includes(options.mode) ? options.mode : "local-1";
  const filters = {
    links: options.links !== false,
    topics: options.topics !== false,
  };
  const center = graph.documentsByPath.get(options.centerPath);
  const documentIds = mode === "global"
    ? new Set(graph.documents.map((node) => node.id))
    : center ? linkNeighbors(graph, center.id, mode === "local-2" ? 2 : 1) : new Set();

  const nodeIds = new Set(documentIds);
  if (filters.topics) {
    // Local topic discovery uses the *current document* only, keeping unrelated
    // tags on link neighbors from exploding the graph.
    const seed = mode === "global" ? documentIds : new Set(center ? [center.id] : []);
    const tagIds = connectedTopicIds(graph, seed);
    for (const tag of tagIds) {
      nodeIds.add(tag);
      if (mode !== "global") {
        // Include documents sharing the topic, bounded for an intelligible graph.
        const related = graph.edges
          .filter((edge) => edge.layer === "topic" && (edge.source === tag || edge.target === tag))
          .map((edge) => edge.source === tag ? edge.target : edge.source)
          .filter((id) => graph.nodesById.get(id)?.kind === "document")
          .sort((a, b) => (graph.nodesById.get(a)?.title || "").localeCompare(graph.nodesById.get(b)?.title || "", "ko"));
        for (const id of related.slice(0, 24)) nodeIds.add(id);
      }
    }
  }
  const edges = graph.edges.filter((edge) => visibleEdge(edge, filters) && nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    mode,
    centerId: center?.id || "",
    nodes: [...nodeIds].map((id) => graph.nodesById.get(id)).filter(Boolean),
    edges,
    filters,
  };
}

export function graphSummary(model) {
  return `${model.nodes.length}개 노드 · ${model.edges.length}개 관계`;
}
