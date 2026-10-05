const EXTERNAL_SCHEMES = /^(?:https?:|mailto:|tel:)/i;

export function normalizeLookup(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "")
    .toLocaleLowerCase("ko-KR");
}

export function splitTarget(rawTarget) {
  const target = String(rawTarget ?? "").trim();
  const hashIndex = target.indexOf("#");
  const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";
  return { pathPart, fragment };
}

export function isExternalTarget(target) {
  return EXTERNAL_SCHEMES.test(String(target ?? "").trim());
}

export function normalizeRepositoryPath(basePath, rawTarget) {
  const { pathPart, fragment } = splitTarget(rawTarget);
  if (!pathPart) {
    return { path: String(basePath ?? ""), fragment };
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  decoded = decoded.replace(/\\/g, "/");
  const baseParts = String(basePath ?? "").split("/").slice(0, -1);
  const parts = decoded.startsWith("/") ? [] : baseParts;
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const path = parts.join("/");
  return path ? { path, fragment } : null;
}

export function encodeContentPath(path) {
  return String(path)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function slugifyHeading(text) {
  return String(text ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
