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
    busy = useRef(false);
  const load = useCallback(
    async (force = false) => {
      if (busy.current && !force) return;
      busy.current = true;
      const id = ++seq.current;
      setLoading(true);
      try {
        const result = await bonusRequest(path);
        if (id === seq.current) {
          setData(result);
          setError("");
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
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("tc-counters-refresh", refresh);
    return () => {
      seq.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("tc-counters-refresh", refresh);
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
