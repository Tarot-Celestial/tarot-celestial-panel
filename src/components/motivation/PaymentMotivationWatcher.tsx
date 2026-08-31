"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { CentralXpData } from "@/features/central/useCentralXpData";
import styles from "./PaymentMotivationWatcher.module.css";

const sb = supabaseBrowser();
const FALLBACK_POLL_MS = 120000;
const MAX_VISIBLE = 3;
const DISPLAY_MS = 4400;

type MotivationMode = "admin" | "central";
type XpEvent = {
  id: string;
  worker_id?: string | null;
  action_key: string;
  xp_amount: number;
  reference_id?: string | null;
  reference_label?: string | null;
  origin?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};
type PaymentDetail = {
  paymentId?: string;
  rendimientoId?: string;
  clientName?: string;
  amount?: number;
  currency?: string;
  countToday?: number;
  occurredAt?: string;
  xpEvent?: XpEvent | null;
};
type HudItem = {
  id: string;
  kind: "payment" | "xp";
  title: string;
  primary: string;
  secondary: string;
  meta?: string;
  progress?: number | null;
};
type PaymentSnapshot = {
  day_key: string;
  count: number;
  latest_payment: { id: string; importe: number; cliente_nombre: string | null } | null;
};

function money(value: number, currency = "EUR") {
  return Number(value || 0).toLocaleString("es-ES", { style: "currency", currency });
}

function paymentXpReference(event: XpEvent) {
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return String(metadata.payment_id || metadata.pago_id || event.reference_id || "");
}

