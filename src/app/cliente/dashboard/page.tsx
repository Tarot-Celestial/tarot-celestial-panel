"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Mail, Phone, Sparkles, Star, TimerReset } from "lucide-react";
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

function rangeAccent(rango: string | null | undefined) {
  const key = String(rango || "bronce").toLowerCase();
  if (key === "oro") return "rgba(215,181,109,0.18)";
  if (key === "plata") return "rgba(180,190,220,0.18)";
  return "rgba(196,140,84,0.16)";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
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
      <ClienteLayout title="Cargando tu panel..." subtitle="Estamos preparando tu área personal.">
        <div className="tc-card">Cargando...</div>
      </ClienteLayout>
    );
  }

  return (
    <>
      <ClienteLayout title={`Hola ${nombre}`} subtitle="Aquí puedes consultar tu rango, tus puntos y tus minutos disponibles.">
        {msg ? <div className="tc-card">{msg}</div> : null}

        <div className="tc-grid-2">
          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-card" style={{ display: "grid", gap: 14 }}>
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 22 }}>Tu estado actual</div>
                  <div className="tc-muted">Información general de tu cuenta</div>
                </div>
                <div className="tc-chip" style={{ background: rangeAccent(cliente?.rango_actual) }}>
                  Rango {rankInfo?.label || "Bronce"}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <div className="tc-card" style={{ padding: 16 }}>
                  <div className="tc-sub">Puntos acumulados</div>
                  <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6 }}>{Number(cliente?.puntos || 0)}</div>
                </div>
                <div className="tc-card" style={{ padding: 16 }}>
                  <div className="tc-sub">Minutos disponibles</div>
                  <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6 }}>{Number(cliente?.minutos_totales || 0)}</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    {Number(cliente?.minutos_free_pendientes || 0)} free · {Number(cliente?.minutos_normales_pendientes || 0)} normales
                  </div>
                </div>
              </div>

              <div className="tc-card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 18 }}>Progreso de rango</div>
                    <div className="tc-muted">El rango se calcula con el gasto del mes anterior.</div>
                  </div>
                  {rankProgress?.next_label ? <div className="tc-chip">Objetivo: {rankProgress.next_label}</div> : null}
                </div>
                <div style={{ height: 14, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${progressPercent}%`,
                      borderRadius: 999,
                      background: "linear-gradient(90deg, rgba(181,156,255,.95), rgba(215,181,109,.95))",
                    }}
                  />
                </div>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="tc-sub">{rankProgress?.monthly_requirement_text || "—"}</div>
                  {rankProgress?.next_target ? (
                    <div className="tc-sub">
                      Objetivo siguiente: <b>{Number(rankProgress.next_target || 0).toFixed(0)}€</b>
                    </div>
                  ) : null}
                </div>
                {rankProgress?.status_text ? <div style={{ fontWeight: 700 }}>{rankProgress.status_text}</div> : null}
              </div>

              <div className="tc-card" style={{ padding: 16 }}>
                <div className="tc-title" style={{ fontSize: 18, marginBottom: 10 }}>Ventajas de tu rango</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {(rankInfo?.benefits || []).map((item) => (
                    <div key={item} className="tc-row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <Star size={15} style={{ marginTop: 2 }} />
                      <span>{item}</span>
                    </div>
                  ))}
                  <div className="tc-row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <Sparkles size={15} style={{ marginTop: 2 }} />
                    <span>Mientras más avanzas, más beneficios desbloqueas.</span>
                  </div>
                </div>
              </div>
            </div>

            <CanjePuntos puntos={Number(cliente?.puntos || 0)} recompensas={recompensas} loading={redeeming} onRedeem={redeemReward} />
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-card" style={{ display: "grid", gap: 12 }}>
              <div className="tc-title" style={{ fontSize: 20 }}>Tu perfil rápido</div>
              <div className="tc-row" style={{ gap: 10 }}><Phone size={16} /> {cliente?.telefono || cliente?.telefono_normalizado || "—"}</div>
              <div className="tc-row" style={{ gap: 10 }}><Mail size={16} /> {cliente?.email || "No añadido"}</div>
              <div className="tc-row" style={{ gap: 10 }}><Gift size={16} /> {cliente?.fecha_nacimiento || "Sin fecha de nacimiento"}</div>
              <div className="tc-row" style={{ gap: 10 }}><TimerReset size={16} /> Onboarding {cliente?.onboarding_completado ? "completado" : "pendiente"}</div>
            </div>

            <div className="tc-card" style={{ display: "grid", gap: 10 }}>
              <div className="tc-title" style={{ fontSize: 20 }}>Tus 3 últimas tarotistas</div>
              {lastTarotistas.length === 0 ? (
                <div className="tc-muted">Todavía no tenemos consultas registradas en rendimiento para mostrarte aquí.</div>
              ) : (
                lastTarotistas.map((item, index) => (
                  <div key={`${item.nombre}-${index}`} className="tc-card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800 }}>{item.nombre}</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>Último contacto: {formatDate(item.fecha_hora)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="tc-card" style={{ display: "grid", gap: 10 }}>
              <div className="tc-title" style={{ fontSize: 20 }}>Últimos movimientos de puntos</div>
              {historial.length === 0 ? (
                <div className="tc-muted">Todavía no tienes movimientos de puntos registrados.</div>
              ) : (
                historial.map((item) => (
                  <div key={item.id} className="tc-card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800 }}>{item.descripcion || item.tipo || "Movimiento"}</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      {item.tipo === "canjeado" ? "-" : "+"}{Number(item.puntos || 0)} puntos · {formatDate(item.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
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
