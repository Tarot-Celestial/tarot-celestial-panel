"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TabKey = "resumen" | "bonos" | "ranking" | "equipos" | "facturas";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthFromUrl() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("month") || monthKeyNow();
  } catch {
    return monthKeyNow();
  }
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pct(n: any) {
  const x = Number(n) || 0;
  return `${x.toFixed(2)}%`;
}

function n2(n: any) {
  const x = Number(n) || 0;
  return x.toFixed(2);
}

function capTier(captadas: number) {
  // Tramos:
  // 0-9 => 0.50€/captada
  // 10-19 => 1.00€/captada
  // 20-29 => 1.50€/captada
  // 30+ => 2.00€/captada
  if (captadas >= 30) return { rate: 2.0, label: "2,00€ / captada (30+)", nextAt: null as any };
  if (captadas >= 20) return { rate: 1.5, label: "1,50€ / captada (20+)", nextAt: 30 };
  if (captadas >= 10) return { rate: 1.0, label: "1,00€ / captada (10+)", nextAt: 20 };
  return { rate: 0.5, label: "0,50€ / captada (0-9)", nextAt: 10 };
}

function progressToNext(captadas: number) {
  const t = capTier(captadas);
  if (!t.nextAt) {
    return { pct: 100, text: "Tramo máximo alcanzado 🔥" };
  }
  const prev = t.nextAt === 10 ? 0 : t.nextAt === 20 ? 10 : 20;
  const span = t.nextAt - prev;
  const cur = Math.min(Math.max(captadas - prev, 0), span);
  const p = Math.round((cur / span) * 100);
  const faltan = Math.max(t.nextAt - captadas, 0);
  return { pct: p, text: `Te faltan ${faltan} captadas para subir a ${t.nextAt}+` };
}

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

