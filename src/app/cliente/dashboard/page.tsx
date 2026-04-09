"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Mail, Phone, Star, TimerReset } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import OnboardingModal from "@/components/cliente/OnboardingModal";
import CanjePuntos from "@/components/cliente/CanjePuntos";
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

function rangeInfo(rango: string | null | undefined) {
  const key = String(rango || "bronce").toLowerCase();
  if (key === "oro") {
    return {
      label: "Oro",
      accent: "rgba(215,181,109,0.18)",
      benefits: ["Atención prioritaria", "Promociones premium", "Regalo especial de cumpleaños"],
    };
  }
  if (key === "plata") {
    return {
      label: "Plata",
      accent: "rgba(180,190,220,0.18)",
      benefits: ["Promociones mejoradas", "Seguimiento preferente", "Bonus de puntos"],
    };
  }
  return {
    label: "Bronce",
    accent: "rgba(196,140,84,0.16)",
    benefits: ["Acceso al panel cliente", "Historial y saldo visible", "Promociones disponibles"],
  };
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

  const rango = useMemo(() => rangeInfo(cliente?.rango_actual), [cliente?.rango_actual]);
  const nombre = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente";

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
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 22 }}>Tu estado actual</div>
                  <div className="tc-muted">Información general de tu cuenta</div>
                </div>
                <div className="tc-chip" style={{ background: rango.accent }}>Rango {rango.label}</div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
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

              <div className="tc-card" style={{ padding: 16 }}>
                <div className="tc-title" style={{ fontSize: 18, marginBottom: 10 }}>Ventajas de tu rango</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {rango.benefits.map((item) => (
                    <div key={item} className="tc-row" style={{ gap: 8 }}>
                      <Star size={15} />
                      <span>{item}</span>
                    </div>
                  ))}
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
    </>
  );
}
