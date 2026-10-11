/* global self, caches, __VERSION__, __PRECACHE__ */
/**
 * AE Studio kabineti — service worker. Build vaqtida (vite.config.ts → pwa plagini) `sw.js` ga aylanadi:
 * __VERSION__ — build fayllari xeshi, __PRECACHE__ — app shell (index, JS/CSS, ikonlar).
 *
 * Strategiya: sahifalar — avval tarmoq, yo'q bo'lsa keshdagi index.html (oflayn ochiladi);
 * xeshlangan build fayllari va ikonlar — avval kesh; Google Fonts — keshdan, fonda yangilanadi.
 * API va server yo'llari hech qachon keshlanmaydi.
 */
const VERSION = __VERSION__;
const SHELL = `aes-shell-${VERSION}`;
const FONTS = "aes-fonts";
const PRECACHE = __PRECACHE__;
const NETWORK_ONLY = ["/api/", "/oauth/", "/ws/", "/storage/", "/mcp", "/health", "/.well-known/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function fromNetworkThenShell(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match("/", { cacheName: SHELL });
    return cached ?? Response.error();
  }
}

async function fromCacheThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL);
    void cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") void cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(fromNetworkThenShell(request));
    return;
  }
  event.respondWith(fromCacheThenNetwork(request));
});
