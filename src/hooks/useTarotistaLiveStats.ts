"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TAROTISTA_STATS_POLL_MS = 20_000;

type Options = {
  client: SupabaseClient;
  enabled: boolean;
  polling: boolean;
  userId: string;
  workerId: string;
  month: string;
};
type Scope = { key: string; generation: number };
type Pending = { scope: Scope; controller: AbortController; promise: Promise<any | null>; timer: number };

/** Read only the authenticated tarotista's monthly metrics. Never generate invoices. */
export function useTarotistaLiveStats({ client, enabled, polling, userId, workerId, month }: Options) {
  const key = enabled && userId && workerId ? `${userId}:${workerId}:${month}` : "";
  const scope = useRef<Scope>({ key, generation: 0 });
  if (scope.current.key !== key) scope.current = { key, generation: scope.current.generation + 1 };
  const pending = useRef<Pending | null>(null);
  const blocked = useRef(false);
  const [snapshot, setSnapshot] = useState<{ scope: Scope; value: any } | null>(null);

  useEffect(() => {
    blocked.current = false;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (String(session?.user?.id || "") === userId) return;
      blocked.current = true;
      scope.current = { ...scope.current, generation: scope.current.generation + 1 };
      pending.current?.controller.abort();
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
      setSnapshot(null);
    });
    return () => data.subscription.unsubscribe();
  }, [client, userId]);

  useEffect(() => () => {
    scope.current = { ...scope.current, generation: scope.current.generation + 1 };
    pending.current?.controller.abort();
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  }, [key]);

  const refresh = useCallback((requestedMonth = month): Promise<any | null> => {
    const requestScope = scope.current;
    if (!key || requestScope.key !== key || requestedMonth !== month || blocked.current) return Promise.resolve(null);
    if (pending.current?.scope === requestScope && !pending.current.controller.signal.aborted) return pending.current.promise;
    pending.current?.controller.abort();
    if (pending.current) window.clearTimeout(pending.current.timer);
    const controller = new AbortController();
    const current = () => scope.current === requestScope && !blocked.current && !controller.signal.aborted;
    let rejectStopped: (reason: Error) => void = () => {};
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    const onAbort = () => rejectStopped(new Error("STATS_READ_CANCELLED"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const request: Pending = { scope: requestScope, controller, promise: Promise.resolve(null), timer: 0 };
    request.timer = window.setTimeout(() => {
      controller.abort();
      if (pending.current === request) pending.current = null;
    }, 12_000);
    request.promise = (async () => {
      try {
        const { data } = await Promise.race([client.auth.getSession(), stopped]);
        if (!current()) return null;
        if (!data.session?.access_token || String(data.session.user.id) !== userId) {
          setSnapshot(null);
          return null;
        }
        const response = await Promise.race([fetch(`/api/stats/monthly?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
          signal: controller.signal,
        }), stopped]);
        const value = await Promise.race([response.json(), stopped]);
        if (!current()) return null;
        if (!response.ok || !value?.ok || value.month !== month || String(value.worker?.id || "") !== workerId
          || value.worker?.role !== "tarotista") return null;
        setSnapshot({ scope: requestScope, value });
        return value;
      } catch {
        // A temporary read failure preserves the last confirmed figures and Auth.
        return null;
      } finally {
        window.clearTimeout(request.timer);
        controller.signal.removeEventListener("abort", onAbort);
        if (pending.current === request) pending.current = null;
      }
    })();
    pending.current = request;
    return request.promise;
  }, [client, key, month, userId, workerId]);

  useEffect(() => {
    if (!key || !polling) return;
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    visibleRefresh();
    const interval = window.setInterval(visibleRefresh, TAROTISTA_STATS_POLL_MS);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [key, polling, refresh]);

  return { stats: snapshot?.scope === scope.current ? snapshot.value : null, refresh };
}
