import { graphSummary } from "./graph-core.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#4f88dd", "#b06bd2", "#36aa94", "#e3a543", "#db6b89", "#62aacf"];
const LABEL_FONT_SIZE = 13;
const LABEL_COLLISION_SCALE = 1.25;
const LABEL_MAX_WIDTH = 220;

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
// 확대는 요청한 비율 그대로 적용한다. 확대 화면에는 가까운 노드만 보여도 된다.
function presentationScale(scale) { return scale; }

export function estimateLabelWidth(value, fontSize = LABEL_FONT_SIZE) {
  const width = [...String(value || "")].reduce((sum, character) => {
    const wide = /[\u2E80-\u9FFF\uAC00-\uD7AF]/u.test(character);
    return sum + fontSize * (wide ? 1 : .56);
  }, 0);
  return Math.min(LABEL_MAX_WIDTH, width);
}

export function calculateLabelCollision(first, second, scale = LABEL_COLLISION_SCALE) {
  const firstY = first.y + (first.radius + 18) / scale;
  const secondY = second.y + (second.radius + 18) / scale;
  const overlapX = (estimateLabelWidth(first.text) + estimateLabelWidth(second.text)) / (2 * scale) + 6 - Math.abs(first.x - second.x);
  const overlapY = (LABEL_FONT_SIZE + 6) / scale - Math.abs(firstY - secondY);
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { axis: overlapX < overlapY ? "x" : "y", overlap: Math.min(overlapX, overlapY), firstY, secondY };
}

export function calculateZoomTranslation(base, focus, nextScale) {
  const ratio = nextScale / base.visualScale;
  return {
    x: focus.x - (focus.x - base.x) * ratio,
    y: focus.y - (focus.y - base.y) * ratio
  };
}

export function calculatePanTranslation(base, start, current) {
  return { x: base.x + current.x - start.x, y: base.y + current.y - start.y };
}

export function calculatePinchTranslation(anchor, midpoint, nextScale) {
  return { x: midpoint.x - anchor.x * nextScale, y: midpoint.y - anchor.y * nextScale };
}

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

function globalLayout(model, viewport) {
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
  const width = viewport.width; const height = viewport.height;
  const columns = Math.max(1, Math.min(entries.length || 1, Math.ceil(Math.sqrt(entries.length * width / height))));
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const cellWidth = width / columns; const cellHeight = height / rows;
  const positions = new Map(); const clusters = [];
  entries.forEach(([name, nodes], index) => {
    const x = (index % columns) * cellWidth + cellWidth / 2;
    const y = Math.floor(index / columns) * cellHeight + cellHeight / 2;
    const ordered = [...nodes].sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0) || label(a).localeCompare(label(b), "ko"));
    ordered.forEach((node, nodeIndex) => {
      const angle = nodeIndex * 2.399963229728653;
      const radius = 10 + Math.sqrt(nodeIndex) * Math.min(12, Math.min(cellWidth, cellHeight) / 12);
      positions.set(node.id, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius * .72 });
    });
    clusters.push({ name, x, y, radius: Math.min(Math.min(cellWidth, cellHeight) * .44, Math.max(34, 22 + Math.sqrt(nodes.length) * 11)), color: color(nodes[0]) });
  });
  return { width, height, positions, clusters, degrees };
}

function localLayout(model, viewport) {
  const width = viewport.width; const height = viewport.height; const centerX = width / 2; const centerY = height / 2;
  const positions = new Map(); const groups = new Map(); const distances = graphDistances(model);
  for (const node of model.nodes) {
    if (node.id === model.centerId) { positions.set(node.id, { x: centerX, y: centerY }); continue; }
    const hops = Math.min(3, distances.get(node.id) ?? 3); const key = `${hops}:${node.kind}`;
    if (!groups.has(key)) groups.set(key, { hops, kind: node.kind, nodes: [] });
    groups.get(key).nodes.push(node);
  }
  for (const [key, group] of groups) {
    const count = group.nodes.length; const entity = group.kind === "entity";
    const baseX = Math.max(54, Math.min(146, width * .22)); const baseY = Math.max(48, Math.min(102, height * .18));
    const radiusX = Math.min(width * .43, Math.max((entity ? baseX * .76 : baseX) + (group.hops - 1) * baseX * .72, 46 + count * 4.4));
    const radiusY = Math.min(height * .39, Math.max((entity ? baseY * .76 : baseY) + (group.hops - 1) * baseY * .72, 40 + count * 3.2));
    const start = (hash(key) % 360) * Math.PI / 180;
    group.nodes.sort((a, b) => label(a).localeCompare(label(b), "ko")).forEach((node, index) => {
      const angle = start + index * Math.PI * 2 / count;
      positions.set(node.id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY });
    });
  }
  return { width, height, positions, clusters: [], degrees: new Map() };
}

