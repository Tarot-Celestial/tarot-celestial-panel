"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { supabaseBrowser } from "@/lib/supabase-browser";

type FidelityState = {
  average: number | null;
  clientCount: number;
  scores: Record<string, number>;
  workerId: string | null;
};

async function accessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || "";
}
export function useCentralFidelityData(enabled: boolean) {
  const [brand, setBrand] = useState<"celestial" | "orion">("celestial");
  const [state, setState] = useState<FidelityState>({ average: null, clientCount: 0, scores: {}, workerId: null });
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "error">("syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setBrand(getActiveBrand());
    const changeBrand = (event: Event) => setBrand((event as CustomEvent<{ brand?: string }>).detail?.brand === "orion" ? "orion" : "celestial");
    window.addEventListener("tc-brand-changed", changeBrand as EventListener);
    return () => window.removeEventListener("tc-brand-changed", changeBrand as EventListener);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!enabled) return;
    if (!silent) setSyncStatus("syncing");
    try {
      const response = await fetch(`/api/central/client-fidelity?marca=${brand}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Fidelity unavailable");
      const scores = Object.fromEntries((payload.scores || []).map((row: any) => [String(row.client_id), Number(row.score || 0)]));
      setState({ average: payload.average == null ? null : Number(payload.average), clientCount: Number(payload.client_count || 0), scores, workerId: payload.worker_id || null });
      setSyncStatus("synced"); setLastSyncedAt(new Date().toISOString());
    } catch {
      setSyncStatus("error");
    }
  }, [brand, enabled]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled || !state.workerId) return;
    const client = supabaseBrowser();
    const refreshSoon = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshTimerRef.current != null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void load(true);
      }, 800);
    };
    const channel = client.channel(`central-fidelity-sync-${state.workerId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_client_capture_assignments",
        filter: `responsible_worker_id=eq.${state.workerId}`,
      }, refreshSoon)
      .subscribe();
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 300_000);
    return () => {
      window.clearInterval(fallback);
      if (refreshTimerRef.current != null) window.clearTimeout(refreshTimerRef.current);
      void client.removeChannel(channel);
    };
  }, [enabled, load, state.workerId]);

  return { ...state, syncStatus, lastSyncedAt, load };
}
