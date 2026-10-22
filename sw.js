// 배포 워크플로가 __VIEWER_BUILD__를 커밋 SHA로 바꾼다. 배포마다 캐시가 한 벌로 교체된다.
const BUILD_ID = "__VIEWER_BUILD__";
const CACHE_NAME = `financewiki-viewer-shell-${BUILD_ID}`;
const SHELL_PATHS = [
  "./",
  "./index.html",
  "./viewer.css",
  "./app.mjs",
  "./manifest.webmanifest",
  "./financewiki-app-icon.png",
  "./core/credential-store.mjs",
  "./core/document-cache.mjs",
  "./core/document-index.mjs",
  "./core/github-provider.mjs",
  "./core/graph-core.mjs",
  "./core/graph-view.mjs",
  "./core/markdown.mjs",
  "./core/path-utils.mjs",
];
const SHELL_URLS = new Set(SHELL_PATHS.map((path) => new URL(path, self.registration.scope).href));

function shellKey(requestUrl) {
  const url = new URL(requestUrl);
  url.search = "";
  url.hash = "";
  return url.href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_PATHS.map((path) => new Request(path, { cache: "reload" })))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const key = shellKey(event.request.url);
  if (new URL(key).origin !== self.location.origin || !SHELL_URLS.has(key)) return;
  event.respondWith(
    caches.match(key).then((cached) => cached ?? fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
      }
      return response;
    })),
  );
});