export function createGraphView({ host, onOpenDocument, onCenterDocument }) {
  let simulation = null; let selectedId = ""; let model = null;
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
  const stop = () => { if (simulation?.frame) cancelAnimationFrame(simulation.frame); if (simulation) simulation.running = false; };
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
    const showAll = scale >= 1.25 || sim.points.size <= 12;
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
        // 물리 배치는 카메라 배율과 무관하다. 확대 중 배율을 힘 계산에 섞으면
        // 손을 뗀 뒤 노드가 다시 튀거나 수축하는 현상이 생긴다.
        const minimum = radius + otherRadius + 8;
        if (distance < minimum) { const force = (minimum - distance) * .16 * sim.alpha; const x = dx / distance * force; const y = dy / distance * force; point.vx += x; point.vy += y; other.vx -= x; other.vy -= y; }
        // 겹쳤을 때만 튕기는 대신 가까운 노드끼리 미리 조금씩 밀어낸다.
        // 거리가 멀어지면 빠르게 약해져 화면 가장자리로 흩어지지 않는다.
        const repulsion = Math.min(1.2, 720 / (distance * distance)) * sim.alpha;
        const repulsionX = dx / distance * repulsion; const repulsionY = dy / distance * repulsion;
        point.vx += repulsionX; point.vy += repulsionY; other.vx -= repulsionX; other.vy -= repulsionY;
        // 라벨은 확대 때 물리를 다시 켜지 않고, 처음 자리 잡을 때 보이는 크기를
        // 기준으로 충돌시킨다. 확대하면 이 간격은 더 넓어지므로 겹침이 줄어든다.
        const labelCollision = calculateLabelCollision(
          { x: point.x, y: point.y, radius, text: shorten(label(point.node)) },
          { x: other.x, y: other.y, radius: otherRadius, text: shorten(label(other.node)) }
        );
        if (labelCollision) {
          if (labelCollision.axis === "x") {
            const direction = Math.sign(point.x - other.x || (hash(`${point.id}:${other.id}:label-x`) % 2 ? 1 : -1));
            const force = Math.min(1.4, labelCollision.overlap * .1) * sim.alpha * direction;
            point.vx += force; other.vx -= force;
          } else {
            const direction = Math.sign(labelCollision.firstY - labelCollision.secondY || (hash(`${point.id}:${other.id}:label-y`) % 2 ? 1 : -1));
            const force = Math.min(1.4, labelCollision.overlap * .1) * sim.alpha * direction;
            point.vy += force; other.vy -= force;
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
    sim.alpha *= .978; repaint(sim);
    if (sim.alpha > .035) sim.frame = requestAnimationFrame(() => tick(sim)); else { sim.running = false; sim.frame = 0; }
  }
  function start() { if (!simulation || simulation.running || simulation.alpha <= .035) return; simulation.running = true; simulation.frame = requestAnimationFrame(() => tick(simulation)); }
  function updateZoom(scale) {
    if (!simulation) return;
    simulation.scale = scale; setLabels(simulation, scale); repaint(simulation);
  }
  function attachPanZoom(root, viewport) {
    const pointers = new Map(); let drag = null; let pinch = null;
    const apply = (x, y, scale) => { const visualScale = presentationScale(scale); viewport.dataset.x = String(x); viewport.dataset.y = String(y); viewport.dataset.scale = String(scale); viewport.dataset.visualScale = String(visualScale); viewport.setAttribute("transform", `translate(${x} ${y}) scale(${visualScale})`); };
    const state = () => ({ x: Number(viewport.dataset.x || 0), y: Number(viewport.dataset.y || 0), scale: Number(viewport.dataset.scale || 1), visualScale: Number(viewport.dataset.visualScale || 1) });
    const toViewportPoint = (clientX, clientY) => { const bounds = root.getBoundingClientRect(); const viewBox = root.viewBox.baseVal; return { x: viewBox.x + (clientX - bounds.left) / bounds.width * viewBox.width, y: viewBox.y + (clientY - bounds.top) / bounds.height * viewBox.height }; };
    const zoom = (scale, clientX, clientY, base = state()) => {
      const next = Math.max(1, Math.min(32, scale));
      if (next === 1) { apply(0, 0, 1); updateZoom(1); return; }
      const point = toViewportPoint(clientX, clientY);
      const nextVisualScale = presentationScale(next);
      // 현재 화면 좌표를 고정한다: translate + scale(point)의 결과가 확대 전후 같아야 한다.
      const translation = calculateZoomTranslation(base, point, nextVisualScale);
      apply(translation.x, translation.y, next);
      updateZoom(nextVisualScale);
    };
    apply(0, 0, 1);
    root.addEventListener("wheel", (event) => { event.preventDefault(); const current = state(); zoom(current.scale * (event.deltaY < 0 ? 1.16 : .86), event.clientX, event.clientY, current); }, { passive: false });
    root.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-graph-node]")) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); root.setPointerCapture(event.pointerId);
      if (pointers.size === 1) { const current = state(); drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y, scale: current.scale }; }
      if (pointers.size === 2) {
        const [first, second] = [...pointers.values()]; const current = state();
        const midpoint = toViewportPoint((first.x + second.x) / 2, (first.y + second.y) / 2);
        pinch = {
          distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          state: current,
          anchor: { x: (midpoint.x - current.x) / current.visualScale, y: (midpoint.y - current.y) / current.visualScale }
        };
        drag = null;
      }
    });
    root.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && pinch) {
        const [first, second] = [...pointers.values()];
        const next = Math.max(1, Math.min(32, pinch.state.scale * Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance));
        if (next === 1) { apply(0, 0, 1); updateZoom(1); return; }
        const midpoint = toViewportPoint((first.x + second.x) / 2, (first.y + second.y) / 2);
        const translation = calculatePinchTranslation(pinch.anchor, midpoint, next);
        apply(translation.x, translation.y, next);
        updateZoom(next);
        return;
      }
      if (!drag || drag.pointerId !== event.pointerId || drag.scale <= 1) return;
      const start = toViewportPoint(drag.startX, drag.startY); const current = toViewportPoint(event.clientX, event.clientY);
      const translation = calculatePanTranslation(drag, start, current);
      apply(translation.x, translation.y, drag.scale);
    });
    const release = (event) => { if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId); pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
    root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
  }
  function render(nextModel, { running = true } = {}) {
    stop(); model = nextModel; status.textContent = `${graphSummary(model)}${model.mode === "global" ? " · 폴더별 군집" : ""}`; canvas.replaceChildren();
    if (!model.nodes.length) { canvas.textContent = model.mode === "global" ? "표시할 그래프 노드가 없습니다." : "문서의 링크 관계가 없거나 그래프 인덱스에 아직 반영되지 않았습니다."; writeInfo(null); return; }
    const bounds = canvas.getBoundingClientRect(); const canvasViewport = { width: Math.max(320, Math.round(bounds.width || window.innerWidth || 1200)), height: Math.max(320, Math.round(bounds.height || window.innerHeight || 760)) };
    const layout = model.mode === "global" ? globalLayout(model, canvasViewport) : localLayout(model, canvasViewport); const root = svg("svg", { class: "finance-graph-svg", viewBox: `0 0 ${layout.width} ${layout.height}`, role: "img", "aria-label": "FinanceWiki Graph View" });
    const viewport = svg("g"); root.append(viewport); const clusters = svg("g", { class: "finance-graph-clusters" }); const lines = svg("g", { class: "finance-graph-edges" }); const nodes = svg("g", { class: "finance-graph-nodes" }); viewport.append(clusters, lines, nodes);
    for (const cluster of layout.clusters) { clusters.append(svg("circle", { cx: cluster.x, cy: cluster.y, r: cluster.radius, fill: cluster.color })); const text = svg("text", { x: cluster.x, y: cluster.y - cluster.radius - 8, class: "finance-graph-cluster-label" }); text.textContent = shorten(cluster.name, 30); clusters.append(text); }
    const points = new Map();
    for (const node of model.nodes) {
      const initial = layout.positions.get(node.id) || { x: 600, y: 380 }; const point = { id: node.id, x: initial.x, y: initial.y, vx: 0, vy: 0, node };
      const group = svg("g", { class: `finance-graph-node ${node.kind}${node.id === model.centerId ? " current" : ""}`, transform: `translate(${point.x} ${point.y})`, tabindex: "0", role: "button", "aria-label": label(node), "data-graph-node": node.id });
      const radius = node.kind === "entity" ? 7 : node.id === model.centerId ? 19 : model.mode === "global" ? Math.min(12, 4 + Math.log2(1 + (layout.degrees.get(node.id) || 0)) * 1.5) : 13;
      group.append(svg("circle", { r: radius, fill: color(node) })); const title = svg("title"); title.textContent = label(node); group.append(title); const nodeLabel = svg("text", { y: radius + 18, class: "finance-graph-label" }); nodeLabel.textContent = shorten(label(node)); group.append(nodeLabel); point.labelElement = nodeLabel;
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
    canvas.append(root); attachPanZoom(root, viewport); simulation = { points, edges, centerId: model.centerId, anchorX: layout.width / 2, anchorY: layout.height / 2, scale: 1, alpha: model.mode === "global" ? 0 : 1, frame: 0, running: false }; setLabels(simulation); repaint(simulation); writeInfo(model.nodes.find((node) => node.id === selectedId)); if (running && simulation.alpha > .035) start();
  }
  return { render, stop, clear() { stop(); simulation = null; model = null; selectedId = ""; canvas.replaceChildren(); writeInfo(null); } };
}
