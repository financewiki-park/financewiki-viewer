import { encodeContentPath, normalizeRepositoryPath } from "./path-utils.mjs";

const API_ROOT = "https://api.github.com";
const JSON_ACCEPT = "application/vnd.github+json";

function decodeBase64(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class GitHubRequestError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "GitHubRequestError";
    this.status = status;
  }
}

function validateConfig(config) {
  for (const key of ["owner", "repository", "branch", "token"]) {
    if (!String(config?.[key] ?? "").trim()) throw new Error(`${key} 값이 필요합니다.`);
  }
  for (const key of ["owner", "repository"]) {
    if (!/^[A-Za-z0-9_.-]+$/.test(config[key])) throw new Error(`${key} 형식이 올바르지 않습니다.`);
  }
  if (/\s/.test(config.branch)) throw new Error("branch에는 공백을 사용할 수 없습니다.");
  if (!/^[\x21-\x7e]+$/.test(config.token)) {
    throw new Error("PAT에는 공백·줄바꿈·특수 숨김 문자를 넣을 수 없습니다.");
  }
}

export class GitHubProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    validateConfig(config);
    if (typeof fetchImpl !== "function") throw new Error("fetch를 사용할 수 없습니다.");
    this.config = Object.freeze({
      owner: config.owner.trim(),
      repository: config.repository.trim(),
      branch: config.branch.trim(),
      token: config.token.trim(),
    });
    this.fetchImpl = fetchImpl;
  }

  get repositoryLabel() {
    return `${this.config.owner}/${this.config.repository}`;
  }

  async fetchText(path, { signal } = {}) {
    const { bytes, etag } = await this.#fetchContent(path, signal);
    return { text: new TextDecoder().decode(bytes), etag };
  }

  async fetchJson(path, options = {}) {
    const { text, etag } = await this.fetchText(path, options);
    try {
      return { data: JSON.parse(text), etag };
    } catch {
      throw new GitHubRequestError(`${path}의 JSON 형식이 올바르지 않습니다.`);
    }
  }

  async fetchBlob(path, { signal } = {}) {
    const { bytes } = await this.#fetchContent(path, signal);
    return new Blob([bytes]);
  }

  async #fetchContent(path, signal) {
    const response = await this.#request(path, signal);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new GitHubRequestError(`${path}의 GitHub 응답 형식이 올바르지 않습니다.`);
    }
    if (payload?.encoding !== "base64" || typeof payload.content !== "string") {
      throw new GitHubRequestError(`${path}의 파일 내용을 읽을 수 없습니다.`);
    }
    return { bytes: decodeBase64(payload.content), etag: response.headers.get("etag") ?? "" };
  }

  async #request(path, signal) {
    const normalized = normalizeRepositoryPath("", `/${path}`);
    if (!normalized || normalized.path !== String(path).replace(/^\/+/, "")) {
      throw new GitHubRequestError("저장소 경로가 올바르지 않습니다.");
    }
    const { owner, repository, branch, token } = this.config;
    const url = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodeContentPath(normalized.path)}?ref=${encodeURIComponent(branch)}`;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: JSON_ACCEPT,
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `token ${token}` },
          credentials: "omit",
          signal,
        });
      } catch (fallbackError) {
        if (fallbackError?.name === "AbortError") throw fallbackError;
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        throw new GitHubRequestError(
          offline
            ? "기기가 오프라인 상태입니다. 네트워크 연결을 확인하세요."
            : "브라우저가 GitHub API 인증 요청을 차단했습니다. 저장소 권한 오류라면 별도 안내가 표시됩니다.",
        );
      }
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403 || status === 404) {
        throw new GitHubRequestError("인증정보가 만료됐거나 저장소·브랜치 접근 권한이 없습니다.", status);
      }
      throw new GitHubRequestError(`GitHub 요청에 실패했습니다. (HTTP ${status})`, status);
    }
    return response;
  }
}
