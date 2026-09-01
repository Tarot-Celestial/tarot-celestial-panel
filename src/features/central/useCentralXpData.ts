"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { tcToast } from "@/lib/tc-toast";

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
    is_today: boolean;
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
      kind: "payment" | "followup" | "capture" | "xp" | "level_reward";
      source_id: string;
      client_name: string;
      amount?: number;
      currency?: string;
      detail?: string;
      occurred_at: string;
      xp: number;
      coins?: number;
      origin?: string;
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
  missions:{available:boolean;active:Array<{id:string;mission_key:string;name:string;description:string;source_action_key:string;target_count:number;xp_reward:number;period:string;max_claims:number|null;unique_clients:boolean;delivery_mode:"manual"|"automatic";unit_label:string|null;progress:number;completed:boolean;claimed:boolean;claim_count:number;period_key:string}>;catalog:Array<any>;level_links:Array<{level:number;mission_id:string}>;tier_links:Array<{tier_key:string;mission_id:string}>};
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
  coin_exchange: {
    available: boolean;
    enabled: boolean;
    historical_xp: number;
    spent_xp: number;
    available_xp: number;
    coin_balance: number;
    ratio: { xp_units: number; coin_units: number; min_xp: number; updated_at: string } | null;
    history: Array<{ id: string; xp_spent: number; coins_granted: number; ratio_xp: number; ratio_coins: number; status: string; created_at: string }>;
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

export function useCentralXpData(selectedDate?: string, enabled = true) {
  const [data, setData] = useState<CentralXpData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "error">("syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const refreshDebounceRef = useRef<number | null>(null);
  const completedMissionRef = useRef<Set<string> | null>(null);
  const workerId = data?.worker.id || null;

  const load = useCallback(async (silent = false) => {
    if (!enabled) return false;
    if (inFlightRef.current) return inFlightRef.current;

    const task = (async () => {
      const requestId = ++requestRef.current;
      if (!silent) setBusy(true);
      setSyncStatus("syncing");
      try {
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Sesión no disponible");
        const dateParam = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : "";
        const response = await fetch(`/api/central/xp-system?t=${Date.now()}${dateParam}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo cargar XP");
        if (requestId === requestRef.current) {
          const typed = json as CentralXpData;
          const completedNow = new Set((typed.missions?.active || []).filter(mission => mission.completed && !mission.claimed).map(mission => `${mission.id}:${mission.period_key}:${mission.claim_count}`));
          if (completedMissionRef.current) {
            const newlyCompleted = (typed.missions?.active || []).find(mission => mission.completed && !mission.claimed && !completedMissionRef.current?.has(`${mission.id}:${mission.period_key}:${mission.claim_count}`));
            if (newlyCompleted) tcToast({ title: "🏆 MISIÓN COMPLETADA", description: `${newlyCompleted.name} · +${newlyCompleted.xp_reward} XP disponibles`, tone: "success", duration: 8000 });
          }
          completedMissionRef.current = completedNow;
          setData(typed);
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
    })();

    inFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (inFlightRef.current === task) inFlightRef.current = null;
    }
  }, [enabled, selectedDate]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || !workerId) return;
    let disposed = false;

    const refreshSoon = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshDebounceRef.current != null) window.clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = window.setTimeout(() => {
        refreshDebounceRef.current = null;
        void load(true);
      }, 1000);
    };
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 300_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    const onLocalXp = refreshSoon;
    window.addEventListener("tc-xp-recorded", onLocalXp);

    const channel = sb
      .channel(`central-xp-readonly-${workerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_events", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_mission_claims", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_reward_claims", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_reward_processing", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_coin_wallets", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_coin_conversions", filter: `worker_id=eq.${workerId}` }, refreshSoon)
      .subscribe((status, channelError) => {
        if (disposed) return;
        // CLOSED es el resultado normal de removeChannel al cambiar de pestaña.
        // Solo los estados que Supabase documenta como fallo deben encender el
        // indicador rojo.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[central-xp-realtime]", status, channelError);
          setSyncStatus("error");
        }
      });

    return () => {
      disposed = true;
      requestRef.current += 1;
      window.clearInterval(refreshTimer);
      if (refreshDebounceRef.current != null) {
        window.clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("tc-xp-recorded", onLocalXp);
      void sb.removeChannel(channel);
    };
  }, [enabled, load, workerId]);

  const claimLevelReward = useCallback(async (level: number, operationId: string) => {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sesión no disponible");
    const response = await fetch("/api/central/xp-system", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op: "claim_level_reward", level, operation_id: operationId }),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo reclamar la recompensa");
    await load(true);
    return json.claim;
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

  const exchangeXp = useCallback(async (xpAmount: number, operationId: string) => {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sesión no disponible");
    const response = await fetch("/api/central/xp-system", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op: "exchange_xp", xp_amount: xpAmount, operation_id: operationId }),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo completar el canje");
    await load(true);
    return json.exchange;
  }, [load]);

  const claimMission=useCallback(async(missionId:string,periodKey:string)=>{const {data:sessionData}=await sb.auth.getSession();const token=sessionData.session?.access_token;if(!token)throw new Error("Sesión no disponible");const response=await fetch("/api/central/xp-system",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({op:"claim_mission",mission_id:missionId,period_key:periodKey})});const json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo reclamar la misión");await load(true);return json.claim;},[load]);

  return { data, error, busy, load, acknowledgeReward, exchangeXp, claimLevelReward, claimMission, syncStatus, lastSyncedAt };
}
