"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export type CentralXpData = {
  worker: { id: string; name: string };
  progress: {
    total_xp: number;
    level: number;
    level_xp: number;
    level_span: number;
    next_level: number | null;
    remaining_xp: number;
    max_level?: boolean;
    tier?: { key: string; name: string; minLevel: number; maxLevel: number };
    xp_today: number;
    xp_week: number;
    xp_month: number;
    previous_week_xp: number;
  };
  weekly: Array<{ date: string; xp: number }>;
  rules: Array<{
    id?: string;
    action_key: string;
    name: string;
    description: string;
    xp_reward: number;
    frequency: string;
    enabled: boolean;
    integration_status: "connected" | "pending";
    created_at?: string;
    updated_at?: string;
  }>;
  recent: Array<{
    id: string;
    action_key: string;
    xp_amount: number;
    reference_label?: string | null;
    origin?: string | null;
    created_at: string;
  }>;
  stats: Record<string, number | null>;
  ranking: Array<{
    worker_id: string;
    name: string;
    xp: number;
    level: number;
    is_me: boolean;
    position: number;
  }>;
};

export function useCentralXpData() {
  const [data, setData] = useState<CentralXpData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesión no disponible");
      const response = await fetch(`/api/central/xp-system?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo cargar XP");
      setData(json as CentralXpData);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar XP");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const refreshTimer = window.setInterval(() => void load(true), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = sb
      .channel("central-xp-readonly")
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_rules" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_events" }, () => void load(true))
      .subscribe();

    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [load]);

  return { data, error, busy, load };
}
