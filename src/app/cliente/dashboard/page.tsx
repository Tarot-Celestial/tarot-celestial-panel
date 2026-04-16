"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Crown, Gift, Mail, Phone, PhoneCall, ShieldAlert, Sparkles, Star, TimerReset, WandSparkles, ShoppingBag, ChevronRight } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import OnboardingModal from "@/components/cliente/OnboardingModal";
import CanjePuntos from "@/components/cliente/CanjePuntos";
import BonusBienvenidaModal from "@/components/cliente/BonusBienvenidaModal";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Cliente = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  fecha_nacimiento?: string | null;
  rango_actual?: string | null;
  rango_gasto_mes_anterior?: number | null;
  rango_compras_mes_anterior?: number | null;
  puntos?: number | null;
  minutos_free_pendientes?: number | null;
  minutos_normales_pendientes?: number | null;
  minutos_totales?: number | null;
  onboarding_completado?: boolean | null;
};

type Historial = {
  id: string;
  tipo?: string | null;
  puntos?: number | null;
  descripcion?: string | null;
  created_at?: string | null;
};

type Recompensa = {
  id: string;
  nombre: string;
  puntos_coste: number;
  minutos_otorgados: number;
};

type LastTarotista = {
  nombre: string;
  fecha_hora?: string | null;
};

type RankInfo = {
  label: string;
  benefits: string[];
};

type RankProgress = {
  current_label: string;
  next_label?: string | null;
  next_target?: number | null;
  progress_percent: number;
  remaining_to_next?: number;
  status_text?: string;
  monthly_requirement_text?: string;
};

type ClienteNotif = {
  id: string;
  titulo?: string | null;
  mensaje?: string | null;
  tipo?: string | null;
  leida?: boolean | null;
  created_at?: string | null;
};

type ClientePack = {
  id: string;
  nombre: string;
  descripcion: string;
  priceUsd: number;
  totalMinutes: number;
  bonusMinutes: number;
  highlight?: boolean;
};

