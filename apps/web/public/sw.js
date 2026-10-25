/*
 * Service worker: makes the site installable as an app and opens instantly on repeat visits.
 * - Files that never change under their URL (hashed build files directly in /assets/, versioned vendor folders
 *   /vendor/<name>-<version>/, e.g. the ~17 MB body-tracking model for camera games): from cache, fetched once.
 * - Game art, sounds, models and icons under fixed names (/assets/<game>/…, /icons/…): from cache at once, then
 *   refreshed in the background, so a replaced sprite reaches players on their next visit instead of never.
 *   (The same split as the server's Cache-Control rules in apps/server/src/caching.ts.)
 * - Pages: always from the network (a new deploy is picked up immediately); the offline page if there is none.
 * - Range requests (video backdrops): never touched, the browser streams them from the network or HTTP cache.
 * - API, WebSocket and everything else: never touched.
 */
const CACHE = "pwtv-static-v4";
const IMMUTABLE = [/^\/assets\/[^/]+-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)+$/, /^\/vendor\/[a-z0-9._-]+-\d+(\.\d+)+\//i];
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
    const fresh = () => fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
    const immutable = IMMUTABLE.some((re) => re.test(url.pathname));
    e.respondWith(
      caches.match(req).then((hit) => {
        if (!hit) return fresh();
        // the refresh is a cheap conditional request answered by the browser cache or the CDN, not the hub
        if (!immutable) e.waitUntil(fresh().catch(() => undefined));
        return hit;
      }),
    );
  }
});
