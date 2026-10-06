import { credentialStore } from "./core/credential-store.mjs?v=12";
import { DocumentCache } from "./core/document-cache.mjs";
import { buildDocumentTree, DocumentIndex } from "./core/document-index.mjs?v=11";
import { GitHubProvider, GitHubRequestError } from "./core/github-provider.mjs?v=11";
import { renderMarkdown, sanitizeRenderedHtml } from "./core/markdown.mjs";
import { isExternalTarget, normalizeRepositoryPath, slugifyHeading } from "./core/path-utils.mjs";

const INDEX_PATH = "viewer-index.json";
const PAGE_SIZE = 200;
const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

const state = {
  provider: null,
  config: null,
  index: null,
  cache: new DocumentCache(),
  currentDocument: null,
  currentFragment: "",
  filteredDocuments: [],
  visibleCount: PAGE_SIZE,
  objectUrls: [],
  retry: null,
};

function repositoryKey(config = state.config) {
  return config ? `${config.owner}/${config.repository}@${config.branch}` : "";
}

function showOnly(screen) {
  for (const element of [elements.connectScreen, elements.browserScreen, elements.viewerScreen]) {
    element.hidden = element !== screen;
  }
  elements.errorPanel.hidden = true;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { elements.toast.hidden = true; }, 2800);
}

function showError(title, message, retry = null) {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.retryButton.hidden = !retry;
  elements.errorPanel.hidden = false;
  state.retry = retry;
}

function hideError() {
  elements.errorPanel.hidden = true;
  state.retry = null;
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
}

function renderList() {
  const documents = state.filteredDocuments.slice(0, state.visibleCount);
  const fragment = document.createDocumentFragment();
  for (const item of documents) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-card";
    button.dataset.path = item.path;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const detail = document.createElement("small");
    detail.textContent = `${item.path} · ${formatSize(item.size)}`;
    button.append(title, detail);
    listItem.append(button);
    fragment.append(listItem);
  }
  elements.documentList.replaceChildren(fragment);
  elements.documentCount.textContent = `${state.filteredDocuments.length}개 문서`;
  elements.moreButton.hidden = state.visibleCount >= state.filteredDocuments.length;
}

function createDocumentButton(item, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.path = item.path;
  const title = document.createElement("strong");
  title.textContent = item.title;
  const detail = document.createElement("small");
  detail.textContent = item.path;
  button.append(title, detail);
  return button;
}

function renderFolderChildren(container, folder) {
  const fragment = document.createDocumentFragment();
  for (const child of folder.folders) fragment.append(createFolderElement(child));
  for (const item of folder.documents) fragment.append(createDocumentButton(item, "tree-document"));
  container.append(fragment);
}

function createFolderElement(folder) {
  const details = document.createElement("details");
  details.className = "tree-folder";
  const summary = document.createElement("summary");
  summary.className = "tree-folder-summary";
  summary.textContent = folder.name;
  const children = document.createElement("div");
  children.className = "tree-children";
  let rendered = false;
  details.addEventListener("toggle", () => {
    if (!details.open || rendered) return;
    renderFolderChildren(children, folder);
    rendered = true;
  });
  details.append(summary, children);
  return details;
}

function renderTree() {
  const tree = buildDocumentTree(state.index.documents);
  const fragment = document.createDocumentFragment();
  for (const folder of tree.folders) fragment.append(createFolderElement(folder));
  for (const item of tree.documents) fragment.append(createDocumentButton(item, "tree-document"));
  elements.documentTree.replaceChildren(fragment);
}

function applyFilter() {
  const query = elements.searchInput.value;
  if (!query.trim()) {
    elements.documentTree.hidden = false;
    elements.documentList.hidden = true;
    elements.moreButton.hidden = true;
    elements.documentCount.textContent = `${state.index.documents.length}개 문서`;
    return;
  }
  state.filteredDocuments = state.index.filter(query);
  state.visibleCount = PAGE_SIZE;
  elements.documentTree.hidden = true;
  elements.documentList.hidden = false;
  renderList();
}

