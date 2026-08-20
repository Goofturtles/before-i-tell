/* sw.js — offline shell. After the first visit, Levels 1 and 3 run with the
   network fully off — which is the honest proof behind "nothing you type
   leaves your device": a site that needed a server couldn't do this.

   Same-origin GET only. Level 2's relay POSTs (cross-origin) pass through
   untouched, and nothing a user types is ever cached — this stores only the
   app's own files, exactly like the browser's HTTP cache.

   Strategy: cache-first with background refresh (stale-while-revalidate).
   After a deploy, a page may render one visit stale and be current the next —
   the honest trade for working offline. Bump VERSION to force a clean sweep. */

const VERSION = "bit-v1";

const SHELL = [
  "./",
  "index.html",
  "app.html",
  "adult.html",
  "css/tokens.css",
  "css/base.css",
  "css/components.css",
  "css/print.css",
  "js/adult.js",
  "js/app.js",
  "js/ask.js",
  "js/codename.js",
  "js/config.js",
  "js/corpus.js",
  "js/link.js",
  "js/retrieval.js",
  "js/router.js",
  "js/safety.js",
  "js/scaffold.js",
  "js/smooth.js",
  "js/store.js",
  "js/terms.js",
  "js/ui.js",
  "fonts/bricolage-grotesque-latin.woff2",
  "media/hero-poster.jpg",
  "media/story-poster.jpg",
  "media/warm-poster.jpg",
  "manifest.webmanifest",
  "icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // no-cache: bypass the HTTP cache so the shell snapshot is actually
      // current, not whatever the browser had lying around
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      // no-cache: revalidate against the server (conditional request), not the
      // HTTP cache — otherwise the background refresh can re-store the very
      // stale copy it was meant to replace
      const refresh = fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          // cache complete same-origin 200s only (an opaque or partial
          // response would poison the cache for offline use)
          if (res.ok && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(e.request, copy)).catch(() => { /* quota: serve live, skip cache */ });
          }
          return res;
        })
        .catch(() => hit); // offline and uncached: let the request fail honestly
      // keep the worker alive until the background refresh lands in cache —
      // otherwise deploys can take extra visits to propagate
      e.waitUntil(refresh.then(() => {}, () => {}));
      return hit || refresh;
    })
  );
});
