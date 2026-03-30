// src/lib/attendance/presence.ts
type AttendanceEventType = "online" | "offline" | "heartbeat";

export type PresenceStartOptions = {
  endpoint?: string; // por defecto /api/panel-tarotista/attendance/event
  token: string; // supabase access_token
  meta?: Record<string, any>;
  heartbeatEveryMs?: number; // default 30s
};

export type PresenceController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
};

async function postEvent(endpoint: string, token: string, event_type: AttendanceEventType, meta?: any) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ event_type, meta: meta || {} }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export function createPresenceController(opts: PresenceStartOptions): PresenceController {
  const endpoint = opts.endpoint || "/api/panel-tarotista/attendance/event";
  const token = opts.token;
  const metaBase = opts.meta || {};
  const every = Number.isFinite(opts.heartbeatEveryMs) ? Number(opts.heartbeatEveryMs) : 30_000;

  let timer: any = null;

  const isRunning = () => !!timer;

  const start = async () => {
    if (timer) return;

    // 1) online
    await postEvent(endpoint, token, "online", { ...metaBase });

    // 2) heartbeat inmediato (clave para que el sistema lo marque como “online real”)
    await postEvent(endpoint, token, "heartbeat", { ...metaBase, immediate: true });

    // 3) loop
    timer = setInterval(() => {
      postEvent(endpoint, token, "heartbeat", { ...metaBase }).catch(() => {
        // No rompemos la UI por un fallo puntual; si quieres, aquí puedes loguear
      });
    }, every);
  };

  const stop = async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await postEvent(endpoint, token, "offline", { ...metaBase });
  };

  return { start, stop, isRunning };
}
