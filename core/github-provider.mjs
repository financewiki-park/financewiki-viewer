import { encodeContentPath, normalizeRepositoryPath } from "./path-utils.mjs";

const API_ROOT = "https://api.github.com";
// raw 응답은 Contents API의 base64 응답과 달리 1MB 제한이 없다.
const RAW_ACCEPT = "application/vnd.github.raw";

function normalizeToken(token) {
  return String(token ?? "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
}

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
  if (!/^[\x21-\x7e]+$/.test(normalizeToken(config.token))) {
    throw new Error("PAT 형식이 올바르지 않습니다. GitHub에서 새로 복사해 붙여넣으세요.");
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
      token: normalizeToken(config.token),
    });
    this.fetchImpl = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
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
    const etag = response.headers.get("etag") ?? "";
    let bytes;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new GitHubRequestError(`${path}의 GitHub 응답을 읽을 수 없습니다.`);
    }
    if (/vnd\.github\.raw/i.test(response.headers.get("content-type") ?? "")) return { bytes, etag };
    // 대체 요청은 Accept를 생략하므로 Contents API의 JSON(base64) 응답이 올 수 있다.
    let payload = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { bytes, etag };
    }
    if (payload?.type === "file" && payload.encoding === "none") {
      throw new GitHubRequestError(`${path} 파일이 1MB를 넘어 이 방식으로 읽을 수 없습니다.`);
    }
    if (payload?.encoding === "base64" && typeof payload.content === "string") {
      return { bytes: decodeBase64(payload.content), etag };
    }
    return { bytes, etag };
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
          Accept: RAW_ACCEPT,
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
      if (status === 401) {
        throw new GitHubRequestError("토큰이 만료됐거나 올바르지 않습니다. 설정에서 새 토큰을 입력하세요.", status);
      }
      if ((status === 403 || status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const when = reset ? ` ${new Date(reset).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 이후` : " 잠시 후";
        throw new GitHubRequestError(`GitHub API 요청 한도를 넘었습니다.${when} 다시 시도하세요.`, status);
      }
      if (status === 403) {
        throw new GitHubRequestError("토큰에 이 저장소의 Contents 읽기 권한이 없습니다.", status);
      }
      if (status === 404) {
        throw new GitHubRequestError("파일·저장소·브랜치를 찾을 수 없습니다. 이름과 토큰의 저장소 범위를 확인하세요.", status);
      }
      throw new GitHubRequestError(`GitHub 요청에 실패했습니다. (HTTP ${status})`, status);
    }
    return response;
  }
}
