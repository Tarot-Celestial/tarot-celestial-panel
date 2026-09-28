self.addEventListener("push", function (event) {
  let data = { title: "Tarot Celestial", body: "Tienes una nueva notificación.", url: "/cliente/dashboard", icon: "/Nuevo-logo-tarot.png", tag: "tarot-celestial" };

  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") {
      data = { ...data, ...parsed };
    }
  } catch (e) {}

  if (data.expiresAt && Date.parse(data.expiresAt) <= Date.now()) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.icon,
      image: data.image,
      tag: data.tag,
      data: { url: data.url || "/cliente/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const candidate = new URL(event.notification?.data?.url || "/cliente/dashboard", self.location.origin);
  const targetUrl = candidate.origin === self.location.origin ? candidate.href : self.location.origin + "/cliente/notificaciones";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windowClients) {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
