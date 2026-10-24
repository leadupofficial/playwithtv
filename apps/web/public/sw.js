/*
 * Service worker: makes the site installable as an app and opens instantly on repeat visits.
 * - Versioned build files (/assets/*, hashed names), icons and versioned vendor files (/vendor/<name>-<version>/,
 *   e.g. the ~17 MB body-tracking model for camera games): served from cache, fetched once.
 * - Pages: always from the network (a new deploy is picked up immediately); the offline page if there is none.
 * - Range requests (video backdrops): never touched, the browser streams them from the network or HTTP cache.
 * - API, WebSocket and everything else: never touched.
 */
const CACHE = "pwtv-static-v3";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/offline.css", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // video backdrops are streamed with Range requests: partial (206) responses can't be cached, so leave them be
  if (req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/vendor/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});
