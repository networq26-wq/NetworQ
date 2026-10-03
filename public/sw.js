/* NetworQ service worker: Web Push only (no offline caching). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch (e) {
    msg = { title: "NetworQ", body: event.data ? event.data.text() : "" };
  }
  const title = msg.title || "NetworQ";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || "",
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: (msg.data && msg.data.notification_id) || undefined,
      data: { url: msg.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
