"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    tier?: { key: string; name: string; display_order: number; active: boolean; reward_type: string | null; reward_amount: number | null; reward_label: string | null } | null;
    total_required_for_max?: number;
    xp_today: number;
    xp_week: number;
    xp_month: number;
    previous_week_xp: number;
  };
  daily_activity: {
    date: string;
    timezone: string;
    total_actions: number;
    total_xp: number;
    items: Array<{
      key: "payments" | "followups" | "captures";
      count: number;
      xp: number;
      amount?: number | null;
    }>;
    activities: Array<{
      id: string;
      kind: "payment" | "followup" | "capture";
      source_id: string;
      client_name: string;
      amount?: number;
      currency?: string;
      detail?: string;
      occurred_at: string;
      xp: number;
    }>;
  };
  level_config: Array<{
    level: number;
    xp_to_next: number | null;
    tier_key: string;
    reward_type: string | null;
    reward_amount: number | null;
    reward_label: string | null;
    active: boolean;
    display_order: number;
  }>;
  tier_config: Array<{
    key: string;
    name: string;
    display_order: number;
    active: boolean;
    reward_type: string | null;
    reward_amount: number | null;
    reward_label: string | null;
  }>;
  level_config_persisted?: boolean;
  reward_system_available?: boolean;
  reward_claims: Array<{
    id: string;
    reward_kind: "level" | "category";
    reward_key: string;
    level: number | null;
    tier_key: string | null;
    reward_type: string | null;
    reward_amount: number | null;
    reward_label: string | null;
    source_event_id: string | null;
    status: string;
    seen_at: string | null;
    created_at: string;
  }>;
  pending_reward: {
    id: string;
    reward_kind: "level" | "category";
    reward_key: string;
    level: number | null;
    tier_key: string | null;
    reward_type: string | null;
    reward_amount: number | null;
    reward_label: string | null;
    source_event_id: string | null;
    status: string;
    seen_at: string | null;
    created_at: string;
  } | null;
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
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "error">("syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const requestId = ++requestRef.current;
    if (!silent) setBusy(true);
    setSyncStatus("syncing");
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
      if (requestId === requestRef.current) {
        setData(json as CentralXpData);
        setError("");
        setLastSyncedAt(new Date().toISOString());
        setSyncStatus("synced");
      }
      return true;
    } catch (loadError) {
      if (requestId === requestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar XP");
        setSyncStatus("error");
      }
      return false;
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
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_level_config" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_tier_config" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_reward_claims" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_followups" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => void load(true))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setSyncStatus("error");
      });

    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [load]);

  const acknowledgeReward = useCallback(async (claimId: string) => {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sesión no disponible");
    const response = await fetch("/api/central/xp-system", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op: "ack_reward_claim", claim_id: claimId }),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo confirmar la recompensa");
    setData((current) => current ? { ...current, pending_reward: null } : current);
    void load(true);
  }, [load]);

  return { data, error, busy, load, acknowledgeReward, syncStatus, lastSyncedAt };
}
