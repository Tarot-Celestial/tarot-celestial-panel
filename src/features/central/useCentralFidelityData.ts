"use client";

import { useCallback, useEffect, useState } from "react";
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
function summarize(scores: Record<string, number>) {
  const values = Object.values(scores).filter(Number.isFinite);
  return { average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null, clientCount: values.length };
}

export function useCentralFidelityData(enabled: boolean) {
  const [brand, setBrand] = useState<"celestial" | "orion">("celestial");
  const [state, setState] = useState<FidelityState>({ average: null, clientCount: 0, scores: {}, workerId: null });
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "error">("syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

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

  const refreshClient = useCallback(async (clientId: string) => {
    if (!enabled || !clientId) return;
    try {
      const params = new URLSearchParams({ marca: brand, client_id: clientId });
      const response = await fetch(`/api/central/client-fidelity?${params.toString()}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error("Fidelity unavailable");
      setState((current) => {
        const scores = { ...current.scores };
        if (!payload.owned || !payload.fidelity) delete scores[clientId];
        else scores[clientId] = Number(payload.fidelity.score || 0);
        return { ...current, scores, ...summarize(scores) };
      });
      setSyncStatus("synced"); setLastSyncedAt(new Date().toISOString());
    } catch { setSyncStatus("error"); }
  }, [brand, enabled]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled) return;
    const client = supabaseBrowser();
    const refreshFromPayload = (payload: any) => {
      const row = payload?.new || payload?.old || {};
      const clientId = String(row.cliente_id || row.client_id || (payload?.table === "crm_clientes" ? row.id : "") || "");
      if (clientId) void refreshClient(clientId); else void load(true);
    };
    const channel = client.channel("central-fidelity-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_capture_assignments" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_clientes" }, refreshFromPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, refreshFromPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, refreshFromPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_interacciones" }, refreshFromPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_followups" }, refreshFromPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_rank_overrides" }, refreshFromPayload)
      .subscribe();
    const fallback = window.setInterval(() => void load(true), 60_000);
    return () => { window.clearInterval(fallback); void client.removeChannel(channel); };
  }, [enabled, load, refreshClient]);

  return { ...state, syncStatus, lastSyncedAt, load };
}
