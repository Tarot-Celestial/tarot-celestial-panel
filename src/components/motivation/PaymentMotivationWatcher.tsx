"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();
const TZ = "Europe/Madrid";
const POLL_MS = 12000;
const AUTO_HIDE_MS = 9800;

type MotivationMode = "admin" | "central";

type PaymentSnapshot = {
  day_key: string;
  count: number;
  latest_payment: {
    id: string;
    importe: number;
    cliente_nombre: string | null;
    telefonista_nombre: string | null;
    fecha_hora: string | null;
    created_at: string | null;
  } | null;
};

type ApiResponse = {
  ok: boolean;
  snapshot?: PaymentSnapshot;
  error?: string;
};

type ToastState = {
  visible: boolean;
  title: string;
  message: string;
  badge: string;
  count: number;
  amount: number;
};

function motivationCopy(count: number) {
  if (count <= 1) {
    return {
      badge: "PRIMER COBRO",
      title: "🎉 ¡BRAVO! Ya llegó el primer cobro del día",
      message: "Vamos a por más. Con foco, ritmo y energía todo se consigue 🔥",
    };
  }

  const variants = [
    {
      badge: `COBRO #${count}`,
      title: `💪 ¡Muy bien! Ya vais por el cobro nº ${count}`,
      message: "Buen ritmo. Seguid empujando, que hoy puede ser un día grande.",
    },
    {
      badge: `COBRO #${count}`,
      title: `🚀 Cobro nº ${count} registrado`,
      message: "Estáis en racha. Mantened la intensidad y a por el siguiente.",
    },
    {
      badge: `COBRO #${count}`,
      title: `🔥 Ya va el cobro nº ${count}`,
      message: "Hoy estáis imparables. Trabajo duro, foco y a seguir sumando.",
    },
    {
      badge: `COBRO #${count}`,
      title: `✨ Otro cobro más: ${count} en el día`,
      message: "Excelente dinámica. Cada llamada bien trabajada acerca el siguiente cierre.",
    },
  ];

  return variants[(count - 2) % variants.length];
}

function safeAmount(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v: number) {
  return safeAmount(v).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function storageKey(mode: MotivationMode, dayKey: string) {
  return `tc_payment_motivation:${mode}:${dayKey}`;
}

export default function PaymentMotivationWatcher({ mode }: { mode: MotivationMode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const initializedRef = useRef(false);
  const activeDayRef = useRef<string>("");
  const lastSeenCountRef = useRef(0);
  const dismissTimerRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);
  const busyRef = useRef(false);

  const accent = useMemo(() => {
    return mode === "admin"
      ? "linear-gradient(135deg, rgba(215,181,109,0.98), rgba(255,132,100,0.98))"
      : "linear-gradient(135deg, rgba(120,255,190,0.98), rgba(181,156,255,0.98))";
  }, [mode]);

  function hideToast() {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setToast(null);
  }

  function scheduleHide() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setToast(null);
    }, AUTO_HIDE_MS);
  }

  function markShown(dayKey: string, count: number) {
    try {
      window.localStorage.setItem(storageKey(mode, dayKey), String(count));
    } catch {}
  }

  function readShown(dayKey: string) {
    try {
      return Number(window.localStorage.getItem(storageKey(mode, dayKey)) || 0) || 0;
    } catch {
      return 0;
    }
  }

  function showMotivation(snapshot: PaymentSnapshot) {
    const count = Number(snapshot?.count || 0);
    if (!count) return;

    const copy = motivationCopy(count);
    const amount = safeAmount(snapshot?.latest_payment?.importe);

    setToast({
      visible: true,
      title: copy.title,
      message: copy.message,
      badge: copy.badge,
      count,
      amount,
    });
    scheduleHide();
  }

  async function loadSnapshot() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/motivation/payments/latest", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-store",
        },
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok || !json.snapshot) return;

      const snapshot = json.snapshot;
      const dayKey = String(snapshot.day_key || "");
      const count = Number(snapshot.count || 0);
      const shownCount = readShown(dayKey);

      if (activeDayRef.current !== dayKey) {
        activeDayRef.current = dayKey;
        initializedRef.current = false;
        lastSeenCountRef.current = 0;
      }

      if (!initializedRef.current) {
        initializedRef.current = true;
        lastSeenCountRef.current = Math.max(count, shownCount);
        return;
      }

      const baseline = Math.max(lastSeenCountRef.current, shownCount);
      if (count > baseline) {
        lastSeenCountRef.current = count;
        markShown(dayKey, count);
        showMotivation(snapshot);
        return;
      }

      lastSeenCountRef.current = Math.max(baseline, count);
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    loadSnapshot();
    pollTimerRef.current = setInterval(loadSnapshot, POLL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (!toast?.visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        zIndex: 12000,
        width: "min(420px, calc(100vw - 28px))",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(16,18,28,0.96)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          backdropFilter: "blur(14px)",
          animation: "tcPaymentToastIn 260ms ease-out",
        }}
      >
        <div style={{ padding: 1, background: accent }}>
          <div style={{ height: 4, opacity: 0.95 }} />
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: ".08em",
                  color: "#111",
                  background: accent,
                }}
              >
                {toast.badge}
              </div>
              <div style={{ color: "#fff", fontSize: 21, lineHeight: 1.15, fontWeight: 900, marginTop: 12 }}>{toast.title}</div>
              <div style={{ color: "rgba(255,255,255,0.84)", fontSize: 14, lineHeight: 1.5, marginTop: 10 }}>{toast.message}</div>
            </div>

            <button
              type="button"
              onClick={hideToast}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 16,
            }}
          >
            <div
              style={{
                borderRadius: 18,
                padding: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>Cobros hoy</div>
              <div style={{ color: "#fff", fontSize: 24, fontWeight: 900, marginTop: 6 }}>{toast.count}</div>
            </div>

            <div
              style={{
                borderRadius: 18,
                padding: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>Último cobro</div>
              <div style={{ color: "#fff", fontSize: 24, fontWeight: 900, marginTop: 6 }}>{money(toast.amount)}</div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes tcPaymentToastIn {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