type CallTarget = {
  market: string;
  label: string;
  displayNumber: string;
  telHref: string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function getRankBadge(rango: string | null | undefined) {
  const key = String(rango || "bronce").toLowerCase();
  if (key === "oro") return { label: "Oro", emoji: "🥇" };
  if (key === "plata") return { label: "Plata", emoji: "🥈" };
  return { label: "Bronce", emoji: "🥉" };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export default function ClienteDashboardPage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [lastTarotistas, setLastTarotistas] = useState<LastTarotista[]>([]);
  const [rankInfo, setRankInfo] = useState<RankInfo | null>(null);
  const [rankProgress, setRankProgress] = useState<RankProgress | null>(null);
  const [notificaciones, setNotificaciones] = useState<ClienteNotif[]>([]);
  const [packs, setPacks] = useState<ClientePack[]>([]);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [showWelcomeGift, setShowWelcomeGift] = useState(false);
  const [welcomeGiftMinutes, setWelcomeGiftMinutes] = useState(10);
  const [loading, setLoading] = useState(true);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [buyingPackId, setBuyingPackId] = useState("");
  const [msg, setMsg] = useState("");
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const loadData = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    const res = await fetch("/api/cliente/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "No hemos podido cargar tu panel.");
      setLoading(false);
      return;
    }

    setCliente(json.cliente || null);
    setHistorial(Array.isArray(json.historial) ? json.historial : []);
    setRecompensas(Array.isArray(json.recompensas) ? json.recompensas : []);
    setLastTarotistas(Array.isArray(json.last_tarotistas) ? json.last_tarotistas : []);
    setRankInfo(json.rank_info || null);
    setRankProgress(json.rank_progress || null);
    setNotificaciones(Array.isArray(json.cliente_notificaciones) ? json.cliente_notificaciones : []);
    setPacks(Array.isArray(json.packs) ? json.packs : []);
    setCallTarget(json.call_target || null);
    if (json.welcome_gift?.granted) {
      setWelcomeGiftMinutes(Number(json.welcome_gift?.minutes || 10));
      setShowWelcomeGift(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "ok") {
      setMsg("✅ Pago completado. En unos segundos verás tus minutos y puntos actualizados.");
      window.history.replaceState({}, "", "/cliente/dashboard");
      window.setTimeout(() => loadData(), 1200);
    }
    if (checkout === "cancelled") {
      setMsg("Has cancelado el pago. Puedes volver a intentarlo cuando quieras.");
      window.history.replaceState({}, "", "/cliente/dashboard");
    }
  }, [loadData]);

  useEffect(() => {
  if (cliente && !cliente.onboarding_completado) {
    setShowOnboarding(true);
  }
}, [cliente]);

  useEffect(() => {
    let channel: any = null;
    if (cliente?.id) {
      channel = sb
        .channel(`cliente-dashboard-${cliente.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "crm_clientes",
            filter: `id=eq.${cliente.id}`,
          },
          () => {
            loadData();
          }
        )
        .subscribe();
    }

    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [cliente?.id, loadData]);

  useEffect(() => {
    async function checkPush() {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
        setPushPermission("unsupported");
        return;
      }
      setPushPermission(Notification.permission);
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        setPushEnabled(Boolean(sub));
      } catch {
        setPushEnabled(false);
      }
    }
    checkPush();
  }, []);

  const nombre = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente";
  const progressPercent = Math.max(0, Math.min(100, Number(rankProgress?.progress_percent || 0)));
  const rankBadge = getRankBadge(rankInfo?.label || cliente?.rango_actual);
  const totalMinutes = Number(cliente?.minutos_totales || 0);
  const totalPoints = Number(cliente?.puntos || 0);
  const unreadNotifs = notificaciones.filter((item) => !item.leida).length;

  const summaryItems = useMemo(
    () => [
      { label: "Rango actual", value: `${rankBadge.emoji} ${rankBadge.label}`, meta: rankProgress?.monthly_requirement_text || "Se calcula con tus compras activas del mes" },
      { label: "Puntos disponibles", value: String(totalPoints), meta: "Cada compra suma 10 puntos por cada euro o dólar" },
      { label: "Minutos disponibles", value: String(totalMinutes), meta: "Tu saldo disponible ahora mismo" },
      { label: "Notificaciones", value: String(unreadNotifs), meta: unreadNotifs ? "Tienes novedades pendientes" : "Todo al día" },
    ],
    [rankBadge.emoji, rankBadge.label, rankProgress?.monthly_requirement_text, totalPoints, totalMinutes, unreadNotifs]
  );

  async function saveOnboarding(payload: {
    nombre: string;
    apellido: string;
    email: string;
    fecha_nacimiento: string;
    onboarding_completado: boolean;
    password: string;
    password_confirm: string;
  }) {
    try {
      setSavingOnboarding(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch("/api/cliente/perfil", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No hemos podido guardar tus datos");
      await loadData();
      setShowOnboarding(false);
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido guardar tus datos");
    } finally {
      setSavingOnboarding(false);
    }
  }

  async function redeemReward(recompensaId: string) {
    try {
      setRedeeming(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch("/api/cliente/canjear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recompensa_id: recompensaId }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No hemos podido canjear tus puntos");
      setMsg("✅ Canje realizado. Tus minutos ya están actualizados.");
      await loadData();
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido canjear tus puntos");
    } finally {
      setRedeeming(false);
    }
  }

  async function buyPack(packId: string) {
    try {
      setBuyingPackId(packId);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");
      const res = await fetch("/api/cliente/pagos/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pack_id: packId }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok || !json?.url) throw new Error(json?.error || "No hemos podido iniciar el pago");
      window.location.href = json.url;
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido iniciar el pago");
    } finally {
      setBuyingPackId("");
    }
  }

  async function trackCallAndOpen() {
    if (!callTarget) return;
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await fetch("/api/cliente/call-click", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destino: callTarget.displayNumber, mercado: callTarget.market }),
        }).catch(() => null);
      }
    } finally {
      window.location.href = callTarget.telHref;
    }
  }

  async function markNotifRead(id?: string) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/cliente/notificaciones/read", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(id ? { id } : {}),
    }).catch(() => null);
    setNotificaciones((prev) => prev.map((n) => (!id || n.id === id ? { ...n, leida: true } : n)));
  }

  async function enablePushNotifications() {
    try {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
        throw new Error("Tu dispositivo no soporta notificaciones web.");
      }
      setPushBusy(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      setPushPermission(permission);
      if (permission !== "granted") {
        throw new Error("Necesitas aceptar el permiso de notificaciones en tu navegador.");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""),
        }));

      const res = await fetch("/api/cliente/push/register", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(subscription),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No hemos podido activar las notificaciones.");
      setPushEnabled(true);
      setMsg("🔔 Notificaciones activadas en este dispositivo.");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido activar las notificaciones.");
    } finally {
      setPushBusy(false);
    }
  }


  if (loading) {
    return (
      <ClienteLayout title="Cargando tu panel..." subtitle="Estamos preparando tu área personal." summaryItems={[]}>
        <div className="tc-card">Cargando...</div>
      </ClienteLayout>
    );
  }

  return (
    <>
      <ClienteLayout
        title={`Hola ${nombre}`}
        subtitle="Tu panel cliente reúne compra, minutos, llamadas, puntos, notificaciones y ventajas en un solo lugar para que todo sea rápido y cómodo."
        summaryItems={summaryItems}
      >
        {msg ? <div className="tc-card tc-golden-panel">{msg}</div> : null}

        <div className="tc-dashboard-grid">
          <div className="tc-stack">
            <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 16 }}>
              <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tc-panel-title">Tu estado actual</div>
                  <div className="tc-panel-sub">Tu actividad, tus minutos y tus ventajas, todo reunido aquí.</div>
                </div>
                <div className="tc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Crown size={14} /> {rankBadge.emoji} Rango {rankBadge.label}
                </div>
              </div>

              <div className="tc-status-grid">
                <div className="tc-mini-stat">
                  <div className="tc-kpi-label">Puntos acumulados</div>
                  <strong>{totalPoints}</strong>
                  <div className="tc-kpi-meta">Cada euro o dólar sumado te acerca a tus próximos canjes.</div>
                </div>
                <div className="tc-mini-stat">
                  <div className="tc-kpi-label">Minutos disponibles</div>
                  <strong>{totalMinutes}</strong>
                  <div className="tc-kpi-meta">Todo tu saldo disponible para consultar cuando quieras.</div>
                </div>
              </div>

              <div className="tc-rank-card">
                <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div className="tc-panel-title" style={{ fontSize: 18 }}>Progreso de rango</div>
                    <div className="tc-panel-sub">Tu rango se sincroniza automáticamente con tus compras confirmadas del mes.</div>
                  </div>
                  {rankProgress?.next_label ? <div className="tc-chip">Siguiente: {rankProgress.next_label}</div> : null}
                </div>
                <div style={{ marginTop: 14 }} className="tc-progress-track">
                  <div className="tc-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 12, gap: 10 }}>
                  <div className="tc-panel-sub">{rankProgress?.status_text || "Sigue comprando para desbloquear más ventajas."}</div>
                  {rankProgress?.next_target ? <div className="tc-panel-sub">Objetivo: {Number(rankProgress.next_target).toFixed(0)} USD</div> : null}
                </div>
                {rankProgress?.remaining_to_next ? (
                  <div style={{ marginTop: 8, fontWeight: 800 }}>
                    Te faltan {Number(rankProgress.remaining_to_next || 0).toFixed(0)} USD para el siguiente rango.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="tc-card tc-purchase-panel">
              <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tc-panel-title">Comprar minutos desde la app</div>
                  <div className="tc-panel-sub">Pagas por Stripe y el sistema añade minutos, puntos, rango e historial automáticamente.</div>
                </div>
                <div className="tc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <ShoppingBag size={14} /> Precio app
                </div>
              </div>
              <div className="tc-pack-grid">
                {packs.map((pack) => (
                  <div key={pack.id} className={`tc-pack-card ${pack.highlight ? "tc-pack-card-highlight" : ""}`}>
                    <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <div className="tc-list-item-title">{pack.nombre}</div>
                        <div className="tc-list-item-sub">{pack.descripcion}</div>
                      </div>
                      {pack.highlight ? <div className="tc-chip">Recomendado</div> : null}
                    </div>
                    <div className="tc-pack-price">${pack.priceUsd.toFixed(2)} USD</div>
                    <div className="tc-pack-meta">{pack.totalMinutes} minutos totales disponibles para tu cuenta</div>
                    <button className="tc-btn tc-btn-gold" disabled={buyingPackId === pack.id} onClick={() => buyPack(pack.id)}>
                      {buyingPackId === pack.id ? "Conectando con Stripe..." : "Comprar ahora"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="tc-card" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Ventajas de tu rango</div>
                <div className="tc-panel-sub">Estos son los beneficios que ya tienes desbloqueados en tu cuenta.</div>
              </div>
              <div className="tc-benefits-grid">
                {(rankInfo?.benefits || []).map((item) => (
                  <div key={item} className="tc-benefit-item">
                    <Star size={16} style={{ marginTop: 2, color: "var(--tc-gold-2)", flex: "0 0 auto" }} />
                    <span>{item}</span>
                  </div>
                ))}
                <div className="tc-benefit-item">
                  <Sparkles size={16} style={{ marginTop: 2, color: "var(--tc-gold-2)", flex: "0 0 auto" }} />
                  <span>Mientras más avanzas, más beneficios desbloqueas.</span>
                </div>
              </div>
            </section>

            <CanjePuntos puntos={totalPoints} recompensas={recompensas} loading={redeeming} onRedeem={redeemReward} />
          </div>

          <div className="tc-stack">
            <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Llamar ahora</div>
                <div className="tc-panel-sub">Tu acceso directo cambia según el país del teléfono de tu cuenta.</div>
              </div>
              <div className="tc-callout-box">
                <div>
                  <div className="tc-list-item-title">{callTarget?.label || "Soporte"}</div>
                  <div className="tc-list-item-sub">{callTarget?.displayNumber || "Sin número disponible"}</div>
                </div>
                <button className="tc-btn tc-btn-gold" onClick={trackCallAndOpen}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><PhoneCall size={16} /> Abrir llamada</span>
                </button>
              </div>
            </section>

            <section className="tc-card" style={{ display: "grid", gap: 12 }}>
              <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tc-panel-title">Tus notificaciones</div>
                  <div className="tc-panel-sub">Ideas, avisos y movimientos importantes de tu cuenta.</div>
                </div>
                {unreadNotifs > 0 ? <button className="tc-btn" onClick={() => markNotifRead()}>Marcar todo leído</button> : null}
              </div>
              {notificaciones.length === 0 ? (
                <div className="tc-empty-state">Aún no tienes notificaciones internas.</div>
              ) : (
                <div className="tc-list-card">
                  {notificaciones.slice(0, 6).map((item) => (
                    <button key={item.id} className={`tc-notif-card ${item.leida ? "" : "tc-notif-card-unread"}`} onClick={() => markNotifRead(item.id)}>
                      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <div>
                          <div className="tc-list-item-title">{item.titulo || "Notificación"}</div>
                          <div className="tc-list-item-sub">{item.mensaje || ""}</div>
                        </div>
                        {!item.leida ? <BellRing size={15} style={{ color: "var(--tc-gold-2)" }} /> : null}
                      </div>
                      <div className="tc-list-item-sub" style={{ marginTop: 8 }}>{formatDate(item.created_at)}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="tc-card" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Tu perfil rápido</div>
                <div className="tc-panel-sub">Tus datos clave y el estado de tu cuenta cliente.</div>
              </div>
              <div className="tc-list-card">
                <div className="tc-list-item">
                  <div className="tc-row"><Phone size={16} /> <span className="tc-list-item-title">{cliente?.telefono || cliente?.telefono_normalizado || "—"}</span></div>
                  <div className="tc-list-item-sub">Teléfono de acceso al panel</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><Mail size={16} /> <span className="tc-list-item-title">{cliente?.email || "No añadido"}</span></div>
                  <div className="tc-list-item-sub">Email para promociones y novedades</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><Gift size={16} /> <span className="tc-list-item-title">{cliente?.fecha_nacimiento || "Sin fecha de nacimiento"}</span></div>
                  <div className="tc-list-item-sub">Tu regalo de cumpleaños depende de este dato</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><TimerReset size={16} /> <span className="tc-list-item-title">{cliente?.onboarding_completado ? "Perfil verificado" : "Pendiente de completar"}</span></div>
                  <div className="tc-list-item-sub">Puedes actualizar estos datos desde tu perfil</div>
                </div>
              </div>
            </section>

            <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Tus 3 últimas tarotistas</div>
                <div className="tc-panel-sub">Consultas recientes registradas en el sistema.</div>
              </div>
              {lastTarotistas.length === 0 ? (
                <div className="tc-empty-state">Todavía no tenemos consultas registradas en rendimiento para mostrarte aquí.</div>
              ) : (
                <div className="tc-list-card">
                  {lastTarotistas.map((item, index) => (
                    <div key={`${item.nombre}-${index}`} className="tc-list-item">
                      <div className="tc-list-item-title">{item.nombre}</div>
                      <div className="tc-list-item-sub">Último contacto: {formatDate(item.fecha_hora)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="tc-card" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Últimos movimientos de puntos</div>
                <div className="tc-panel-sub">Compras y canjes recientes de tu cuenta.</div>
              </div>
              {historial.length === 0 ? (
                <div className="tc-empty-state">Todavía no tienes movimientos de puntos registrados.</div>
              ) : (
                <div className="tc-list-card">
                  {historial.map((item) => (
                    <div key={item.id} className="tc-list-item">
                      <div className="tc-list-item-title">{item.descripcion || item.tipo || "Movimiento"}</div>
                      <div className="tc-list-item-sub">
                        {item.tipo === "canjeado" ? "-" : "+"}{Number(item.puntos || 0)} puntos · {formatDate(item.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="tc-card tc-oracle-cta" style={{ display: "grid", gap: 10 }}>
              <div className="tc-row" style={{ gap: 10, alignItems: "flex-start" }}>
                <WandSparkles size={18} style={{ color: "var(--tc-gold-2)", marginTop: 2 }} />
                <div>
                  <div className="tc-list-item-title">Nuevo: Oráculo diario con chat</div>
                  <div className="tc-list-item-sub" style={{ marginTop: 4 }}>
                    Escoge amor, dinero, energía o general y recibe una lectura del día con la opción de preguntar más.
                  </div>
                </div>
              </div>
              <a className="tc-btn tc-btn-gold" href="/cliente/oraculo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Abrir oráculo <ChevronRight size={16} />
                </span>
              </a>
            </section>
          </div>
        </div>
      </ClienteLayout>

      <OnboardingModal
  open={showOnboarding}
  cliente={cliente}
  saving={savingOnboarding}
  onSave={saveOnboarding}
/>
      <BonusBienvenidaModal open={showWelcomeGift} minutes={welcomeGiftMinutes} onClose={() => setShowWelcomeGift(false)} />
    </>
  );
}
