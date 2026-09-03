"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Private filtered signal. No interval and no subscription while hidden. */
export function useRouletteSignal(sb: SupabaseClient, clienteId: string | null | undefined, refresh: () => Promise<unknown> | void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!clienteId) return;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false, running = false, dirty = false;
    const schedule = () => {
      if (disposed || document.hidden) return;
      if (running) { dirty = true; return; }
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        if (disposed || document.hidden) return;
        running = true;
        try { await latest.current(); } catch { /* Keep last confirmed data. */ }
        finally { running = false; if (dirty) { dirty = false; schedule(); } }
      }, 450);
    };
    const connect = () => {
      if (disposed || document.hidden || channel) return;
      channel = sb.channel("ruleta-signal-" + clienteId + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "cliente_ruleta_signal", filter: "cliente_id=eq." + clienteId }, schedule)
        .subscribe((status) => { if (status === "SUBSCRIBED") schedule(); });
    };
    const visibility = () => {
      if (document.hidden) { if (channel) void sb.removeChannel(channel); channel = null; }
      else { connect(); schedule(); }
    };
    connect();
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (channel) void sb.removeChannel(channel);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sb, clienteId]);
}
