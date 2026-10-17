import { isExternalTarget, slugifyHeading } from "./path-utils.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeExternalUrl(value) {
  const target = String(value ?? "").trim();
  if (!isExternalTarget(target)) return null;
  try {
    const url = new URL(target);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? target : null;
  } catch {
    return null;
  }
}

function renderPlainInline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

export function renderInline(source) {
  const pattern = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]]+)\]\]/g;
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    output += renderPlainInline(source.slice(cursor, match.index));
    if (match[1]) {
      output += `<code>${escapeHtml(match[2])}</code>`;
    } else if (match[3] !== undefined) {
      const alt = escapeHtml(match[3]);
      const target = match[4].trim().split(/\s+["']/)[0];
      const external = safeExternalUrl(target);
      if (external?.startsWith("https:")) {
        output += `<img src="${escapeHtml(external)}" alt="${alt}" loading="lazy">`;
      } else if (!isExternalTarget(target) && !target.toLowerCase().startsWith("data:")) {
        output += `<img data-wiki-image="${escapeHtml(target)}" alt="${alt}" loading="lazy">`;
      } else {
        output += alt || "[차단된 이미지]";
      }
    } else if (match[5] !== undefined) {
      const label = renderPlainInline(match[5]);
      const target = match[6].trim().split(/\s+["']/)[0];
      const external = safeExternalUrl(target);
      if (external) {
        output += `<a href="${escapeHtml(external)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } else if (!isExternalTarget(target)) {
        output += `<a href="#" data-wiki-target="${escapeHtml(target)}">${label}</a>`;
      } else {
        output += label;
      }
    } else {
      const [targetPart, labelPart] = match[7].split("|", 2);
      const label = renderPlainInline((labelPart ?? targetPart).trim());
      output += `<a href="#" data-wiki-target="${escapeHtml(targetPart.trim())}">${label}</a>`;
    }
    cursor = match.index + match[0].length;
  }
  output += renderPlainInline(source.slice(cursor));
  return output;
}

function isTableDivider(line) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

function tableAlignments(line) {
  return tableCells(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

function alignClass(alignment) {
  return alignment ? ` class="align-${alignment}"` : "";
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function stripFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return lines;
  const closing = lines.slice(1, 200).findIndex((line) => line.trim() === "---");
  return closing >= 0 ? lines.slice(closing + 2) : lines;
}

const LIST_ITEM = /^([ \t]*)(?:([-+*])|(\d{1,9})[.)])[ \t]+(.+)$/;
const NESTED_INDENT = 2;

function indentWidth(whitespace) {
  let width = 0;
  for (const character of whitespace) width = character === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
}

function parseListItem(line) {
  const match = line.match(LIST_ITEM);
  if (!match) return null;
  return { indent: indentWidth(match[1]), ordered: Boolean(match[3]), number: match[3] ? Number(match[3]) : null, text: match[4] };
}

function isListContinuation(line, nextLine) {
  if (!/^[ \t]+\S/.test(line) || parseListItem(line)) return false;
  if (/^\s*```/.test(line) || /^\s*>/.test(line) || /^\s*#{1,6}\s/.test(line)) return false;
  return !(line.includes("|") && nextLine !== undefined && isTableDivider(nextLine));
}

function renderListItem(item) {
  const task = item.lines[0].match(/^\[([ xX])\][ \t]+(.*)$/);
  const text = task ? [task[2], ...item.lines.slice(1)] : item.lines;
  const body = renderInline(text.join("\n")).replaceAll("\n", "<br>");
  const children = item.children.map(renderList).join("");
  if (!task) return `<li>${body}${children}</li>`;
  const done = task[1] !== " ";
  return `<li class="task-list-item${done ? " task-done" : ""}">${done ? "☑" : "☐"} ${body}${children}</li>`;
}

function renderList(list) {
  const tag = list.ordered ? "ol" : "ul";
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : "";
  const items = list.items.map(renderListItem).join("");
  return `<${tag}${start}>${items}</${tag}>`;
}

// 들여쓰기 깊이로 중첩 목록 트리를 만든다. 반환값은 최상위 목록 배열과 다음 처리 줄.
function parseList(lines, index) {
  const roots = [];
  const stack = [];
  let lastItem = null;
  const openList = (item, parentItem) => {
    const list = { indent: item.indent, ordered: item.ordered, start: item.number ?? 1, items: [] };
    (parentItem ? parentItem.children : roots).push(list);
    stack.push(list);
    return list;
  };
  while (index < lines.length) {
    const line = lines[index];
    const item = parseListItem(line);
    if (item) {
      while (stack.length > 1 && stack.at(-1).indent > item.indent) stack.pop();
      let list = stack.at(-1);
      if (!list) {
        list = openList(item, null);
      } else if (item.indent >= list.indent + NESTED_INDENT && lastItem) {
        list = openList(item, lastItem);
      } else if (list.ordered !== item.ordered) {
        stack.pop();
        list = openList(item, stack.length ? stack.at(-1).items.at(-1) : null);
      }
      lastItem = { lines: [item.text], children: [] };
      list.items.push(lastItem);
      index += 1;
      continue;
    }
    if (line.trim()) {
      if (!lastItem || !isListContinuation(line, lines[index + 1])) break;
      lastItem.lines.push(line.trim());
      index += 1;
      continue;
    }
    let next = index;
    while (next < lines.length && !lines[next].trim()) next += 1;
    if (next >= lines.length || !parseListItem(lines[next])) break;
    index = next;
  }
  return { html: roots.map(renderList).join(""), index };
}

function uniqueHeadingId(text, usedIds) {
  const base = slugifyHeading(text);
  if (!base) return "";
  let id = base;
  for (let suffix = 1; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
  usedIds.add(id);
  return id;
}

export function renderMarkdown(markdown) {
  return renderBlocks(markdown, new Set());
}

function renderBlocks(markdown, usedIds) {
  const lines = stripFrontmatter(String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n"));
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([^`]*)$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const language = fence[1].trim().replace(/[^A-Za-z0-9_-]/g, "");
      output.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const id = uniqueHeadingId(heading[2], usedIds);
      output.push(`<h${level}${id ? ` id="${escapeHtml(id)}"` : ""}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const alignments = tableAlignments(lines[index + 1]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index++]));
      }
      output.push(`<div class="table-scroll"><table><thead><tr>${headers.map((cell, cellIndex) => `<th${alignClass(alignments[cellIndex])}>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td${alignClass(alignments[cellIndex])}>${renderInline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      }
      output.push(`<blockquote>${renderBlocks(quote.join("\n"), usedIds)}</blockquote>`);
      continue;
    }

    if (parseListItem(line)) {
      const list = parseList(lines, index);
      output.push(list.html);
      index = list.index;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index];
      if (/^(?:#{1,6})\s+/.test(next) || /^\s*```/.test(next) || /^\s*>/.test(next) || parseListItem(next)) break;
      if (next.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(next.trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join("\n")).replaceAll("\n", "<br>")}</p>`);
  }
  return output.join("\n");
}

const ALLOWED_TAGS = new Set([
  "A", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "IMG", "LI", "OL", "P", "PRE", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL",
]);
const ALLOWED_ATTRIBUTES = new Set(["alt", "class", "data-wiki-image", "data-wiki-target", "href", "id", "loading", "rel", "src", "start", "target"]);

export function sanitizeRenderedHtml(html, documentImpl = globalThis.document) {
  if (!documentImpl?.createElement) return html;
  const template = documentImpl.createElement("template");
  template.innerHTML = html;
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(documentImpl.createTextNode(element.textContent ?? ""));
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (!ALLOWED_ATTRIBUTES.has(attribute.name) || attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.hasAttribute("start") && (element.tagName !== "OL" || !/^\d{1,9}$/.test(element.getAttribute("start") ?? ""))) {
      element.removeAttribute("start");
    }
    if (element.tagName === "A" && element.hasAttribute("href")) {
      const href = element.getAttribute("href") ?? "";
      if (href !== "#" && !safeExternalUrl(href)) element.removeAttribute("href");
    }
    if (element.tagName === "IMG" && element.hasAttribute("src")) {
      const src = element.getAttribute("src") ?? "";
      if (!safeExternalUrl(src)?.startsWith("https:")) element.removeAttribute("src");
    }
  }
  return template.innerHTML;
}