function fillConnectionForm(config) {
  elements.ownerInput.value = config?.owner ?? "financewiki-park";
  elements.repositoryInput.value = config?.repository ?? "financewiki-private";
  elements.branchInput.value = config?.branch ?? "main";
  elements.tokenInput.value = config?.token ?? "";
  elements.tokenInput.placeholder = "github_pat_…";
}

function updateConnectionDetails(connected) {
  elements.connectionState.textContent = connected ? "연결됨" : "연결 안 됨";
  elements.connectionRepository.textContent = state.config ? `${state.config.owner}/${state.config.repository}` : "-";
  elements.connectionBranch.textContent = state.config?.branch ?? "-";
}

async function connect(config, saveCredentials = true) {
  hideError();
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "연결 확인 중…";
  const provider = new GitHubProvider(config);
  const key = repositoryKey(config);
  let payload;
  let offline = false;
  try {
    ({ data: payload } = await provider.fetchJson(INDEX_PATH));
    credentialStore.saveIndex(key, payload);
  } catch (error) {
    const cached = error instanceof GitHubRequestError && error.status === 0
      ? credentialStore.loadIndex(key)
      : null;
    if (!cached) throw error;
    payload = cached;
    offline = true;
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "연결 테스트 및 열기";
  }
  const index = new DocumentIndex(payload);
  state.provider = provider;
  state.config = { ...config };
  state.index = index;
  state.filteredDocuments = index.documents;
  state.visibleCount = PAGE_SIZE;
  if (saveCredentials) credentialStore.save(config);
  updateConnectionDetails(!offline);
  elements.repositoryStatus.textContent = offline ? "저장된 인덱스 · 오프라인" : provider.repositoryLabel;
  renderTree();
  showOnly(elements.browserScreen);
  if (offline) showToast("네트워크 오류로 저장된 인덱스를 열었습니다.");
}

function revokeObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

async function loadPrivateImages(container, documentItem) {
  const images = [...container.querySelectorAll("img[data-wiki-image]")];
  await Promise.all(images.map(async (image) => {
    const target = image.dataset.wikiImage;
    if (!target || isExternalTarget(target)) return;
    const resolved = normalizeRepositoryPath(documentItem.path, target);
    if (!resolved) {
      image.alt = `${image.alt || "이미지"} (잘못된 경로)`;
      return;
    }
    try {
      const blob = await state.provider.fetchBlob(resolved.path);
      const url = URL.createObjectURL(blob);
      state.objectUrls.push(url);
      image.src = url;
    } catch {
      image.alt = `${image.alt || "이미지"} (불러오기 실패)`;
    }
  }));
}

function scrollToFragment(fragment) {
  if (!fragment) {
    window.scrollTo({ top: 0 });
    return;
  }
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* 원문 사용 */ }
  const target = document.getElementById(slugifyHeading(decoded));
  target?.scrollIntoView({ block: "start" });
}

async function openDocument(documentItem, fragment = "", { pushHistory = true } = {}) {
  hideError();
  showOnly(elements.viewerScreen);
  elements.documentLoading.hidden = false;
  elements.documentContent.hidden = true;
  elements.documentPath.textContent = documentItem.path;
  state.currentDocument = documentItem;
  state.currentFragment = fragment;
  revokeObjectUrls();
  try {
    const key = repositoryKey();
    let markdown = await state.cache.get(key, documentItem);
    let cacheHit = true;
    if (markdown === null) {
      cacheHit = false;
      ({ text: markdown } = await state.provider.fetchText(documentItem.path));
      await state.cache.put(key, documentItem, markdown);
    }
    const rendered = sanitizeRenderedHtml(renderMarkdown(markdown));
    elements.documentContent.innerHTML = rendered;
    elements.documentContent.hidden = false;
    elements.documentLoading.hidden = true;
    document.title = `${documentItem.title} · FinanceWiki`;
    if (pushHistory) {
      history.pushState({ financewikiPath: documentItem.path, fragment }, "", location.pathname);
    }
    await loadPrivateImages(elements.documentContent, documentItem);
    scrollToFragment(fragment);
    if (cacheHit) showToast("저장된 문서를 열었습니다.");
  } catch (error) {
    elements.documentLoading.hidden = true;
    showError(
      "문서를 불러오지 못했습니다.",
      error?.message || "네트워크 상태와 GitHub 연결을 확인하세요.",
      () => openDocument(documentItem, fragment, { pushHistory: false }),
    );
  }
}

