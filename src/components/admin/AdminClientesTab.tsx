"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type AlertItem = {
  cliente_id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  pais: string;
  email: string;
  total_gastado: number;
  completed_payments_count: number;
  ultimo_pago_at: string | null;
  dias_sin_pago: number | null;
  bonus_count: number;
  vip: boolean;
};

type RankClient = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  email?: string | null;
  rango_actual?: string | null;
  rango_gasto_mes_anterior?: number | null;
  rango_compras_mes_anterior?: number | null;
};

type ApiPayload = {
  ok: boolean;
  generated_at?: string;
  summary?: {
    totalClientesConPago: number;
    bonosPendientes: number;
    clientesVip: number;
    inactivos30: number;
    inactivos60: number;
    facturacionTotal: number;
  };
  inactivityAlerts?: { yellow: AlertItem[]; red: AlertItem[] };
  error?: string;
};

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 1200), _status: res.status, _ok: res.ok };
  }
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDays(days?: number | null) {
  if (days == null || !Number.isFinite(days)) return "Sin pagos";
  if (days === 0) return "Hoy";
  if (days === 1) return "1 día";
  return `${days} días`;
}

function personLabel(item: AlertItem | RankClient) {
  const full = [item.nombre, item.apellido].filter(Boolean).join(" ").trim();
  return full || item.telefono || item.email || ("cliente_id" in item ? `Cliente ${item.cliente_id}` : item.id);
}

function initials(item: AlertItem) {
  return personLabel(item).split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "CL";
}

function KpiCard({ title, value, hint, accent, onClick, active = false }: { title: string; value: string; hint: string; accent: string; onClick?: () => void; active?: boolean }) {
  return (
    <div onClick={onClick} style={{ position: "relative", overflow: "hidden", borderRadius: 20, border: active ? `1px solid ${accent}` : "1px solid rgba(255,255,255,.10)", background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))", boxShadow: "0 20px 50px rgba(0,0,0,.18)", padding: 18, cursor: onClick ? "pointer" : "default", transition: "transform .18s ease, border-color .18s ease" }}>
      <div style={{ position: "absolute", inset: "auto -20px -30px auto", width: 110, height: 110, borderRadius: 999, background: accent, filter: "blur(28px)", opacity: 0.18, pointerEvents: "none" }} />
      <div className="tc-sub" style={{ opacity: 0.82, fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, lineHeight: 1.05 }}>{value}</div>
      <div className="tc-sub" style={{ marginTop: 8 }}>{hint}</div>
    </div>
  );
}

