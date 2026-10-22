import { graphSummary } from "./graph-core.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#4f88dd", "#b06bd2", "#36aa94", "#e3a543", "#db6b89", "#62aacf"];

function svg(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function hash(value) { return [...String(value)].reduce((sum, item) => ((sum * 33) ^ item.codePointAt(0)) >>> 0, 5381); }
function label(node) { return node.kind === "entity" ? node.label : node.title; }
function shorten(value, length = 25) { const valueText = String(value || ""); return valueText.length > length ? `${valueText.slice(0, length - 1)}…` : valueText; }
function color(node) { return COLORS[hash(node.kind === "entity" ? node.entity_type : node.document_type) % COLORS.length]; }
function groupFor(node) { return node.kind === "entity" ? `Entity · ${node.entity_type || "other"}` : node.folder || node.document_type || "Other"; }
function visualNodeScale(scale) { return Math.min(1.18, 1 + Math.log2(Math.max(1, scale)) * .035); }
// 32단계 확대에서도 관계선만 남지 않도록, 화면상 거리 확대는 완만하게 적용한다.
function presentationScale(scale) { return Math.min(6, 1 + Math.log2(Math.max(1, scale))); }

function graphDistances(model) {
  const result = new Map();
  if (!model.centerId) return result;
  const adjacent = new Map();
  for (const edge of model.edges) {
    if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
    if (!adjacent.has(edge.target)) adjacent.set(edge.target, []);
    adjacent.get(edge.source).push(edge.target);
    adjacent.get(edge.target).push(edge.source);
  }
  const queue = [model.centerId];
  result.set(model.centerId, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const adjacentId of adjacent.get(id) || []) {
      if (result.has(adjacentId)) continue;
      result.set(adjacentId, result.get(id) + 1);
      queue.push(adjacentId);
    }
  }
  return result;
}

function globalLayout(model) {
  const degrees = new Map();
  for (const edge of model.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  }
  const groups = new Map();
  for (const node of model.nodes) {
    const group = groupFor(node);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(node);
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"));
  const columns = Math.max(2, Math.ceil(Math.sqrt(entries.length * 1.45)));
  const cellWidth = 290; const cellHeight = 210;
  const width = Math.max(1200, columns * cellWidth + 80); const height = Math.max(760, Math.ceil(entries.length / columns) * cellHeight + 90);
  const positions = new Map(); const clusters = [];
  entries.forEach(([name, nodes], index) => {
    const x = 55 + (index % columns) * cellWidth + cellWidth / 2;
    const y = 45 + Math.floor(index / columns) * cellHeight + cellHeight / 2;
    const ordered = [...nodes].sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0) || label(a).localeCompare(label(b), "ko"));
    ordered.forEach((node, nodeIndex) => {
      const angle = nodeIndex * 2.399963229728653;
      const radius = 16 + Math.sqrt(nodeIndex) * 14;
      positions.set(node.id, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius * .72 });
    });
    clusters.push({ name, x, y, radius: Math.max(55, 26 + Math.sqrt(nodes.length) * 16), color: color(nodes[0]) });
  });
  return { width, height, positions, clusters, degrees };
}

function localLayout(model) {
  const width = 1200; const height = 760; const centerX = width / 2; const centerY = height / 2;
  const positions = new Map(); const groups = new Map(); const distances = graphDistances(model);
  for (const node of model.nodes) {
    if (node.id === model.centerId) { positions.set(node.id, { x: centerX, y: centerY }); continue; }
    const hops = Math.min(3, distances.get(node.id) ?? 3); const key = `${hops}:${node.kind}`;
    if (!groups.has(key)) groups.set(key, { hops, kind: node.kind, nodes: [] });
    groups.get(key).nodes.push(node);
  }
  for (const [key, group] of groups) {
    const count = group.nodes.length; const entity = group.kind === "entity";
    const radiusX = Math.min(510, Math.max((entity ? 112 : 146) + (group.hops - 1) * (entity ? 82 : 108), 72 + count * 5.2));
    const radiusY = Math.min(320, Math.max((entity ? 76 : 102) + (group.hops - 1) * (entity ? 58 : 76), 52 + count * 3.5));
    const start = (hash(key) % 360) * Math.PI / 180;
    group.nodes.sort((a, b) => label(a).localeCompare(label(b), "ko")).forEach((node, index) => {
      const angle = start + index * Math.PI * 2 / count;
      positions.set(node.id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY });
    });
  }
  return { width, height, positions, clusters: [], degrees: new Map() };
}

