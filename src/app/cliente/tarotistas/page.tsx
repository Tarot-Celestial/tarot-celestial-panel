"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Award, Gem, HeartHandshake, Loader2, MoonStar, ShieldCheck, Sparkles, Star, Wifi, WifiOff } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Tarotista = {
  id: string;
  nombre: string;
  team?: string | null;
  rango: "A" | "B";
  media: number;
  puntuacion: number;
  score: number;
  llamadas_mes: number;
  minutos_mes: number;
  estado_label: string;
  estado_color: string;
  estado_bg: string;
  estado_border: string;
  disponible: boolean;
  especialidad: string;
  experiencia: string;
  estilo: string;
  descripcion: string;
  iniciales: string;
};

function score10(value: number) {
  const n = Number(value || 0);
  return n > 0 ? `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })}/10` : "Sin datos";
}

export default function ClienteTarotistasPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [tarotistas, setTarotistas] = useState<Tarotista[]>([]);
  const [filter, setFilter] = useState<"todas" | "disponibles" | "A" | "B">("todas");
  const [summary, setSummary] = useState({ total: 0, disponibles: 0, rango_a: 0, rango_b: 0 });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/cliente/login";
        return;
      }

      const res = await fetch("/api/cliente/tarotistas", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar las tarotistas.");
      setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);
      setSummary({
        total: Number(json.total || 0),
        disponibles: Number(json.disponibles || 0),
        rango_a: Number(json.rango_a || 0),
        rango_b: Number(json.rango_b || 0),
      });
    } catch (e: any) {
      setMsg(e?.message || "No se pudieron cargar las tarotistas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const visible = useMemo(() => {
    if (filter === "disponibles") return tarotistas.filter((t) => t.disponible);
    if (filter === "A" || filter === "B") return tarotistas.filter((t) => t.rango === filter);
    return tarotistas;
  }, [filter, tarotistas]);

  return (
    <ClienteLayout
      title="Tarotistas"
      subtitle="Elige con quién consultar según disponibilidad, especialidad y rango de rendimiento."
      eyebrow="Guía espiritual"
      summaryItems={[
        { label: "Disponibles ahora", value: String(summary.disponibles), meta: "conectadas en directo" },
        { label: "Rango A", value: String(summary.rango_a), meta: "mejor puntuación" },
        { label: "Rango B", value: String(summary.rango_b), meta: "en evolución" },
      ]}
    >
      <section className="tc-card" style={{ padding: 22, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <MoonStar size={22} /> Tarotistas disponibles
            </div>
            <div className="tc-sub" style={{ marginTop: 7, maxWidth: 760 }}>
              Las tarjetas se ordenan por disponibilidad y rango. El rango se calcula automáticamente con la puntuación de calidad del mes: media entre % Cliente y % Repite.
            </div>
          </div>
          <button className="tc-btn" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 size={16} className="tc-spin" /> : <Sparkles size={16} />} Actualizar
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            ["todas", `Todas (${summary.total})`],
            ["disponibles", `Disponibles (${summary.disponibles})`],
            ["A", `Rango A (${summary.rango_a})`],
            ["B", `Rango B (${summary.rango_b})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key as any)}
              className={filter === key ? "tc-btn tc-btn-gold" : "tc-btn"}
              style={{ borderRadius: 999 }}
            >
              {label}
            </button>
          ))}
        </div>

        {msg ? <div className="tc-alert tc-alert-error">{msg}</div> : null}

        {loading ? (
          <div style={{ padding: 38, display: "grid", placeItems: "center", color: "rgba(255,255,255,.72)", gap: 10 }}>
            <Loader2 className="tc-spin" size={28} /> Cargando tarotistas…
          </div>
        ) : visible.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16 }}>
            {visible.map((tarotista) => (
              <article
                key={tarotista.id}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  borderRadius: 26,
                  border: tarotista.disponible ? "1px solid rgba(99,246,178,.28)" : "1px solid rgba(255,255,255,.10)",
                  background: tarotista.disponible
                    ? "linear-gradient(145deg, rgba(99,246,178,.13), rgba(30,20,46,.94) 45%, rgba(13,13,20,.96))"
                    : "linear-gradient(145deg, rgba(255,255,255,.07), rgba(30,20,46,.92) 48%, rgba(13,13,20,.96))",
                  boxShadow: tarotista.disponible ? "0 24px 70px rgba(60,220,150,.12)" : "0 20px 55px rgba(0,0,0,.25)",
                  padding: 18,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: "-80px -80px auto auto",
                    width: 180,
                    height: 180,
                    borderRadius: 999,
                    background: tarotista.rango === "A" ? "rgba(240,214,141,.18)" : "rgba(168,85,247,.13)",
                    filter: "blur(2px)",
                  }}
                />

                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13 }}>
                  <div
                    style={{
                      width: 62,
                      height: 62,
                      borderRadius: 22,
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 950,
                      fontSize: 20,
                      color: tarotista.rango === "A" ? "#241a08" : "#fff",
                      background: tarotista.rango === "A" ? "linear-gradient(180deg,#f6e3a9,#d7b56d)" : "linear-gradient(180deg,#9b7cff,#6c48d8)",
                      boxShadow: "0 14px 35px rgba(0,0,0,.28)",
                    }}
                  >
                    {tarotista.iniciales}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#fff", fontSize: 20, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tarotista.nombre}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                      <span style={{ ...pillStyle, background: tarotista.estado_bg, border: tarotista.estado_border, color: tarotista.estado_color }}>
                        {tarotista.disponible ? <Wifi size={13} /> : <WifiOff size={13} />} {tarotista.estado_label}
                      </span>
                      <span style={{ ...pillStyle, background: tarotista.rango === "A" ? "rgba(240,214,141,.18)" : "rgba(168,85,247,.15)", border: tarotista.rango === "A" ? "1px solid rgba(240,214,141,.34)" : "1px solid rgba(168,85,247,.30)", color: tarotista.rango === "A" ? "#f6e3a9" : "#d8c7ff" }}>
                        <Award size={13} /> Rango {tarotista.rango}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ color: "rgba(255,255,255,.78)", lineHeight: 1.55, fontSize: 14 }}>{tarotista.descripcion}</div>

                <div style={{ display: "grid", gap: 9 }}>
                  <Info icon={<HeartHandshake size={15} />} label="Especialidad" value={tarotista.especialidad} />
                  <Info icon={<Star size={15} />} label="Estilo" value={tarotista.estilo} />
                  <Info icon={<ShieldCheck size={15} />} label="Experiencia" value={tarotista.experiencia} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <MiniMetric label="Puntuación" value={score10(tarotista.puntuacion ?? tarotista.media)} />
                  <MiniMetric label="Mes" value={`${tarotista.llamadas_mes} consultas`} />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 4 }}>
                  <div style={{ color: "rgba(255,255,255,.55)", fontSize: 12 }}>
                    {tarotista.disponible ? "Lista para atenderte ahora" : "No disponible en este momento"}
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#f0d68d", fontWeight: 900, fontSize: 13 }}>
                    <Gem size={14} /> Tarot Celestial
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div style={{ padding: 28, color: "rgba(255,255,255,.70)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 22, background: "rgba(255,255,255,.04)" }}>
            No hay tarotistas para este filtro ahora mismo.
          </div>
        )}
      </section>
    </ClienteLayout>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", color: "rgba(255,255,255,.75)", fontSize: 13 }}>
      <span style={{ color: "#f0d68d", marginTop: 1 }}>{icon}</span>
      <span><strong style={{ color: "rgba(255,255,255,.92)" }}>{label}:</strong> {value}</span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.05)", borderRadius: 16, padding: "10px 12px" }}>
      <div style={{ color: "rgba(255,255,255,.50)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      <div style={{ color: "#fff", fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "6px 9px",
  fontSize: 12,
  fontWeight: 850,
};
