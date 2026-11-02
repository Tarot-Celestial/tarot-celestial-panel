"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ClientReward = {
  id: string;
  nombre: string;
  puntos_coste: number;
  minutos_otorgados: number;
  activo?: boolean | null;
};

/** The public catalogue must refresh even when another dashboard module fails. */
export function useClientRewards() {
  const [rewards, setRewards] = useState<ClientReward[]>([]);
  const [error, setError] = useState("");
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    const request = (async () => {
      try {
        const response = await fetch(`/api/cliente/recompensas?fresh=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (!response.ok || !data?.ok || !Array.isArray(data.recompensas)) throw new Error("CATALOG_UNAVAILABLE");
        if (mounted.current) { setRewards(data.recompensas); setError(""); }
      } catch {
        if (mounted.current) setError("No se ha podido actualizar el catálogo. Reintenta antes de canjear.");
      }
    })();
    pending.current = request.finally(() => { pending.current = null; });
    return pending.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    visibleRefresh();
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);
  return { rewards, error, refresh };
}
