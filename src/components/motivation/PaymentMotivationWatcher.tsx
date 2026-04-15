"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Sparkles, TrendingUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();
const STORAGE_PREFIX = "tc-payment-motivation-seen";
const POLL_MS = 15000;
const AUTO_HIDE_MS = 7000;

type PanelMode = "admin" | "central";

type PaymentSnapshot = {
  ok: boolean;
  day_key: string;
  count_today: number;
  latest_payment: {
    id: string | number;
    cliente_nombre?: string | null;
    importe?: number | null;
    forma_pago?: string | null;
    fecha_hora?: string | null;
    telefonista_nombre?: string | null;
    tarotista_nombre?: string | null;
  } | null;
};

type SeenState = {
  dayKey: string;
  count: number;
  latestId: string;
};

function madridDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function storageKey(panel: PanelMode, dayKey: string) {
  return `${STORAGE_PREFIX}:${panel}:${dayKey}`;
}

function readSeen(panel: PanelMode, dayKey: string): SeenState {
  if (typeof window === "undefined") return { dayKey, count: 0, latestId: "" };
  try {
    const raw = window.localStorage.getItem(storageKey(panel, dayKey));
    if (!raw) return { dayKey, count: 0, latestId: "" };
    const parsed = JSON.parse(raw);
    return {
      dayKey,
      count: Number(parsed?.count) || 0,
      latestId: String(parsed?.latestId || ""),
    };
  } catch {
    return { dayKey, count: 0, latestId: "" };
  }
}

function writeSeen(panel: PanelMode, next: SeenState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(panel, next.dayKey), JSON.stringify(next));
  } catch {}
}

function eur(value: number | null | undefined) {
  return (Number(value) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function buildMotivation(count: number) {
  if (count <= 1) {
    return {
      badge: "Primer cobro del día",
      title: "🎉 ¡BRAVO! Ya ha llegado el primero",
      description: "Primer cobro del día. Vamos con todo 🔥",
    };
  }

  const variants = [
    `💪 Ya van ${count} cobros hoy. Otro más, sigue así.`,
    `🚀 ${count} cobros y subiendo. Estás en racha.`,
    `🔥 ${count} cobros hoy. Hoy estás imparable.`,
    `✨ ${count} cobros en el día. Con trabajo duro todo se puede lograr.`,
    `🏆 ${count} cobros hoy. Vamos a por más.`,
  ];

  return {
    badge: `${count} cobros hoy`,
    title: `🎉 ¡BRAVO! Ya van ${count} cobros del día`,
    description: variants[(count - 2) % variants.length],
  };
}

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { ok: false } as any;
  try {
    return JSON.parse(txt);
  } catch {
    return { ok: false } as any;
  }
}

export default function PaymentMotivationWatcher({ panel, enabled = true }: { panel: PanelMode; enabled?: boolean }) {
  const [popup, setPopup] = useState<PaymentSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);
  const pollRef = useRef<any>(null);
  const dayRef = useRef<string>(madridDayKey());
  const channelRef = useRef<any>(null);

  const popupText = useMemo(() => buildMotivation(Number(popup?.count_today) || 0), [popup]);

  async function fetchLatest() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;

    const dayKey = madridDayKey();
    const res = await fetch(`/api/motivation/payments/latest?day=${encodeURIComponent(dayKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await safeJson(res)) as PaymentSnapshot;
    if (!json?.ok) return null;
    return json;
  }

  function syncSeenDay(dayKey: string) {
    if (dayRef.current === dayKey) return;
    dayRef.current = dayKey;
    writeSeen(panel, { dayKey, count: 0, latestId: "" });
  }

  function handleSnapshot(snapshot: PaymentSnapshot | null, mode: "baseline" | "notify") {
    if (!snapshot?.ok) return;

    syncSeenDay(snapshot.day_key || madridDayKey());

    const latestId = String(snapshot.latest_payment?.id || "");
    const countToday = Number(snapshot.count_today) || 0;
    const seen = readSeen(panel, snapshot.day_key);

    if (mode === "baseline") {
      writeSeen(panel, {
        dayKey: snapshot.day_key,
        count: Math.max(seen.count, countToday),
        latestId: seen.latestId || latestId,
      });
      return;
    }

    if (!latestId || countToday <= 0) return;

    const shouldPopup = countToday > seen.count && latestId !== seen.latestId;

    writeSeen(panel, {
      dayKey: snapshot.day_key,
      count: Math.max(seen.count, countToday),
      latestId,
    });

    if (shouldPopup) {
      setPopup(snapshot);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const snapshot = await fetchLatest();
        if (!cancelled) {
          handleSnapshot(snapshot, ready ? "notify" : "baseline");
          if (!ready) setReady(true);
        }
      } catch {
      } finally {
        busyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, panel, ready]);

  useEffect(() => {
    if (!enabled || !ready) return;

    const tick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const snapshot = await fetchLatest();
        handleSnapshot(snapshot, "notify");
      } catch {
      } finally {
        busyRef.current = false;
      }
    };

    pollRef.current = window.setInterval(tick, POLL_MS);

    if (channelRef.current) {
      sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = sb
      .channel(`motivation-payments-${panel}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "rendimiento_llamadas",
        },
        () => {
          tick();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (channelRef.current) {
        sb.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled, panel, ready]);

  useEffect(() => {
    if (!popup) return;
    const timer = window.setTimeout(() => setPopup(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [popup]);

  if (!enabled || !popup) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 1200,
        width: "min(420px, calc(100vw - 24px))",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          borderRadius: 24,
          padding: 18,
          color: "#fff",
          background:
            "radial-gradient(circle at top left, rgba(255,210,84,0.18), transparent 36%), linear-gradient(135deg, rgba(15,23,42,0.96), rgba(31,41,55,0.96))",
          border: "1px solid rgba(255,255,255,0.14)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 18,
              background: "linear-gradient(135deg, rgba(255,215,0,0.22), rgba(255,119,0,0.16))",
              border: "1px solid rgba(255,215,0,0.22)",
              display: "grid",
              placeItems: "center",
              flex: "0 0 auto",
            }}
          >
            <Sparkles size={24} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                padding: "7px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <TrendingUp size={14} />
              {popupText.badge}
            </div>

            <div style={{ marginTop: 12, fontSize: 22, fontWeight: 800, lineHeight: 1.15 }}>{popupText.title}</div>
            <div style={{ marginTop: 10, color: "rgba(255,255,255,0.8)", fontSize: 14, lineHeight: 1.55 }}>
              {popupText.description}
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 6,
                padding: 12,
                borderRadius: 18,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>
                Cliente: <b style={{ color: "#fff" }}>{popup.latest_payment?.cliente_nombre || "Cliente"}</b>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>
                Importe: <b style={{ color: "#fff" }}>{eur(popup.latest_payment?.importe)}</b>
                {popup.latest_payment?.forma_pago ? (
                  <span style={{ color: "rgba(255,255,255,0.62)" }}> · {popup.latest_payment.forma_pago}</span>
                ) : null}
              </div>
            </div>
          </div>

          <button
            onClick={() => setPopup(null)}
            aria-label="Cerrar aviso"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
