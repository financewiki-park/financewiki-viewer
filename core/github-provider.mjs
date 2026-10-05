import { encodeContentPath, normalizeRepositoryPath } from "./path-utils.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";

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
    const response = await this.#request(path, "application/vnd.github.raw+json", signal);
    return { text: await response.text(), etag: response.headers.get("etag") ?? "" };
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
    const response = await this.#request(path, "application/vnd.github.raw+json", signal);
    return response.blob();
  }

  async #request(path, accept, signal) {
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
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new GitHubRequestError("GitHub 네트워크 연결에 실패했습니다.");
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
