"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Gift, Mail, Phone, Sparkles, Star, TimerReset, WandSparkles } from "lucide-react";
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

export default function ClienteDashboardPage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [lastTarotistas, setLastTarotistas] = useState<LastTarotista[]>([]);
  const [rankInfo, setRankInfo] = useState<RankInfo | null>(null);
  const [rankProgress, setRankProgress] = useState<RankProgress | null>(null);
  const [showWelcomeGift, setShowWelcomeGift] = useState(false);
  const [welcomeGiftMinutes, setWelcomeGiftMinutes] = useState(10);
  const [loading, setLoading] = useState(true);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [msg, setMsg] = useState("");

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

  const nombre = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente";
  const progressPercent = Math.max(0, Math.min(100, Number(rankProgress?.progress_percent || 0)));
  const rankBadge = getRankBadge(rankInfo?.label || cliente?.rango_actual);
  const freeMinutes = Number(cliente?.minutos_free_pendientes || 0);
  const normalMinutes = Number(cliente?.minutos_normales_pendientes || 0);
  const totalMinutes = Number(cliente?.minutos_totales || 0);
  const totalPoints = Number(cliente?.puntos || 0);

  const summaryItems = useMemo(
    () => [
      { label: "Rango actual", value: `${rankBadge.emoji} ${rankBadge.label}`, meta: rankProgress?.monthly_requirement_text || "Se calcula con el gasto del mes anterior" },
      { label: "Puntos disponibles", value: String(totalPoints), meta: "Puedes canjearlos por minutos gratis" },
      { label: "Minutos disponibles", value: String(totalMinutes), meta: `${freeMinutes} free · ${normalMinutes} normales` },
    ],
    [freeMinutes, normalMinutes, rankBadge.emoji, rankBadge.label, rankProgress?.monthly_requirement_text, totalMinutes, totalPoints]
  );

  async function saveOnboarding(payload: {
    nombre: string;
    apellido: string;
    email: string;
    fecha_nacimiento: string;
    onboarding_completado: boolean;
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
      setMsg("✅ Canje realizado. Tus minutos free ya están actualizados.");
      await loadData();
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido canjear tus puntos");
    } finally {
      setRedeeming(false);
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
        subtitle="Tu panel cliente está pensado para que veas de un vistazo tus minutos, tus puntos, tu progreso y tus beneficios activos."
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
                  <div className="tc-kpi-meta">Cada compra suma puntos para tus próximos canjes.</div>
                </div>
                <div className="tc-mini-stat">
                  <div className="tc-kpi-label">Minutos disponibles</div>
                  <strong>{totalMinutes}</strong>
                  <div className="tc-kpi-meta">{freeMinutes} free · {normalMinutes} normales</div>
                </div>
              </div>

              <div className="tc-rank-card">
                <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div className="tc-panel-title" style={{ fontSize: 18 }}>Progreso de rango</div>
                    <div className="tc-panel-sub">El rango se calcula con el gasto del mes anterior.</div>
                  </div>
                  {rankProgress?.next_label ? <div className="tc-chip">Siguiente: {rankProgress.next_label}</div> : null}
                </div>
                <div style={{ marginTop: 14 }} className="tc-progress-track">
                  <div className="tc-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 12, gap: 10 }}>
                  <div className="tc-panel-sub">{rankProgress?.status_text || "Sigue comprando para desbloquear más ventajas."}</div>
                  {rankProgress?.next_target ? <div className="tc-panel-sub">Objetivo: {Number(rankProgress.next_target).toFixed(0)}€</div> : null}
                </div>
                {rankProgress?.remaining_to_next ? (
                  <div style={{ marginTop: 8, fontWeight: 800 }}>
                    Te faltan {Number(rankProgress.remaining_to_next || 0).toFixed(0)}€ para el siguiente rango.
                  </div>
                ) : null}
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

            <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 10 }}>
              <div className="tc-row" style={{ gap: 10, alignItems: "flex-start" }}>
                <WandSparkles size={18} style={{ color: "var(--tc-gold-2)", marginTop: 2 }} />
                <div>
                  <div className="tc-list-item-title">Consejo del panel</div>
                  <div className="tc-list-item-sub" style={{ marginTop: 4 }}>
                    Consulta tus puntos antes de comprar: puede que ya tengas suficientes para desbloquear minutos gratis.
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </ClienteLayout>

      <OnboardingModal
        open={Boolean(cliente && !cliente.onboarding_completado)}
        cliente={cliente}
        saving={savingOnboarding}
        onSave={saveOnboarding}
      />
      <BonusBienvenidaModal open={showWelcomeGift} minutes={welcomeGiftMinutes} onClose={() => setShowWelcomeGift(false)} />
    </>
  );
}
