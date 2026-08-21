import { precacheAndRoute } from "workbox-precaching";

// Precache only the built app shell (JS/CSS/HTML/icons) so the app installs
// and launches instantly offline. Chat data, uploads, and the socket
// connection are never cached — they're deliberately left to the network so
// nothing stale is ever shown.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "RealChat", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "RealChat";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { room: data.room || null },
    tag: data.room ? `room-${data.room}` : undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        const existing = clientsArr.find((c) => "focus" in c);
        if (existing) return existing.focus();
        return self.clients.openWindow("/");
      }),
  );
});
