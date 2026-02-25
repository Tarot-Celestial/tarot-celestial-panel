"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TabKey = "resumen" | "bonos" | "ranking" | "equipos" | "facturas" | "checklist";

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
  if (captadas >= 30) return { rate: 2.0, label: "2,00€ / captada (30+)", nextAt: null as any };
  if (captadas >= 20) return { rate: 1.5, label: "1,50€ / captada (20+)", nextAt: 30 };
  if (captadas >= 10) return { rate: 1.0, label: "1,00€ / captada (10+)", nextAt: 20 };
  return { rate: 0.5, label: "0,50€ / captada (0-9)", nextAt: 10 };
}

function progressToNext(captadas: number) {
  const t = capTier(captadas);
  if (!t.nextAt) return { pct: 100, text: "Tramo máximo alcanzado 🔥" };
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

function bonusForPos(pos: number | null) {
  if (pos === 1) return 6;
  if (pos === 2) return 4;
  if (pos === 3) return 2;
  return 0;
}

function medalForPos(pos: number | null) {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "—";
}

function clampPct(n: number) {
  const x = Number(n) || 0;
  return Math.max(0, Math.min(100, x));
}

export default function Tarotista() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("resumen");

  const [month, setMonth] = useState(monthKeyNow());
  const [stats, setStats] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");

  // incidencias en vivo + factura real + aceptación
  const [incidents, setIncidents] = useState<any[]>([]);
  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceLines, setInvoiceLines] = useState<any[]>([]);
  const [ackNote, setAckNote] = useState<string>("");

  // para saber mi worker_id y calcular posición en top3
  const [myWorkerId, setMyWorkerId] = useState<string>("");

  // ✅ checklist (turno)
  const [clLoading, setClLoading] = useState(false);
  const [clMsg, setClMsg] = useState("");
  const [clShiftKey, setClShiftKey] = useState<string>("");
  const [clRows, setClRows] = useState<any[]>([]);
  const [clQ, setClQ] = useState("");

  // ✅ IMPORTANTÍSIMO: hooks SIEMPRE antes de cualquier return condicional
  const incidenciasLive = useMemo(() => {
    return (incidents || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  }, [incidents]);

  const s = stats?.stats || {};
  const captadas = Number(s?.captadas_total || 0);
  const tier = capTier(captadas);
  const prog = progressToNext(captadas);

  const payMinutes = Number(s?.pay_minutes || 0);
  const bonusCaptadas = Number(s?.bonus_captadas || 0);

  // BONUS RANKING “en vivo”
  const bonusRanking = Number(s?.bonus_ranking || 0);
  const br = s?.bonus_ranking_breakdown || {};
  const brCaptadas = Number(br?.captadas || 0);
  const brCliente = Number(br?.cliente || 0);
  const brRepite = Number(br?.repite || 0);

  const bonusTotal = bonusCaptadas + bonusRanking;
  const totalPreview = payMinutes + bonusTotal - incidenciasLive;

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  // posiciones actuales (solo top3)
  const posCaptadas: number | null = useMemo(() => {
    const i = (topCaptadas || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCaptadas, myWorkerId]);

  const posCliente: number | null = useMemo(() => {
    const i = (topCliente || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCliente, myWorkerId]);

  const posRepite: number | null = useMemo(() => {
    const i = (topRepite || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topRepite, myWorkerId]);

  // checklist: progreso + filtrado
  const clFiltered = useMemo(() => {
    const qq = clQ.trim().toLowerCase();
    if (!qq) return clRows || [];
    return (clRows || []).filter((it: any) =>
      String(it.title || it.label || it.item_key || "").toLowerCase().includes(qq)
    );
  }, [clRows, clQ]);

  const clProgress = useMemo(() => {
    const rows = clRows || [];
    const total = rows.length;
    const completed = rows.filter((r: any) => !!r.done || r.status === "completed" || r.completed === true).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pct };
  }, [clRows]);

  // ✅ Auth gate
  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const me = await safeJson(meRes);
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "tarotista") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-central";
        return;
      }

      setMonth(getMonthFromUrl());
      setOk(true);
    })();
  }, []);

  // ✅ Asistencia: ping cada 30s (para que Admin vea online)
  useEffect(() => {
    if (!ok) return;
    let t: any = null;
    let stopped = false;

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || stopped) return;

      const ping = async () => {
        try {
          await fetch("/api/attendance/ping", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: window.location.pathname }),
          });
        } catch {}
      };

      await ping();
      t = setInterval(ping, 30000);
    })();

    return () => {
      stopped = true;
      if (t) clearInterval(t);
    };
  }, [ok]);

  async function loadChecklist() {
    if (clLoading) return;
    setClLoading(true);
    setClMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/checklists/my", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setClShiftKey("");
        setClRows([]);
        setClMsg(`❌ Checklist: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      setClShiftKey(String(j.shift_key || ""));
      setClRows(j.items || j.rows || []);
      setClMsg(`✅ Checklist cargado (${(j.items || j.rows || []).length} items)`);
    } catch (e: any) {
      setClShiftKey("");
      setClRows([]);
      setClMsg(`❌ Checklist: ${e?.message || "Error"}`);
    } finally {
      setClLoading(false);
    }
  }

  async function toggleChecklistItem(item: any) {
    const item_key = String(item?.item_key || item?.key || item?.id || "");
    if (!item_key) return;

    try {
      setClMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/checklists/toggle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_key }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadChecklist();
    } catch (e: any) {
      setClMsg(`❌ No se pudo marcar: ${e?.message || "Error"}`);
    }
  }

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
      const incRes = await fetch(`/api/incidents/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const invRes = await fetch(`/api/invoices/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const sJ = await safeJson(sRes);
      const rnkJ = await safeJson(rRes);
      const incJ = await safeJson(incRes);
      const invJ = await safeJson(invRes);

      setStats(sJ);
      setRank(rnkJ);

      const wid = sJ?.worker?.id ? String(sJ.worker.id) : "";
      if (wid) setMyWorkerId(wid);

      if (incJ?._ok && incJ?.ok) setIncidents(incJ.incidents || []);
      else setIncidents([]);

      if (invJ?._ok && invJ?.ok) {
        setInvoice(invJ.invoice || null);
        setInvoiceLines(invJ.lines || []);
      } else {
        setInvoice(null);
        setInvoiceLines([]);
      }

      if ((sJ && sJ.ok === false) || (rnkJ && rnkJ.ok === false)) {
        setMsg("⚠️ Hay un error cargando datos (mira consola / endpoint).");
      }
      if (incJ && incJ.ok === false) {
        setMsg((p) => `${p ? p + " · " : ""}⚠️ Incidencias: ${incJ.error || "error"}`);
      }
      if (invJ && invJ.ok === false) {
        setMsg((p) => `${p ? p + " · " : ""}⚠️ Factura: ${invJ.error || "error"}`);
      }
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  useEffect(() => {
    if (!ok) return;
    refresh();
    loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  // Cuando entra en checklist, refrescamos
  useEffect(() => {
    if (!ok) return;
    if (tab === "checklist") loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ok]);

  async function respondInvoice(action: "accepted" | "rejected") {
    try {
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const r = await fetch("/api/invoices/respond", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ month, action, note: ackNote }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setMsg(action === "accepted" ? "✅ Factura aceptada" : "✅ Factura rechazada");
      await refresh();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  return (
    <>
      <AppHeader />

      {!ok ? (
        <div style={{ padding: 40 }}>Cargando…</div>
      ) : (
        <div className="tc-wrap">
          <div className="tc-container">
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 18 }}>🔮 Panel Tarotista</div>
                  <div className="tc-sub">
                    Mes: <b>{month}</b> {msg ? `· ${msg}` : ""}
                  </div>
                </div>

                <div className="tc-row">
                  <button className="tc-btn tc-btn-gold" onClick={refresh}>Actualizar</button>
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
                <button className={`tc-tab ${tab === "checklist" ? "tc-tab-active" : ""}`} onClick={() => setTab("checklist")}>
                  ✅ Checklist
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
                    <Kpi label="Bono ranking (hoy)" value={eur(bonusRanking)} />
                    <Kpi label="Incidencias (en vivo)" value={`- ${eur(incidenciasLive)}`} />
                    <Kpi label="Total estimado" value={eur(totalPreview)} highlight />
                  </div>

                  <div className="tc-sub" style={{ marginTop: 10, opacity: 0.9 }}>
                    Bonos totales del mes: <b>{eur(bonusTotal)}</b>
                  </div>
                </div>

                <div className="tc-card" style={{ gridColumn: "1 / -1" }}>
                  <div className="tc-title">⚠️ Incidencias del mes (en vivo)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Te aparecen aquí en cuanto la central las crea (no depende de regenerar factura).
                  </div>
                  <div className="tc-hr" />
                  {!incidents || incidents.length === 0 ? (
                    <div className="tc-sub">No tienes incidencias este mes.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(incidents || []).slice(0, 8).map((i: any) => (
                        <div
                          key={i.id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(255,80,80,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between" }}>
                            <div style={{ fontWeight: 900 }}>{i.title || i.reason || "Incidencia"}</div>
                            <div style={{ fontWeight: 900 }}>-{eur(i.amount)}</div>
                          </div>
                          {i.reason ? <div className="tc-sub" style={{ marginTop: 6 }}>{i.reason}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
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
                      <div className="tc-row" style={{ justifyContent: "space-between" }}><span>0–9 captadas</span><b>0,50€</b></div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}><span>10–19 captadas</span><b>1,00€</b></div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}><span>20–29 captadas</span><b>1,50€</b></div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}><span>30+ captadas</span><b>2,00€</b></div>
                    </div>
                  </div>
                </div>

                <div className="tc-card">
                  <div className="tc-title">🏆 Bono ranking (en vivo)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Esto es lo que llevas ganado <b>hoy</b> por tu posición del mes. Si mañana bajas, también baja (y al revés).
                  </div>

                  <div className="tc-hr" />

                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(181,156,255,0.08)",
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div className="tc-sub">Bono ranking acumulado (según posición actual)</div>
                        <div style={{ fontWeight: 900, fontSize: 26, marginTop: 6 }}>{eur(bonusRanking)}</div>
                      </div>

                      <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Captadas: <b>{eur(brCaptadas)}</b>
                        </span>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Cliente: <b>{eur(brCliente)}</b>
                        </span>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Repite: <b>{eur(brRepite)}</b>
                        </span>
                      </div>
                    </div>

                    <div className="tc-hr" style={{ margin: "12px 0" }} />

                    <div style={{ display: "grid", gap: 8 }}>
                      <RankLiveRow label="🏆 Captadas" pos={posCaptadas} amount={brCaptadas} />
                      <RankLiveRow label="👑 Cliente" pos={posCliente} amount={brCliente} />
                      <RankLiveRow label="🔁 Repite" pos={posRepite} amount={brRepite} />
                    </div>

                    <div className="tc-sub" style={{ marginTop: 10, opacity: 0.9 }}>
                      Premio: 🥇 6€ · 🥈 4€ · 🥉 2€ · fuera del top 3 = 0€
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

            {/* TAB: CHECKLIST */}
            {tab === "checklist" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">✅ Checklist del turno</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Turno: <b>{clShiftKey || "—"}</b> · Completadas: <b>{clProgress.completed}/{clProgress.total}</b>
                      {clMsg ? ` · ${clMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={loadChecklist} disabled={clLoading}>
                      {clLoading ? "Cargando…" : "Actualizar checklist"}
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <input
                      className="tc-input"
                      value={clQ}
                      onChange={(e) => setClQ(e.target.value)}
                      placeholder="Buscar en checklist…"
                      style={{ width: 320, maxWidth: "100%" }}
                    />

                    <div style={{ minWidth: 240, flex: 1 }}>
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
                            width: `${clampPct(clProgress.pct)}%`,
                            background: "linear-gradient(90deg, rgba(181,156,255,0.95), rgba(215,181,109,0.95))",
                          }}
                        />
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Progreso: <b>{clProgress.pct}%</b>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
                    {(clFiltered || []).map((it: any) => {
                      const title = String(it.title || it.label || it.item_key || "Checklist item");
                      const done = !!it.done || it.status === "completed" || it.completed === true;
                      const desc = String(it.description || it.desc || "");
                      const doneAt = it.completed_at || it.done_at || it.updated_at || null;

                      return (
                        <div
                          key={String(it.item_key || it.key || it.id || title)}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: done ? "rgba(120,255,190,0.10)" : "rgba(255,255,255,0.03)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 240 }}>
                              <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ opacity: done ? 1 : 0.9 }}>{done ? "✅" : "⬜"}</span>
                                <span>{title}</span>
                              </div>
                              {desc ? <div className="tc-sub" style={{ marginTop: 6 }}>{desc}</div> : null}
                              {done && doneAt ? (
                                <div className="tc-sub" style={{ marginTop: 6, opacity: 0.85 }}>
                                  Completado: <b>{new Date(doneAt).toLocaleString("es-ES")}</b>
                                </div>
                              ) : null}
                            </div>

                            <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                                {done ? "Completado" : "Pendiente"}
                              </span>

                              <button
                                className="tc-btn tc-btn-purple"
                                onClick={() => toggleChecklistItem(it)}
                                disabled={clLoading}
                                style={{ minWidth: 160 }}
                              >
                                {done ? "Marcar como pendiente" : "Marcar como hecho"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(!clFiltered || clFiltered.length === 0) && (
                      <div className="tc-sub">No hay items en tu checklist (o no coinciden con la búsqueda).</div>
                    )}
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-sub">
                    Nota: el checklist se reinicia automáticamente con el <b>turno</b> (shift_key). Si cambia el turno, recarga.
                  </div>
                </div>
              </div>
            )}

            {/* TAB: FACTURA */}
            {tab === "facturas" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="tc-title">🧾 Mi factura</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Aquí está la factura oficial (líneas por códigos + bonos + incidencias).
                    </div>
                  </div>
                  <button className="tc-btn tc-btn-gold" onClick={refresh}>Recargar</button>
                </div>

                <div className="tc-hr" />

                {!invoice ? (
                  <div className="tc-sub">Aún no hay factura generada para este mes. (La genera Admin)</div>
                ) : (
                  <>
                    <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div className="tc-sub">
                          Estado: <b>{invoice.status}</b> · Aceptación: <b>{invoice.worker_ack || "pending"}</b>
                        </div>
                        <div style={{ fontWeight: 900, fontSize: 22, marginTop: 6 }}>{eur(invoice.total || 0)}</div>
                        {invoice.worker_ack_note ? (
                          <div className="tc-sub" style={{ marginTop: 6 }}>
                            Nota enviada: <b>{invoice.worker_ack_note}</b>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ minWidth: 320, maxWidth: "100%" }}>
                        <div className="tc-sub">Nota (opcional, sobre todo si rechazas)</div>
                        <input
                          className="tc-input"
                          value={ackNote}
                          onChange={(e) => setAckNote(e.target.value)}
                          placeholder="Ej: Falta revisar una incidencia…"
                          style={{ width: "100%", marginTop: 6 }}
                        />

                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                          <button className="tc-btn tc-btn-ok" onClick={() => respondInvoice("accepted")}>Aceptar</button>
                          <button className="tc-btn tc-btn-danger" onClick={() => respondInvoice("rejected")}>Rechazar</button>
                        </div>
                      </div>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>📌 Líneas</div>

                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tc-table">
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th>Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invoiceLines || []).map((l: any) => {
                            const meta = l?.meta || {};
                            const hasBreakdown = meta && meta.minutes != null && meta.rate != null;
                            const minutes = Number(meta.minutes || 0);
                            const rate = Number(meta.rate || 0);
                            const calc = minutes * rate;

                            return (
                              <tr key={l.id}>
                                <td>
                                  <b>{l.label}</b>
                                  {hasBreakdown ? (
                                    <div className="tc-sub" style={{ marginTop: 6 }}>
                                      {String(meta.code || "").toUpperCase()} · {minutes} min × {eur(rate)} = <b>{eur(calc)}</b>
                                    </div>
                                  ) : null}
                                </td>
                                <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(l.amount)}</td>
                              </tr>
                            );
                          })}
                          {(!invoiceLines || invoiceLines.length === 0) && (
                            <tr>
                              <td colSpan={2} className="tc-muted">
                                No hay líneas (aún). Si esto pasa, regeneramos factura del mes en Admin.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>⚠️ Incidencias del mes</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Esto se actualiza en vivo (aunque la factura no se regenere).
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      {!incidents || incidents.length === 0 ? (
                        <div className="tc-sub">No tienes incidencias este mes.</div>
                      ) : (
                        (incidents || []).map((i: any) => (
                          <div
                            key={i.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,80,80,0.06)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between" }}>
                              <div style={{ fontWeight: 900 }}>{i.title || i.reason || "Incidencia"}</div>
                              <div style={{ fontWeight: 900 }}>-{eur(i.amount)}</div>
                            </div>
                            {i.reason ? <div className="tc-sub" style={{ marginTop: 6 }}>{i.reason}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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

function RankLiveRow({ label, pos, amount }: { label: string; pos: number | null; amount: number }) {
  const p = pos ?? null;
  const medal = medalForPos(p);
  const note = p ? `Posición actual: ${p}º` : "Fuera del Top 3";
  const expected = bonusForPos(p);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontWeight: 900 }}>{label}</div>
        <div className="tc-sub" style={{ marginTop: 4 }}>
          {medal} {note} · Premio: <b>{eur(expected)}</b>
        </div>
      </div>
      <div style={{ fontWeight: 900, fontSize: 18 }}>{eur(amount)}</div>
    </div>
  );
}
