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
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function stripFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return lines;
  const closing = lines.slice(1, 200).findIndex((line) => line.trim() === "---");
  return closing >= 0 ? lines.slice(closing + 2) : lines;
}

export function renderMarkdown(markdown) {
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
      const id = slugifyHeading(heading[2]);
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
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index++]));
      }
      output.push(`<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      }
      output.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(`<li>${renderInline(item[3])}</li>`);
        index += 1;
      }
      output.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index];
      if (/^(?:#{1,6})\s+/.test(next) || /^\s*```/.test(next) || /^\s*>/.test(next) || /^\s*(?:[-+*]|\d+\.)\s+/.test(next)) break;
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
const ALLOWED_ATTRIBUTES = new Set(["alt", "class", "data-wiki-image", "data-wiki-target", "href", "id", "loading", "rel", "src", "target"]);

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
