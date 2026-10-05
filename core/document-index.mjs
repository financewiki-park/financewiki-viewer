import { normalizeLookup, normalizeRepositoryPath, splitTarget } from "./path-utils.mjs";

function addLookup(map, key, document) {
  const normalized = normalizeLookup(key);
  if (!normalized) return;
  const bucket = map.get(normalized) ?? [];
  if (!bucket.some((item) => item.path === document.path)) bucket.push(document);
  map.set(normalized, bucket);
}

export class DocumentIndex {
  constructor(payload) {
    if (!payload || payload.version !== 1 || !Array.isArray(payload.documents)) {
      throw new Error("지원하지 않는 viewer-index.json 형식입니다.");
    }
    const seen = new Set();
    this.documents = payload.documents.map((item) => {
      if (!item || typeof item.path !== "string" || typeof item.title !== "string") {
        throw new Error("문서 인덱스 항목이 올바르지 않습니다.");
      }
      if (seen.has(item.path)) throw new Error(`중복 문서 경로: ${item.path}`);
      seen.add(item.path);
      return Object.freeze({ ...item, aliases: Array.isArray(item.aliases) ? item.aliases : [] });
    });
    this.byPath = new Map(this.documents.map((item) => [normalizeLookup(item.path), item]));
    this.lookup = new Map();
    for (const document of this.documents) {
      addLookup(this.lookup, document.path, document);
      addLookup(this.lookup, document.path.replace(/\.md$/i, ""), document);
      addLookup(this.lookup, document.slug, document);
      addLookup(this.lookup, document.title, document);
      for (const alias of document.aliases) addLookup(this.lookup, alias, document);
    }
  }

  resolve(rawTarget, currentPath = "") {
    const { pathPart, fragment } = splitTarget(rawTarget);
    if (!pathPart && currentPath) {
      const current = this.byPath.get(normalizeLookup(currentPath));
      return current ? { document: current, fragment } : null;
    }

    const looksLikePath = /[\\/]/.test(pathPart) || /\.md$/i.test(pathPart);
    if (looksLikePath) {
      const normalized = normalizeRepositoryPath(currentPath, pathPart);
      if (!normalized) return null;
      const candidates = [normalized.path];
      if (!/\.md$/i.test(normalized.path)) candidates.push(`${normalized.path}.md`);
      for (const candidate of candidates) {
        const document = this.byPath.get(normalizeLookup(candidate));
        if (document) return { document, fragment };
      }
    }

    const matches = this.lookup.get(normalizeLookup(pathPart)) ?? [];
    if (!matches.length) return null;
    if (matches.length === 1) return { document: matches[0], fragment };
    const currentDirectory = currentPath.split("/").slice(0, -1).join("/");
    const sameDirectory = matches.find((item) => item.directory === currentDirectory);
    const document = sameDirectory ?? [...matches].sort((a, b) => a.path.localeCompare(b.path, "ko"))[0];
    return { document, fragment, ambiguous: matches.length > 1 };
  }

  filter(query) {
    const normalized = normalizeLookup(query);
    if (!normalized) return this.documents;
    return this.documents.filter((item) =>
      [item.title, item.path, item.slug, ...item.aliases].some((value) =>
        normalizeLookup(value).includes(normalized),
      ),
    );
  }
}
