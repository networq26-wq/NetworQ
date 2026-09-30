// NetworQ PWA Service Worker
const CACHE_NAME = "networq-pwa-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Network-first strategy: always fetch live so updates show immediately
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
