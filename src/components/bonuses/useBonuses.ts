"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export async function bonusRequest(path: string, body?: unknown) {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión de nuevo.");

  const response = await fetch(path, {
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await response.json();
  if (!response.ok || json.ok === false)
    throw new Error(json.error || "No se pudo completar la operación.");
  return json;
}

export function useBonuses(path: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);

  const seq = useRef(0),
    busy = useRef(false),
    lastLoadedAt = useRef(0),
    channelKey = useRef(`bonus-sync-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(
    async (force = false) => {
      if (busy.current && !force) return;
      busy.current = true;
      const id = ++seq.current;
      if (!force) setLoading(true);

      try {
        const separator = path.includes("?") ? "&" : "?";
        const result = await bonusRequest(`${path}${separator}_sync=${Date.now()}`);
        if (id === seq.current) {
          setData(result);
          setError("");
          lastLoadedAt.current = Date.now();
        }
      } catch (e) {
        if (id === seq.current)
          setError(
            e instanceof Error ? e.message : "No se pudieron cargar los bonos.",
          );
      } finally {
        if (id === seq.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [path],
  );

  useEffect(() => {
    busy.current = false;
    setData(null);
    void load(false);

    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };

    // Respaldo ligero si Realtime pierde un evento. Realtime sigue siendo la vía
    // principal; este refetch evita que una sesión abierta quede obsoleta.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadedAt.current < 12000) return;
      void load(true);
    }, 15000);

    const sb = supabaseBrowser();
    const channel = sb
      .channel(channelKey.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tarotista_bonus_rules" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tarotista_bonus_awards" },
        () => void load(true),
      )
      .subscribe();

    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    window.addEventListener("tc-counters-refresh", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);

    return () => {
      seq.current++;
      busy.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      window.removeEventListener("tc-counters-refresh", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      void sb.removeChannel(channel);
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, error, loading, load: refresh };
}

export const euro = (value: unknown) =>
  value === null
    ? "Importe protegido"
    : Number(value || 0).toLocaleString("es-ES", {
        style: "currency",
        currency: "EUR",
      });

export const monthNow = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
};