export default function Tarotista() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("resumen");

  const [month, setMonth] = useState(monthKeyNow());
  const [stats, setStats] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "tarotista") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-central";
        return;
      }

      setMonth(getMonthFromUrl());
      setOk(true);
    })();
  }, []);

  async function refresh() {
    try {
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const m = getMonthFromUrl();
      setMonth(m);

      const sRes = await fetch(`/api/stats/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const s = await safeJson(sRes);
      const rnk = await safeJson(rRes);

      setStats(s);
      setRank(rnk);

      if ((s && s.ok === false) || (rnk && rnk.ok === false)) {
        setMsg("⚠️ Hay un error cargando datos (mira consola / endpoint).");
      }
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  useEffect(() => {
    if (!ok) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  const s = stats?.stats || {};
  const captadas = Number(s?.captadas_total || 0);
  const tier = capTier(captadas);
  const prog = progressToNext(captadas);

  const payMinutes = Number(s?.pay_minutes || 0);
  const bonusCaptadas = Number(s?.bonus_captadas || 0);
  const incidencias = Number(s?.incidencias_total || 0); // si tu endpoint lo trae, si no quedará 0
  const totalPreview = payMinutes + bonusCaptadas - incidencias;

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  return (
    <>
      <AppHeader />

      <div className="tc-wrap">
        <div className="tc-container">
          {/* CABECERA DEL PANEL */}
          <div className="tc-card">
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>
                  🔮 Panel Tarotista
                </div>
                <div className="tc-sub">
                  Mes: <b>{month}</b> {msg ? `· ${msg}` : ""}
                </div>
              </div>

              <div className="tc-row">
                <button className="tc-btn tc-btn-gold" onClick={refresh}>
                  Actualizar
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="tc-tabs">
              <button className={`tc-tab ${tab === "resumen" ? "tc-tab-active" : ""}`} onClick={() => setTab("resumen")}>
                📊 Resumen
              </button>
              <button className={`tc-tab ${tab === "bonos" ? "tc-tab-active" : ""}`} onClick={() => setTab("bonos")}>
                💰 Bonos
              </button>
              <button className={`tc-tab ${tab === "ranking" ? "tc-tab-active" : ""}`} onClick={() => setTab("ranking")}>
                🏆 Ranking
              </button>
              <button className={`tc-tab ${tab === "equipos" ? "tc-tab-active" : ""}`} onClick={() => setTab("equipos")}>
                🔥💧 Equipos
              </button>
              <button className={`tc-tab ${tab === "facturas" ? "tc-tab-active" : ""}`} onClick={() => setTab("facturas")}>
                🧾 Factura
              </button>
            </div>
          </div>

          {/* TAB: RESUMEN */}
          {tab === "resumen" && (
            <div className="tc-grid-2">
              <div className="tc-card">
                <div className="tc-title">📊 Mis estadísticas</div>
                <div className="tc-hr" />
                <div className="tc-kpis">
                  <Kpi label="Minutos totales" value={n2(s?.minutes_total || 0)} />
                  <Kpi label="Captadas" value={String(captadas)} />
                  <Kpi label="% Cliente" value={pct(s?.pct_cliente || 0)} />
                  <Kpi label="% Repite" value={pct(s?.pct_repite || 0)} />
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-title">💶 Vista rápida de pago</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Esto es una vista motivacional. La factura oficial la ves en la pestaña “Factura”.
                </div>
                <div className="tc-hr" />

                <div className="tc-kpis">
                  <Kpi label="Pago por minutos" value={eur(payMinutes)} />
                  <Kpi label="Bono captadas" value={eur(bonusCaptadas)} />
                  <Kpi label="Incidencias" value={`- ${eur(incidencias)}`} />
                  <Kpi label="Total estimado" value={eur(totalPreview)} highlight />
                </div>
              </div>
            </div>
          )}

          {/* TAB: BONOS */}
          {tab === "bonos" && (
            <div className="tc-grid-2">
              <div className="tc-card">
                <div className="tc-title">💰 Bono captadas</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Tu tramo actual: <b>{tier.label}</b>
                </div>

                <div className="tc-hr" />

                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <div className="tc-sub">
                    Captadas: <b>{captadas}</b>
                  </div>
                  <div className="tc-chip">{prog.text}</div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.10)",
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${prog.pct}%`,
                        background: "linear-gradient(90deg, rgba(181,156,255,0.95), rgba(215,181,109,0.95))",
                      }}
                    />
                  </div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Bono actual del mes: <b>{eur(bonusCaptadas)}</b>
                  </div>
                </div>

                <div className="tc-hr" />

                <div className="tc-sub">
                  Tramos:
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    <div className="tc-row" style={{ justifyContent: "space-between" }}>
                      <span>0–9 captadas</span><b>0,50€</b>
                    </div>
                    <div className="tc-row" style={{ justifyContent: "space-between" }}>
                      <span>10–19 captadas</span><b>1,00€</b>
                    </div>
                    <div className="tc-row" style={{ justifyContent: "space-between" }}>
                      <span>20–29 captadas</span><b>1,50€</b>
                    </div>
                    <div className="tc-row" style={{ justifyContent: "space-between" }}>
                      <span>30+ captadas</span><b>2,00€</b>
                    </div>
                  </div>
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-title">🏆 Bonos por ranking</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  En <b>Captadas</b>, <b>Cliente</b> y <b>Repite</b>:
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 8 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between" }}>
                    <span>🥇 1º puesto</span><b>6€</b>
                  </div>
                  <div className="tc-row" style={{ justifyContent: "space-between" }}>
                    <span>🥈 2º puesto</span><b>4€</b>
                  </div>
                  <div className="tc-row" style={{ justifyContent: "space-between" }}>
                    <span>🥉 3º puesto</span><b>2€</b>
                  </div>
                </div>

                <div className="tc-hr" />

                <div className="tc-sub">
                  Consejo: céntrate en <b>% Repite</b> y <b>% Cliente</b> para ganar los 6€ y además ayudar a tu equipo.
                </div>
              </div>
            </div>
          )}

          {/* TAB: RANKING */}
          {tab === "ranking" && (
            <div className="tc-card">
              <div className="tc-title">🏆 Top 3 del mes</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                (Si falta algo, revisamos el endpoint /api/rankings/monthly)
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-3">
                <TopCard title="Captadas" items={topCaptadas.map((x: any) => `${x.display_name} (${x.captadas_total})`)} />
                <TopCard title="Cliente" items={topCliente.map((x: any) => `${x.display_name} (${Number(x.pct_cliente).toFixed(2)}%)`)} />
                <TopCard title="Repite" items={topRepite.map((x: any) => `${x.display_name} (${Number(x.pct_repite).toFixed(2)}%)`)} />
              </div>
            </div>
          )}

          {/* TAB: EQUIPOS */}
          {tab === "equipos" && (
            <div className="tc-card">
              <div className="tc-title">🔥💧 Competición por equipos</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Score = media %Cliente + media %Repite (por equipo). Ganador: central +40€.
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-2">
                <TeamCard
                  title="🔥 Fuego"
                  score={rank?.teams?.fuego?.score ?? 0}
                  avgCliente={rank?.teams?.fuego?.avg_cliente ?? 0}
                  avgRepite={rank?.teams?.fuego?.avg_repite ?? 0}
                />
                <TeamCard
                  title="💧 Agua"
                  score={rank?.teams?.agua?.score ?? 0}
                  avgCliente={rank?.teams?.agua?.avg_cliente ?? 0}
                  avgRepite={rank?.teams?.agua?.avg_repite ?? 0}
                />
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div className="tc-sub">Ganador actual:</div>
                <div className="tc-chip">
                  <b>{rank?.teams?.winner || "—"}</b>
                </div>
              </div>
            </div>
          )}

          {/* TAB: FACTURA */}
          {tab === "facturas" && (
            <div className="tc-card">
              <div className="tc-title">🧾 Mi factura</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Próximo paso: aquí cargamos tu factura real (líneas Free/Rueda/Cliente/Repite + bonos + incidencias) desde
                invoices + invoice_lines.
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Ya está calculado en base de datos. Solo falta el endpoint “/api/my/invoice?month=YYYY-MM” y pintarlo bonito.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: highlight ? "rgba(215,181,109,0.10)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function TopCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>🏆 {title}</div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 8 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div key={i} className="tc-row" style={{ justifyContent: "space-between" }}>
            <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}</span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}

function TeamCard({
  title,
  score,
  avgCliente,
  avgRepite,
}: {
  title: string;
  score: any;
  avgCliente: any;
  avgRepite: any;
}) {
  const s = Number(score || 0);
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>{title}</div>
      <div className="tc-hr" />
      <div className="tc-kpis">
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Score</span>
          <b>{s.toFixed(2)}</b>
        </div>
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Media % Cliente</span>
          <b>{Number(avgCliente || 0).toFixed(2)}%</b>
        </div>
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Media % Repite</span>
          <b>{Number(avgRepite || 0).toFixed(2)}%</b>
        </div>
      </div>
    </div>
  );
}