function AlertRow({ item, tone, badge, title, description, cta }: { item: AlertItem; tone: "yellow" | "red"; badge: string; title: string; description: string; cta: () => void }) {
  const palette = tone === "red"
    ? { border: "rgba(255,98,98,.24)", bg: "linear-gradient(135deg, rgba(255,98,98,.14), rgba(255,255,255,.03))", chip: "rgba(255,98,98,.16)", glow: "rgba(255,98,98,.22)" }
    : { border: "rgba(246,208,74,.22)", bg: "linear-gradient(135deg, rgba(246,208,74,.12), rgba(255,255,255,.03))", chip: "rgba(246,208,74,.16)", glow: "rgba(246,208,74,.22)" };

  return (
    <div style={{ position: "relative", overflow: "hidden", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", borderRadius: 18, border: `1px solid ${palette.border}`, background: palette.bg, padding: 14, boxShadow: "0 14px 30px rgba(0,0,0,.14)" }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", fontWeight: 900, letterSpacing: ".05em", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)", boxShadow: `0 0 0 1px ${palette.glow} inset` }}>{initials(item)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{personLabel(item)}</div>
          <span className="tc-chip" style={{ background: palette.chip, border: `1px solid ${palette.border}`, fontSize: 12, borderRadius: 999, padding: "6px 10px" }}>{badge}</span>
        </div>
        <div className="tc-sub" style={{ marginTop: 6 }}>{title}</div>
        <div className="tc-row tc-sub" style={{ marginTop: 8, gap: 10, flexWrap: "wrap", opacity: 0.9 }}>
          <span>Gastado: <b>{eur(item.total_gastado)}</b></span>
          <span>Último pago: <b>{formatDateTime(item.ultimo_pago_at)}</b></span>
          <span>Actividad: <b>{formatDays(item.dias_sin_pago)}</b></span>
          {item.telefono ? <span>Tel: <b>{item.telefono}</b></span> : null}
        </div>
        <div className="tc-sub" style={{ marginTop: 6, opacity: 0.88 }}>{description}</div>
      </div>
      <button className="tc-btn tc-btn-gold" onClick={cta}>Revisar CRM</button>
    </div>
  );
}

export default function AdminClientesTab({ onReviewClient }: { onReviewClient?: (clienteId: string) => void }) {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [rankSummary, setRankSummary] = useState<any>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankMsg, setRankMsg] = useState("");
  const [rankFilter, setRankFilter] = useState<"bronce" | "plata" | "oro" | null>(null);
  const [rankClients, setRankClients] = useState<RankClient[]>([]);
  const [rankClientsLoading, setRankClientsLoading] = useState(false);

  async function getTokenOrLogin() {
    const { data: authData } = await sb.auth.getSession();
    const token = authData.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadAlerts(silent = false) {
    try {
      if (!silent) { setLoading(true); setMsg(""); }
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch(`/api/admin/crm/clientes-alertas?t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);
      setData(json as ApiPayload);
      setLastUpdated(json.generated_at || new Date().toISOString());
      if (!silent) setMsg("✅ Clientes actualizados.");
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando clientes"}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadRankSummary(silent = false) {
    try {
      if (!silent) { setRankLoading(true); setRankMsg(""); }
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch(`/api/admin/client-ranks/summary?t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);
      setRankSummary(json.summary || null);
      if (!silent) setRankMsg("✅ Rangos actualizados.");
    } catch (e: any) {
      if (!silent) setRankMsg(`❌ ${e?.message || "Error cargando rangos"}`);
    } finally {
      if (!silent) setRankLoading(false);
    }
  }

  async function recalculateRanks() {
    try {
      setRankLoading(true);
      setRankMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch("/api/admin/client-ranks/recalculate", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);
      await loadRankSummary(true);
      setRankMsg("✅ Rangos recalculados.");
    } catch (e: any) {
      setRankMsg(`❌ ${e?.message || "Error recalculando"}`);
    } finally {
      setRankLoading(false);
    }
  }

  async function openRankClients(rank: "bronce" | "plata" | "oro") {
    try {
      setRankFilter(rank);
      setRankClientsLoading(true);
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch(`/api/admin/client-ranks/by-rank?rank=${encodeURIComponent(rank)}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);
      setRankClients(json.clients || json.rows || []);
    } catch {
      setRankClients([]);
    } finally {
      setRankClientsLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts(false);
    loadRankSummary(true);
    const timer = setInterval(() => { loadAlerts(true); loadRankSummary(true); }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary || { totalClientesConPago: 0, inactivos30: 0, inactivos60: 0, facturacionTotal: 0 };
  const visibleRedRows = useMemo(() => data?.inactivityAlerts?.red || [], [data]);
  const visibleYellowRows = useMemo(() => data?.inactivityAlerts?.yellow || [], [data]);
  const inactiveTotal = visibleRedRows.length + visibleYellowRows.length;

  const movementSummary = useMemo(() => {
    const bronce = Number(rankSummary?.bronce || 0);
    const plata = Number(rankSummary?.plata || 0);
    const oro = Number(rankSummary?.oro || 0);
    return {
      total: bronce + plata + oro,
      top: oro > 0 ? "Oro" : plata > 0 ? "Plata" : bronce > 0 ? "Bronce" : "Sin rango",
      subida: Number(rankSummary?.subidas || rankSummary?.up || 0),
      bajada: Number(rankSummary?.bajadas || rankSummary?.down || 0),
    };
  }, [rankSummary]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="tc-card" style={{ borderRadius: 24, border: "1px solid rgba(255,215,120,.10)", background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))", boxShadow: "0 20px 50px rgba(0,0,0,.18)" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title">🏅 Resumen de rangos</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>Cuántos clientes hay por rango, quién sube y quién baja.</div>
          </div>
          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="tc-btn" onClick={() => loadRankSummary(false)} disabled={rankLoading}>{rankLoading ? "Cargando…" : "Actualizar"}</button>
            <button className="tc-btn tc-btn-gold" onClick={recalculateRanks} disabled={rankLoading}>{rankLoading ? "Recalculando…" : "Recalcular"}</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 14 }}>
          <KpiCard title="Bronce" value={String(Number(rankSummary?.bronce || 0))} hint="Clientes en rango bronce" accent="rgba(214,156,110,.28)" onClick={() => openRankClients("bronce")} active={rankFilter === "bronce"} />
          <KpiCard title="Plata" value={String(Number(rankSummary?.plata || 0))} hint="Clientes en rango plata" accent="rgba(196,210,255,.28)" onClick={() => openRankClients("plata")} active={rankFilter === "plata"} />
          <KpiCard title="Oro" value={String(Number(rankSummary?.oro || 0))} hint="Clientes en rango oro" accent="rgba(255,215,120,.28)" onClick={() => openRankClients("oro")} active={rankFilter === "oro"} />
          <KpiCard title="Suben" value={String(movementSummary.subida)} hint="Movimientos positivos detectados" accent="rgba(120,255,190,.35)" />
          <KpiCard title="Bajan" value={String(movementSummary.bajada)} hint="Movimientos negativos detectados" accent="rgba(255,98,98,.35)" />
          <KpiCard title="Total con rango" value={String(Number(rankSummary?.totalConRango || movementSummary.total || 0))} hint={`Rango dominante: ${movementSummary.top}`} accent="rgba(181,156,255,.28)" />
        </div>
        {rankMsg ? <div className="tc-sub" style={{ marginTop: 10 }}>{rankMsg}</div> : null}

        {rankFilter ? (
          <div style={{ marginTop: 14, borderRadius: 20, border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.03)", padding: 14 }}>
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>Clientes {rankFilter.charAt(0).toUpperCase() + rankFilter.slice(1)}</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>Pulsa en revisar para abrir la ficha del CRM.</div>
              </div>
              <button className="tc-btn" onClick={() => setRankFilter(null)}>Cerrar</button>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {rankClientsLoading ? <div className="tc-sub">Cargando clientes...</div> : null}
              {!rankClientsLoading && !rankClients.length ? <div className="tc-sub">No hay clientes en este rango.</div> : null}
              {rankClients.map((client) => (
                <div key={client.id} style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)", padding: 12, display: "grid", gap: 8 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{personLabel(client)}</div>
                      <div className="tc-sub" style={{ marginTop: 4 }}>{[client.telefono, client.email].filter(Boolean).join(" · ") || "Sin contacto"}</div>
                    </div>
                    <button className="tc-btn tc-btn-gold" onClick={() => onReviewClient?.(client.id)}>Revisar CRM</button>
                  </div>
                  <div className="tc-row tc-sub" style={{ gap: 12, flexWrap: "wrap" }}>
                    <span>Gasto: <b>{eur(client.rango_gasto_mes_anterior || 0)}</b></span>
                    <span>Compras: <b>{Number(client.rango_compras_mes_anterior || 0)}</b></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="tc-card" style={{ position: "relative", overflow: "hidden", borderRadius: 24, border: "1px solid rgba(255,255,255,.10)", background: "radial-gradient(circle at top right, rgba(255,98,98,.14), transparent 28%), linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))", boxShadow: "0 28px 70px rgba(0,0,0,.20)" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title" style={{ fontSize: 22 }}>⏳ Clientes sin actividad reciente</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 760 }}>Única vista de clientes del admin: foco en recuperar clientes fríos y detectar riesgo de pérdida.</div>
            <div className="tc-sub" style={{ marginTop: 8, opacity: 0.82 }}>Última actualización: <b>{lastUpdated ? formatDateTime(lastUpdated) : "—"}</b>{msg ? ` · ${msg}` : ""}</div>
          </div>
          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tc-chip">{inactiveTotal} sin actividad</span>
            <button className="tc-btn tc-btn-gold" onClick={() => loadAlerts(false)} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button>
          </div>
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-4" style={{ gap: 14 }}>
          <KpiCard title="Clientes con pagos" value={String(summary.totalClientesConPago || 0)} hint="Base total detectada" accent="rgba(181,156,255,.45)" />
          <KpiCard title="Riesgo 30+ días" value={String(summary.inactivos30 || visibleYellowRows.length)} hint="Seguimiento recomendado" accent="rgba(246,208,74,.45)" />
          <KpiCard title="Riesgo 60+ días" value={String(summary.inactivos60 || visibleRedRows.length)} hint="Prioridad alta" accent="rgba(255,98,98,.50)" />
          <KpiCard title="Facturación histórica" value={eur(summary.facturacionTotal || 0)} hint="Solo como contexto" accent="rgba(120,255,190,.45)" />
        </div>
      </div>

      <div className="tc-card" style={{ borderRadius: 22, boxShadow: "0 22px 50px rgba(0,0,0,.16)" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">Clientes sin actividad reciente</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>Ordenados por riesgo: primero 60+ días, después 30+ días.</div>
          </div>
          <span className="tc-chip">{visibleRedRows.length} alto · {visibleYellowRows.length} seguimiento</span>
        </div>
        <div className="tc-hr" />
        <div style={{ display: "grid", gap: 12 }}>
          {visibleRedRows.map((item) => (
            <AlertRow key={`${item.cliente_id}-red`} item={item} tone="red" badge="Riesgo alto" title="Posible cliente perdido" description={`Lleva ${formatDays(item.dias_sin_pago)} sin registrar pago. Conviene revisar ficha, notas y seguimiento.`} cta={() => onReviewClient?.(item.cliente_id)} />
          ))}
          {visibleYellowRows.map((item) => (
            <AlertRow key={`${item.cliente_id}-yellow`} item={item} tone="yellow" badge="Seguimiento" title="Cliente con más de un mes sin pagar" description={`Lleva ${formatDays(item.dias_sin_pago)} sin actividad económica registrada. Buen momento para revisar y contactar.`} cta={() => onReviewClient?.(item.cliente_id)} />
          ))}
          {visibleRedRows.length === 0 && visibleYellowRows.length === 0 ? (
            <div style={{ borderRadius: 18, border: "1px dashed rgba(255,255,255,.14)", background: "rgba(255,255,255,.025)", padding: 18 }}>
              <div style={{ fontWeight: 800 }}>Sin clientes fríos</div>
              <div className="tc-sub" style={{ marginTop: 8 }}>No hemos detectado clientes con más de 30 días sin pago completed.</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
