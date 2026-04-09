self.addEventListener("push", function (event) {
  let data = { title: "Tarot Celestial", body: "Tienes una nueva notificación.", url: "/cliente/dashboard", icon: "/Nuevo-logo-tarot.png", tag: "tarot-celestial" };

  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") {
      data = { ...data, ...parsed };
    }
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.icon,
      tag: data.tag,
      data: { url: data.url || "/cliente/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/cliente/dashboard";
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
