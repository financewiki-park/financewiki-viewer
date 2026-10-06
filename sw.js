const CACHE_NAME = "financewiki-viewer-shell-v13";
const SHELL_PATHS = [
  "./",
  "./index.html",
  "./viewer.css",
  "./app.mjs",
  "./manifest.webmanifest",
  "./icon.png",
  "./core/credential-store.mjs",
  "./core/document-cache.mjs",
  "./core/document-index.mjs",
  "./core/github-provider.mjs",
  "./core/markdown.mjs",
  "./core/path-utils.mjs",
];
const SHELL_URLS = new Set(SHELL_PATHS.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_PATHS)));
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
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET"
    || url.origin !== self.location.origin
    || !SHELL_URLS.has(url.href)
  ) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })),
  );
});