export function createGraphView({ host, onOpenDocument, onCenterDocument }) {
  let simulation = null; let selectedId = ""; let model = null; let settleTimer = 0;
  const status = host.querySelector("[data-graph-status]"); const canvas = host.querySelector("[data-graph-canvas]"); const info = host.querySelector("[data-graph-info]");
  // iOS Safari는 touch-action: none만으로는 페이지 핀치 확대를 막지 않는다.
  // 그래프 패널이 열렸을 때만 Safari 전용 gesture 이벤트의 기본 동작을 막는다.
  const preventNativePagePinch = (event) => {
    if (!host.hidden && event.cancelable) event.preventDefault();
  };
  for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(eventName, preventNativePagePinch, { capture: true, passive: false });
  }
  document.addEventListener("touchmove", (event) => {
    if (!host.hidden && event.touches.length > 1 && event.cancelable) event.preventDefault();
  }, { capture: true, passive: false });
  const stop = () => { if (simulation?.frame) cancelAnimationFrame(simulation.frame); if (settleTimer) clearTimeout(settleTimer); settleTimer = 0; if (simulation) simulation.running = false; };
  function writeInfo(node) {
    info.replaceChildren();
    if (!node) { info.textContent = "노드를 탭하면 문서를 엽니다. 선택 후 ‘이 문서를 중심으로’로 Local 그래프의 중심을 바꿉니다."; return; }
    const title = document.createElement("strong"); title.textContent = label(node);
    const meta = document.createElement("span"); meta.textContent = node.kind === "entity" ? `Entity · ${node.entity_type || "other"}` : node.path;
    info.append(title, meta);
    if (node.kind === "document") {
      const button = document.createElement("button"); button.type = "button"; button.textContent = "이 문서를 중심으로";
      button.addEventListener("click", () => onCenterDocument(node.path)); info.append(button);
    }
  }
  function repaint(sim) {
    for (const edge of sim.edges) {
      const source = sim.points.get(edge.source); const target = sim.points.get(edge.target);
      if (!source || !target) continue;
      edge.element.setAttribute("x1", source.x); edge.element.setAttribute("y1", source.y); edge.element.setAttribute("x2", target.x); edge.element.setAttribute("y2", target.y);
    }
    // 확대는 관계의 거리 위주로 적용한다. 노드는 조금만 커지고 라벨은 읽기 크기를 유지한다.
    const nodeScale = visualNodeScale(sim.scale);
    for (const point of sim.points.values()) {
      point.element.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${nodeScale / sim.scale})`);
      point.labelElement?.setAttribute("transform", `scale(${1 / nodeScale})`);
    }
  }
  function setLabels(sim, scale = 1) {
    const showAll = scale >= 1.25 || sim.points.size < 28;
    for (const point of sim.points.values()) point.labelElement?.setAttribute("display", showAll || point.id === sim.centerId || point.id === selectedId ? "inline" : "none");
  }
  function tick(sim) {
    if (!sim.running) return;
    const points = [...sim.points.values()];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      for (let otherIndex = index + 1; otherIndex < points.length; otherIndex += 1) {
        const other = points[otherIndex]; let dx = point.x - other.x; let dy = point.y - other.y; let distance = Math.hypot(dx, dy);
        if (distance < .01) { const angle = hash(`${point.id}:${other.id}`) * Math.PI / 180; dx = Math.cos(angle); dy = Math.sin(angle); distance = 1; }
        const radius = point.node.kind === "entity" ? 7 : point.id === sim.centerId ? 19 : 13;
        const otherRadius = other.node.kind === "entity" ? 7 : other.id === sim.centerId ? 19 : 13;
        const nodeScale = visualNodeScale(sim.scale);
        const minimum = ((radius + otherRadius) * nodeScale + 8) / sim.scale;
        if (distance < minimum) { const force = (minimum - distance) * .16 * sim.alpha; const x = dx / distance * force; const y = dy / distance * force; point.vx += x; point.vy += y; other.vx -= x; other.vy -= y; }
        if (sim.scale >= 1.25) {
          const halfWidth = Math.min(132, Math.max(radius, shorten(label(point.node)).length * 8)) / sim.scale;
          const otherHalfWidth = Math.min(132, Math.max(otherRadius, shorten(label(other.node)).length * 8)) / sim.scale;
          const labelY = point.y + (radius + 15) / sim.scale; const otherLabelY = other.y + (otherRadius + 15) / sim.scale;
          const labelDy = labelY - otherLabelY; const labelDx = point.x - other.x;
          const overlapX = halfWidth + otherHalfWidth + 10 / sim.scale - Math.abs(labelDx); const overlapY = 22 / sim.scale - Math.abs(labelDy);
          if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) { const direction = Math.sign(labelDx || (hash(`${point.id}:${other.id}:x`) % 2 ? 1 : -1)); const force = overlapX * .3 * sim.alpha * direction; point.vx += force; other.vx -= force; }
            else { const direction = Math.sign(labelDy || (hash(`${point.id}:${other.id}:y`) % 2 ? 1 : -1)); const force = overlapY * .3 * sim.alpha * direction; point.vy += force; other.vy -= force; }
          }
        }
      }
    }
    for (const edge of sim.edges) {
      const source = sim.points.get(edge.source); const target = sim.points.get(edge.target); if (!source || !target) continue;
      const dx = target.x - source.x; const dy = target.y - source.y; const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = edge.layer === "entity" ? 108 : edge.layer === "semantic" ? 124 : 146; const force = (distance - desired) * .013 * sim.alpha;
      source.vx += dx / distance * force; source.vy += dy / distance * force; target.vx -= dx / distance * force; target.vy -= dy / distance * force;
    }
    for (const point of points) {
      const strength = point.id === sim.centerId ? .0024 : .00035; point.vx += (sim.anchorX - point.x) * strength; point.vy += (sim.anchorY - point.y) * strength;
      point.vx *= .84; point.vy *= .84; point.x += point.vx; point.y += point.vy;
    }
    sim.alpha *= .986; repaint(sim);
    if (sim.alpha > .035) sim.frame = requestAnimationFrame(() => tick(sim)); else { sim.running = false; sim.frame = 0; }
  }
  function start() { if (!simulation || simulation.running || simulation.alpha <= .035) return; simulation.running = true; simulation.frame = requestAnimationFrame(() => tick(simulation)); }
  function updateZoom(scale, settle = false) {
    if (!simulation) return;
    simulation.scale = scale; setLabels(simulation, scale); repaint(simulation);
    if (!settle || simulation.alpha === 0) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (!simulation || simulation.alpha === 0) return;
      simulation.alpha = Math.max(simulation.alpha, .16); start();
    }, 120);
  }
  function attachPanZoom(root, viewport) {
    const pointers = new Map(); let drag = null; let pinch = null;
    const apply = (x, y, scale) => { const visualScale = presentationScale(scale); viewport.dataset.x = String(x); viewport.dataset.y = String(y); viewport.dataset.scale = String(scale); viewport.dataset.visualScale = String(visualScale); viewport.setAttribute("transform", `translate(${x} ${y}) scale(${visualScale})`); };
    const state = () => ({ x: Number(viewport.dataset.x || 0), y: Number(viewport.dataset.y || 0), scale: Number(viewport.dataset.scale || 1), visualScale: Number(viewport.dataset.visualScale || 1) });
    const toGraphPoint = (clientX, clientY) => { const bounds = root.getBoundingClientRect(); const viewBox = root.viewBox.baseVal; return { x: viewBox.x + (clientX - bounds.left) / bounds.width * viewBox.width, y: viewBox.y + (clientY - bounds.top) / bounds.height * viewBox.height }; };
    const zoom = (scale, clientX, clientY, base = state()) => {
      const next = Math.max(1, Math.min(32, scale));
      if (next === 1) { render(model, { running: model.mode !== "global" }); return; }
      const point = toGraphPoint(clientX, clientY);
      const nextVisualScale = presentationScale(next);
      const ratio = nextVisualScale / base.visualScale;
      apply(point.x - (point.x - base.x) * ratio, point.y - (point.y - base.y) * ratio, next);
      updateZoom(nextVisualScale, true);
    };
    apply(0, 0, 1);
    root.addEventListener("wheel", (event) => { event.preventDefault(); const current = state(); zoom(current.scale * (event.deltaY < 0 ? 1.16 : .86), event.clientX, event.clientY, current); }, { passive: false });
    root.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-graph-node]")) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); root.setPointerCapture(event.pointerId);
      if (pointers.size === 1) { const current = state(); drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y, scale: current.scale }; }
      if (pointers.size === 2) { const [first, second] = [...pointers.values()]; const current = state(); pinch = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), state: current }; drag = null; }
    });
    root.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && pinch) { const [first, second] = [...pointers.values()]; zoom(pinch.state.scale * Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance, (first.x + second.x) / 2, (first.y + second.y) / 2, pinch.state); return; }
      if (!drag || drag.pointerId !== event.pointerId || drag.scale <= 1) return;
      apply(drag.x + (event.clientX - drag.startX) / drag.visualScale, drag.y + (event.clientY - drag.startY) / drag.visualScale, drag.scale);
    });
    const release = (event) => { if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId); pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
    root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
  }
  function render(nextModel, { running = true } = {}) {
    stop(); model = nextModel; status.textContent = `${graphSummary(model)}${model.mode === "global" ? " · 폴더별 군집" : ""}`; canvas.replaceChildren();
    if (!model.nodes.length) { canvas.textContent = model.mode === "global" ? "표시할 그래프 노드가 없습니다." : "문서의 링크 관계가 없거나 그래프 인덱스에 아직 반영되지 않았습니다."; writeInfo(null); return; }
    const layout = model.mode === "global" ? globalLayout(model) : localLayout(model); const root = svg("svg", { class: "finance-graph-svg", viewBox: `0 0 ${layout.width} ${layout.height}`, role: "img", "aria-label": "FinanceWiki Graph View" });
    const viewport = svg("g"); root.append(viewport); const clusters = svg("g", { class: "finance-graph-clusters" }); const lines = svg("g", { class: "finance-graph-edges" }); const nodes = svg("g", { class: "finance-graph-nodes" }); viewport.append(clusters, lines, nodes);
    for (const cluster of layout.clusters) { clusters.append(svg("circle", { cx: cluster.x, cy: cluster.y, r: cluster.radius, fill: cluster.color })); const text = svg("text", { x: cluster.x, y: cluster.y - cluster.radius - 8, class: "finance-graph-cluster-label" }); text.textContent = shorten(cluster.name, 30); clusters.append(text); }
    const points = new Map();
    for (const node of model.nodes) {
      const initial = layout.positions.get(node.id) || { x: 600, y: 380 }; const point = { id: node.id, x: initial.x, y: initial.y, vx: 0, vy: 0, node };
      const group = svg("g", { class: `finance-graph-node ${node.kind}${node.id === model.centerId ? " current" : ""}`, transform: `translate(${point.x} ${point.y})`, tabindex: "0", role: "button", "aria-label": label(node), "data-graph-node": node.id });
      const radius = node.kind === "entity" ? 7 : node.id === model.centerId ? 19 : model.mode === "global" ? Math.min(12, 4 + Math.log2(1 + (layout.degrees.get(node.id) || 0)) * 1.5) : 13;
      group.append(svg("circle", { r: radius, fill: color(node) })); const title = svg("title"); title.textContent = label(node); group.append(title); const nodeLabel = svg("text", { y: radius + 13, class: "finance-graph-label" }); nodeLabel.textContent = shorten(label(node)); group.append(nodeLabel); point.labelElement = nodeLabel;
      const open = () => { selectedId = node.id; writeInfo(node); if (node.kind === "document") onOpenDocument(node.path); };
      group.addEventListener("click", open); group.addEventListener("dblclick", () => { if (node.kind === "document") onCenterDocument(node.path); }); group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      point.element = group; points.set(node.id, point); nodes.append(group);
    }
    const edges = model.edges.map((edge) => {
      const line = svg("line", {
        class: `finance-graph-edge ${edge.layer}`,
        "vector-effect": "non-scaling-stroke"
      });
      lines.append(line);
      return { ...edge, element: line };
    });
    canvas.append(root); attachPanZoom(root, viewport); simulation = { points, edges, centerId: model.centerId, anchorX: 600, anchorY: 380, scale: 1, alpha: model.mode === "global" ? 0 : 1, frame: 0, running: false }; setLabels(simulation); repaint(simulation); writeInfo(model.nodes.find((node) => node.id === selectedId)); if (running && simulation.alpha > .035) start();
  }
  return { render, stop, clear() { stop(); simulation = null; model = null; selectedId = ""; canvas.replaceChildren(); writeInfo(null); } };
}