export default function PaymentMotivationWatcher({
  mode,
  xpData,
  onStateRefresh,
}: {
  mode: MotivationMode;
  xpData?: CentralXpData | null;
  onStateRefresh?: (silent?: boolean) => unknown;
}) {
  const [items, setItems] = useState<HudItem[]>([]);
  const seenRef = useRef(new Set<string>());
  const mountedAtRef = useRef(Date.now());
  const lastPaymentRef = useRef("");
  const pollInFlightRef = useRef(false);
  const rules = useMemo(() => new Map((xpData?.rules || []).map((rule) => [rule.action_key, rule.name])), [xpData?.rules]);
  const workerId = String(xpData?.worker?.id || "");

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const enqueue = useCallback((item: HudItem) => {
    if (!item.id || seenRef.current.has(item.id)) return;
    seenRef.current.add(item.id);
    setItems((current) => [...current.filter((row) => row.id !== item.id), item].slice(-MAX_VISIBLE));
    window.setTimeout(() => dismiss(item.id), DISPLAY_MS);
  }, [dismiss]);

  const showXp = useCallback((event: XpEvent) => {
    const amount = Number(event.xp_amount || 0);
    if (!event.id || amount <= 0 || String(event.status || "applied") !== "applied") return;
    if (String(xpData?.pending_reward?.source_event_id || "") === String(event.id)) {
      seenRef.current.add(`xp:${event.id}`);
      return;
    }
    const total = Number(xpData?.progress?.total_xp || 0);
    const span = Number(xpData?.progress?.level_span || 0);
    const current = Number(xpData?.progress?.level_xp || 0);
    enqueue({
      id: `xp:${event.id}`,
      kind: "xp",
      title: "EXPERIENCIA OBTENIDA",
      primary: `+${amount.toLocaleString("es-ES")} XP`,
      secondary: String(event.reference_label || rules.get(event.action_key) || event.action_key || "Acción completada"),
      meta: total > 0 ? `Total: ${total.toLocaleString("es-ES")} XP` : undefined,
      progress: span > 0 ? Math.min(100, Math.max(0, (current / span) * 100)) : null,
    });
  }, [enqueue, rules, xpData?.pending_reward?.source_event_id, xpData?.progress]);

  const showPayment = useCallback((detail: PaymentDetail) => {
    const paymentId = String(detail.paymentId || detail.rendimientoId || "");
    if (!paymentId) return;
    const xpEvent = detail.xpEvent && Number(detail.xpEvent.xp_amount || 0) > 0 ? detail.xpEvent : null;
    if (xpEvent?.id) seenRef.current.add(`xp:${xpEvent.id}`);
    lastPaymentRef.current = paymentId;
    enqueue({
      id: `payment:${paymentId}`,
      kind: "payment",
      title: "COBRO REGISTRADO",
      primary: String(detail.clientName || "Clienta"),
      secondary: `${money(Number(detail.amount || 0), detail.currency || "EUR")}${xpEvent ? ` · +${Number(xpEvent.xp_amount).toLocaleString("es-ES")} XP` : ""}`,
      meta: detail.countToday ? `${detail.countToday} cobros hoy · Progreso actualizado` : "Progreso actualizado",
    });
    onStateRefresh?.(true);
  }, [enqueue, onStateRefresh]);

  useEffect(() => {
    const onPayment = (event: Event) => showPayment((event as CustomEvent<PaymentDetail>).detail || {});
    window.addEventListener("tc-payment-recorded", onPayment);
    return () => window.removeEventListener("tc-payment-recorded", onPayment);
  }, [showPayment]);

  useEffect(() => {
    if (mode !== "central" || !workerId) return;
    const channel = sb
      .channel(`central-event-hud-${workerId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "worker_xp_events",
        filter: `worker_id=eq.${workerId}`,
      }, (payload: { new: XpEvent }) => {
        const event = payload.new;
        if (new Date(event.created_at || 0).getTime() < mountedAtRef.current - 2500) return;
        const paymentReference = paymentXpReference(event);
        if (paymentReference && paymentReference === lastPaymentRef.current) {
          seenRef.current.add(`xp:${event.id}`);
          onStateRefresh?.(true);
          return;
        }
        showXp(event);
        onStateRefresh?.(true);
      })
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [mode, onStateRefresh, showXp, workerId]);

  useEffect(() => {
    let stopped = false;
    let initialized = false;
    const poll = async () => {
      if (document.visibilityState === "hidden" || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || stopped) return;
      const response = await fetch("/api/motivation/payments/latest", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      const snapshot = json?.snapshot as PaymentSnapshot | undefined;
      const latest = snapshot?.latest_payment;
      if (!latest?.id) return;
      if (!initialized) {
        initialized = true;
        lastPaymentRef.current = String(latest.id);
        return;
      }
      if (String(latest.id) !== lastPaymentRef.current) {
        showPayment({ paymentId: latest.id, clientName: latest.cliente_nombre || "Clienta", amount: latest.importe, countToday: snapshot?.count });
      }
      } finally {
        pollInFlightRef.current = false;
      }
    };
    void poll();
    // Realtime entrega el aviso inmediatamente. El sondeo queda como red de
    // seguridad y deja de golpear el endpoint cada 12 segundos.
    const channel = sb
      .channel(`payment-motivation-${mode}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_cliente_pagos" }, () => void poll())
      .subscribe();
    const timer = window.setInterval(() => void poll(), FALLBACK_POLL_MS);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      void sb.removeChannel(channel);
    };
  }, [mode, showPayment]);

  if (!items.length) return null;
  return (
    <div className={styles.stack} role="region" aria-label="Eventos recientes" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <article key={item.id} className={`${styles.card} ${styles[item.kind]}`}>
          <div className={styles.icon} aria-hidden="true">{item.kind === "payment" ? <Check size={18} /> : <Sparkles size={18} />}</div>
          <div className={styles.content}>
            <div className={styles.kicker}>{item.title}</div>
            <strong className={styles.primary}>{item.primary}</strong>
            <div className={styles.secondary}>{item.secondary}</div>
            {item.meta ? <small className={styles.meta}>{item.meta}</small> : null}
            {typeof item.progress === "number" ? <div className={styles.progress} aria-label="Progreso del nivel"><span style={{ width: `${item.progress}%` }} /></div> : null}
          </div>
          <button type="button" className={styles.close} onClick={() => dismiss(item.id)} aria-label="Cerrar notificación"><X size={15} /></button>
        </article>
      ))}
    </div>
  );
}