function showBrowser({ pushHistory = false } = {}) {
  revokeObjectUrls();
  state.currentDocument = null;
  document.title = "FinanceWiki";
  showOnly(elements.browserScreen);
  if (pushHistory) history.pushState({ financewikiRoot: true }, "", location.pathname);
}

elements.connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const stored = credentialStore.load();
  const config = {
    owner: elements.ownerInput.value.trim(),
    repository: elements.repositoryInput.value.trim(),
    branch: elements.branchInput.value.trim(),
    token: elements.tokenInput.value || stored?.token || "",
  };
  try {
    await connect(config, true);
  } catch (error) {
    showError("FinanceWiki에 연결할 수 없습니다.", error?.message || "GitHub 인증정보를 확인하세요.");
  }
});

elements.connectButton.addEventListener("click", () => elements.connectForm.requestSubmit()); elements.searchInput.addEventListener("input", applyFilter);
elements.moreButton.addEventListener("click", () => {
  state.visibleCount += PAGE_SIZE;
  renderList();
});
function openSelectedDocument(event) {
  const button = event.target.closest("button[data-path]");
  if (!button) return;
  const resolved = state.index.resolve(button.dataset.path);
  if (resolved) openDocument(resolved.document);
}

elements.documentList.addEventListener("click", openSelectedDocument);
elements.documentTree.addEventListener("click", openSelectedDocument);
elements.documentContent.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-wiki-target]");
  if (!anchor) return;
  event.preventDefault();
  const target = anchor.dataset.wikiTarget;
  const resolved = state.index.resolve(target, state.currentDocument?.path ?? "");
  if (!resolved) {
    showError("연결된 문서를 찾지 못했습니다.", `대상: ${target}`);
    return;
  }
  openDocument(resolved.document, resolved.fragment);
});

elements.backToListButton.addEventListener("click", () => showBrowser({ pushHistory: true }));
elements.homeButton.addEventListener("click", () => state.index ? showBrowser({ pushHistory: true }) : showOnly(elements.connectScreen));
elements.retryButton.addEventListener("click", () => state.retry?.());
elements.settingsButton.addEventListener("click", () => {
  updateConnectionDetails(Boolean(state.provider));
  elements.settingsDialog.showModal();
});
elements.reconfigureButton.addEventListener("click", () => {
  elements.settingsDialog.close();
  fillConnectionForm(state.config ?? credentialStore.load());
  showOnly(elements.connectScreen);
});
elements.deleteCredentialsButton.addEventListener("click", async () => {
  credentialStore.clear();
  await state.cache.clear();
  state.provider = null;
  state.config = null;
  state.index = null;
  elements.settingsDialog.close();
  fillConnectionForm(null);
  showOnly(elements.connectScreen);
  showToast("인증정보와 문서 캐시를 삭제했습니다.");
});

window.addEventListener("popstate", (event) => {
  const path = event.state?.financewikiPath;
  if (path && state.index) {
    const resolved = state.index.resolve(path);
    if (resolved) openDocument(resolved.document, event.state?.fragment ?? "", { pushHistory: false });
  } else if (state.index) {
    showBrowser();
  }
});

async function start() {
  history.replaceState({ financewikiRoot: true }, "", location.pathname);
  const saved = credentialStore.load();
  fillConnectionForm(saved);
  if (saved) {
    try {
      await connect(saved, false);
    } catch (error) {
      showOnly(elements.connectScreen);
      showError("FinanceWiki에 연결할 수 없습니다.", error?.message || "저장된 GitHub 인증정보를 다시 설정하세요.");
    }
  } else {
    showOnly(elements.connectScreen);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

start();
