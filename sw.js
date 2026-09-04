/* sw.js — offline shell. After the first visit, Levels 1 and 3 run with the
   network fully off — which is the honest proof behind "nothing you type
   leaves your device": a site that needed a server couldn't do this.

   Same-origin GET only. Level 2's relay POSTs (cross-origin) pass through
   untouched, and nothing a user types is ever cached — this stores only the
   app's own files, exactly like the browser's HTTP cache.

   Strategy: cache-first with background refresh (stale-while-revalidate).
   After a deploy, a page may render one visit stale and be current the next —
   the honest trade for working offline. Bump VERSION to force a clean sweep. */

const VERSION = "bit-v22"; // bump per deploy: forces one atomic fresh snapshot

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
  "js/crisis.js",
  "js/region.js",
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
  "js/voice.js",
  "fonts/bricolage-grotesque-latin.woff2",
  "media/hero-poster.jpg",
  "media/story-poster.jpg",
  "media/warm-poster.jpg",
  "manifest.webmanifest",
  "icon.svg",
  // NEVER add media/voice/* here: those files may not exist, and one 404
  // fails cache.addAll and bricks the whole install. Voice clips are cached
  // at runtime by serveAudio() below.
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

/* Audio needs its own path: media elements send Range headers, servers answer
   206, and a 206 must never be cached as if it were the whole file. Cache ONE
   full 200 (fetched without Range), then serve byte slices from it — that's
   what makes the voice clips genuinely work offline, including iOS Safari,
   which insists on a real 206 for ranged media requests. */
async function serveAudio(e, url) {
  const key = url.origin + url.pathname;
  const cache = await caches.open(VERSION);
  let full = await cache.match(key);
  if (!full) {
    full = await fetch(key, { cache: "no-cache" }); // plain GET: no Range
    if (full.ok && full.status === 200 && full.type === "basic") {
      await cache.put(key, full.clone()).catch(() => { /* quota: stream live */ });
    } else {
      return full;
    }
  }
  const range = e.request.headers.get("range");
  if (!range) return full;
  const buf = await full.arrayBuffer(); // cache.match returned a copy — safe to consume
  const total = buf.byteLength;
  const ctype = full.headers.get("Content-Type") || "audio/mpeg";
  // parse "bytes=A-B", "bytes=A-" (open end), and "bytes=-N" (suffix); anything
  // else or out-of-range gets a spec-correct 416 instead of a broken 206
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] === "" && m[2] !== "") { // suffix: last N bytes
    const n = Math.min(Number(m[2]), total);
    start = total - n; end = total - 1;
  } else if (m && m[1] !== "") {
    start = Number(m[1]);
    end = m[2] !== "" ? Math.min(Number(m[2]), total - 1) : total - 1;
  } else {
    return full; // unparseable / multi-range: serve the whole file, not a lie
  }
  if (start > end || start < 0 || start >= total) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": ctype,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith(".mp3")) {
    e.respondWith(serveAudio(e, url).catch(() => fetch(e.request)));
    return;
  }

  e.respondWith(
    // ignoreSearch: links shared through chat apps grow tracking params
    // (?fbclid=…) — those must still hit the cached page offline
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      // no-cache: revalidate against the server (conditional request), not the
      // HTTP cache — otherwise the background refresh can re-store the very
      // stale copy it was meant to replace
      const refresh = fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          // cache complete same-origin 200s only (an opaque or partial
          // response would poison the cache for offline use)
          if (res.ok && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            // key by pathname only — putting the full ?fbclid=… URL while
            // matching with ignoreSearch lets an old variant shadow every
            // later refresh (Cache entries match in insertion order).
            // waitUntil: the put itself must outlive the response, or the
            // worker can be killed before the refresh actually lands.
            e.waitUntil(
              caches.open(VERSION).then((cache) => cache.put(url.origin + url.pathname, copy)).catch(() => { /* quota: serve live, skip cache */ })
            );
          }
          return res;
        })
        .catch(() => hit); // offline and uncached: let the request fail honestly
      // keep the worker alive until the background refresh lands in cache —
      // otherwise deploys can take extra visits to propagate. NOT redundant:
      // this synchronous registration is also the pendency anchor that makes
      // the async waitUntil around cache.put above spec-legal (an event must
      // hold a pending extend-lifetime promise for later waitUntil calls).
      e.waitUntil(refresh.then(() => {}, () => {}));
      return hit || refresh;
    })
  );
});
