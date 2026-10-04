"use client";

import { useEffect, useState } from "react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";

/** Read the effective rank, including temporary overrides, from the existing API. */
export function useClientPanelState() {
  const [ritualAccess, setRitualAccess] = useState(false);
  const [rank, setRank] = useState<string | null>(null);
  useEffect(() => {
    const sb = supabaseClienteBrowser();
    let active = true;
    let loading = false;
    let accountId: string | null = null;
    let generation = 0;
    let authTimer: number | undefined;
    let stateChannel: ReturnType<typeof sb.channel> | null = null;
    let stateClientId: string | null = null;
    const disconnectState = () => {
      if (stateChannel) void sb.removeChannel(stateChannel);
      stateChannel = null;
      stateClientId = null;
    };
    const connectState = (clientId: string | null) => {
      if (!clientId || stateClientId === clientId) return;
      disconnectState();
      stateClientId = clientId;
      stateChannel = sb.channel("cliente-panel-state-" + clientId)
        .on("postgres_changes", { event: "*", schema: "public", table: "cliente_ruleta_signal", filter: "cliente_id=eq." + clientId }, () => void refresh())
        .subscribe();
    };
    const refresh = async () => {
      if (!active || loading || document.visibilityState === "hidden") return;
      loading = true;
      const requestGeneration = generation;
      try {
        const { data } = await sb.auth.getSession();
        const session = data.session;
        if (session?.user.id !== accountId) {
          accountId = session?.user.id || null;
          if (active) { setRank(null); setRitualAccess(false); }
        }
        if (!session) return;
        const response = await fetch(`/api/cliente/me?fresh=${Date.now()}`, {
          headers: { Authorization: `Bearer ${session.access_token}`, "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" }, cache: "no-store",
        });
        const result = await response.json();
        if (active && requestGeneration === generation) {
          if (response.ok && result.ok) {
            setRank(result.wallet?.effective_rank || result.cliente?.rango_actual || null);
            setRitualAccess(result.rank_benefits?.ritual_access === true);
            connectState(result.cliente?.id || null);
          } else setRitualAccess(false);
        }
      } catch { if (active && requestGeneration === generation) setRitualAccess(false); }
      finally { loading = false; if (active && requestGeneration !== generation) void refresh(); }
    };
    void refresh();
    const refreshVisible = () => { void refresh(); };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("tc-client-notifications-change", refreshVisible);
    const timer = window.setInterval(refreshVisible, 10_000);
    const { data: auth } = sb.auth.onAuthStateChange((event, session) => {
      if (session?.user.id !== accountId) { if (event !== "INITIAL_SESSION") generation += 1; accountId = session?.user.id || null; if (active) { setRank(null); setRitualAccess(false); } }
      window.clearTimeout(authTimer);
      authTimer = window.setTimeout(refreshVisible, 0);
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearTimeout(authTimer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("tc-client-notifications-change", refreshVisible);
      auth.subscription.unsubscribe();
      disconnectState();
    };
  }, []);
  return { rank, ritualAccess };
}

export function useClientPanelRank() { return useClientPanelState().rank; }

