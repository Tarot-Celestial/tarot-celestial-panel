"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CalendarDays, CircleDollarSign, Clock3, Coins, Gauge, PhoneCall, RefreshCw, Search, Settings2, TrendingDown, TrendingUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./WelldoneAdminPanel.module.css";

const sb = supabaseBrowser();

type Metric = { current: number; previous: number; change_pct: number | null; trend: "up" | "down" | "flat" };
type Report = {
  range: { start: string; end: string };
  previous_range: { start: string; end: string };
  summary: { calls: number; minutes: number; cost: number; avg_minutes: number; avg_cost: number; unpriced_calls: number; unpriced_minutes: number };
  previous_summary: { calls: number; minutes: number; cost: number; avg_minutes: number; avg_cost: number; unpriced_calls: number; unpriced_minutes: number };
  comparison: { minutes: Metric; cost: Metric; calls: Metric; avg_minutes: Metric; avg_cost: Metric };
  current_rate: number;
  tariffs: Array<{ id: string; rate_per_minute: number; effective_from: string }>;
  daily: Array<{ date: string; calls: number; minutes: number; cost: number; avg_minutes: number; avg_cost: number; cumulative_cost: number }>;
  detail: Array<{
    id: string; occurred_at: string; date: string; time: string; client_name: string; phone: string | null;
    telefonista_name: string; tarotista_origen: string; type: string; code: string; minutes: number;
    rate_per_minute: number | null; cost: number | null; payment_method: string; amount: number; corrected: boolean; revision: number; reference: string;
  }>;
  pagination: { page: number; page_size: number; total: number; pages: number };
  filter_options: { telefonistas: string[]; methods: string[]; types: string[] };
};

function monthNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: unknown) {
  return (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function num(value: unknown, digits = 2) {
  return (Number(value) || 0).toLocaleString("es-ES", { maximumFractionDigits: digits });
}

function dateLabel(value: string) {
  const d = new Date(`${value}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : value;
}

function pctLabel(metric: Metric) {
  if (metric.change_pct === null) return "Sin base comparable";
  const sign = metric.change_pct > 0 ? "+" : "";
  return `${sign}${num(metric.change_pct, 1)} % vs anterior`;
}

function MiniTrend({ metric, costSemantics = false }: { metric: Metric; costSemantics?: boolean }) {
  const badUp = costSemantics && metric.trend === "up";
  const goodDown = costSemantics && metric.trend === "down";
  const tone = badUp ? "bad" : goodDown ? "good" : metric.trend === "up" ? "up" : metric.trend === "down" ? "down" : "flat";
  const Icon = metric.trend === "down" ? TrendingDown : TrendingUp;
  return <span className={styles.trend} data-tone={tone}><Icon size={13} /> {pctLabel(metric)}</span>;
}

function Sparkline({ values, cumulative = false }: { values: Array<{ date: string; value: number }>; cumulative?: boolean }) {
  const width = 760;
  const height = 180;
  const max = Math.max(1, ...values.map((v) => Number(v.value) || 0));
  const points = values.map((v, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((Number(v.value) || 0) / max) * (height - 22) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className={styles.sparkWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.spark} role="img" aria-label={cumulative ? "Coste acumulado" : "Evolución diaria"}>
        <defs>
          <linearGradient id={cumulative ? "wd-fill-cum" : "wd-fill-day"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className={styles.gridLine} />)}
        {values.length > 1 ? <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${cumulative ? "wd-fill-cum" : "wd-fill-day"})`} /> : null}
        <polyline points={points} className={styles.line} fill="none" />
        {values.map((v, index) => {
          const [x, y] = points.split(" ")[index]?.split(",") || ["0", "0"];
          return <circle key={`${v.date}-${index}`} cx={x} cy={y} r="3.5" className={styles.dot}><title>{`${v.date}: ${money(v.value)}`}</title></circle>;
        })}
      </svg>
      <div className={styles.axisLabels}>
        {values.filter((_, i) => i === 0 || i === values.length - 1 || i % Math.max(1, Math.ceil(values.length / 6)) === 0).map((v) => <span key={v.date}>{dateLabel(v.date)}</span>)}
      </div>
    </div>
  );
}

export default function WelldoneAdminPanel() {
  const [month, setMonth] = useState(monthNow());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [telefonista, setTelefonista] = useState("");
  const [method, setMethod] = useState("");
  const [callType, setCallType] = useState("");
  const [corrected, setCorrected] = useState("all");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingRate, setSavingRate] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sesión no disponible");
      const params = new URLSearchParams({ month, page: String(page), page_size: "25" });
      if (from && to) { params.set("from", from); params.set("to", to); }
      if (client.trim()) params.set("client", client.trim());
      if (phone.trim()) params.set("phone", phone.trim());
      if (telefonista) params.set("telefonista", telefonista);
      if (method) params.set("method", method);
      if (callType) params.set("type", callType);
      if (corrected !== "all") params.set("corrected", corrected);
      const response = await fetch(`/api/admin/welldone?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        if (json?.error === "WELLDONE_SQL_REQUIRED" || json?.error === "WELLDONE_TARIFF_MISSING") {
          throw new Error("Falta aplicar SQL_WELLDONE.sql en Supabase.");
        }
        throw new Error(json?.error || "No se pudo cargar WELLDONE");
      }
      setReport(json.report);
      setRate(json.report?.current_rate ? String(json.report.current_rate) : "");
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar WELLDONE");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [callType, client, corrected, from, getToken, method, month, page, phone, telefonista, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void load(true), 700);
    };
    const onVisible = () => { if (!document.hidden) refresh(); };
    const onOnline = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const channel = sb.channel("admin-welldone-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "welldone_tariffs" }, refresh)
      .subscribe();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      void sb.removeChannel(channel);
    };
  }, [load]);

  async function saveRate() {
    if (savingRate) return;
    setSavingRate(true);
    setMessage("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sesión no disponible");
      const response = await fetch("/api/admin/welldone", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rate_per_minute: rate, effective_from: effectiveFrom }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo guardar la tarifa");
      setMessage("✅ Tarifa guardada con vigencia histórica.");
      await load(true);
    } catch (error: any) {
      setMessage(`❌ ${error?.message || "No se pudo guardar"}`);
    } finally {
      setSavingRate(false);
    }
  }

  const daily = report?.daily || [];
  const maxDailyCost = Math.max(1, ...daily.map((row) => row.cost));
  const monthName = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, Math.max(0, (m || 1) - 1), 1);
    return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }, [month]);

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}>CONTROL ECONÓMICO · CALL</div>
          <h1>WELLDONE</h1>
          <p>Control de minutos y coste de llamadas derivadas. Los datos salen del mismo Rendimiento vigente: una llamada, una fuente de verdad.</p>
        </div>
        <div className={styles.heroActions}>
          <label><span>Periodo</span><input type="month" value={month} onChange={(e) => { setMonth(e.target.value || monthNow()); setFrom(""); setTo(""); setPage(1); }} /></label>
          <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? styles.spin : ""} /> {loading ? "Actualizando…" : "Actualizar"}</button>
        </div>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}
      {(report?.summary.unpriced_calls || 0) > 0 ? <div className={styles.warning}>⚠️ Hay {report?.summary.unpriced_calls} llamada(s) · {num(report?.summary.unpriced_minutes || 0)} min anteriores a la primera tarifa histórica configurada. Los minutos sí cuentan, pero su coste no se inventa. Añade la vigencia real en Configuración.</div> : null}

      <div className={styles.kpis}>
        <article className={styles.kpi}><div><Clock3 size={18}/><span>Minutos</span></div><strong>{num(report?.summary.minutes || 0)} min</strong><MiniTrend metric={report?.comparison.minutes || { current:0, previous:0, change_pct:0, trend:"flat" }} /></article>
        <article className={styles.kpi}><div><CircleDollarSign size={18}/><span>Coste</span></div><strong>{money(report?.summary.cost || 0)}</strong><MiniTrend costSemantics metric={report?.comparison.cost || { current:0, previous:0, change_pct:0, trend:"flat" }} /></article>
        <article className={styles.kpi}><div><PhoneCall size={18}/><span>Llamadas derivadas</span></div><strong>{num(report?.summary.calls || 0, 0)}</strong><MiniTrend metric={report?.comparison.calls || { current:0, previous:0, change_pct:0, trend:"flat" }} /></article>
        <article className={styles.kpi}><div><Activity size={18}/><span>Media / llamada</span></div><strong>{num(report?.summary.avg_minutes || 0)} min</strong><MiniTrend metric={report?.comparison.avg_minutes || { current:0, previous:0, change_pct:0, trend:"flat" }} /></article>
        <article className={styles.kpi}><div><Coins size={18}/><span>Coste medio</span></div><strong>{money(report?.summary.avg_cost || 0)}</strong><MiniTrend costSemantics metric={report?.comparison.avg_cost || { current:0, previous:0, change_pct:0, trend:"flat" }} /></article>
        <article className={styles.kpi} data-accent="gold"><div><Gauge size={18}/><span>Tarifa actual</span></div><strong>{num(report?.current_rate || 0, 4)} €/min</strong><small>Aplicación histórica por fecha de llamada</small></article>
      </div>

      <div className={styles.grid2}>
        <article className={styles.card}>
          <div className={styles.cardHead}><div><span className={styles.kicker}>EVOLUCIÓN DEL CONSUMO</span><h2>{monthName}</h2></div><small>Coste diario</small></div>
          {daily.some((d) => d.calls > 0) ? <Sparkline values={daily.map((d) => ({ date: d.date, value: d.cost }))} /> : <div className={styles.empty}>Sin llamadas WELLDONE en el periodo seleccionado.</div>}
        </article>
        <article className={styles.card}>
          <div className={styles.cardHead}><div><span className={styles.kicker}>COSTE ACUMULADO</span><h2>Velocidad de gasto</h2></div><small>{money(report?.summary.cost || 0)}</small></div>
          {daily.some((d) => d.calls > 0) ? <Sparkline cumulative values={daily.map((d) => ({ date: d.date, value: d.cumulative_cost }))} /> : <div className={styles.empty}>El acumulado aparecerá cuando existan llamadas.</div>}
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>CONSUMO POR DÍA</span><h2>Detalle diario</h2></div><small>{report?.range.start} → {report?.range.end}</small></div>
        <div className={styles.dailyBars}>
          {daily.filter((d) => d.calls > 0).map((d) => (
            <div className={styles.dayBar} key={d.date}>
              <div className={styles.dayMeta}><strong>{dateLabel(d.date)}</strong><span>{d.calls} llamadas · {num(d.minutes)} min · {money(d.cost)}</span></div>
              <div className={styles.barTrack}><span style={{ width: `${Math.max(2, (d.cost / maxDailyCost) * 100)}%` }} /></div>
              <small>Media {num(d.avg_minutes)} min/llamada · {money(d.avg_cost)}/llamada</small>
            </div>
          ))}
          {!daily.some((d) => d.calls > 0) ? <div className={styles.empty}>0 llamadas · 0 min · 0,00 €</div> : null}
        </div>
      </article>

      <div className={styles.grid2}>
        <article className={styles.card}>
          <div className={styles.cardHead}><div><span className={styles.kicker}>COMPARATIVA</span><h2>Periodo vs anterior</h2></div><small>{report?.previous_range.start} → {report?.previous_range.end}</small></div>
          <div className={styles.compareList}>
            <div><span>Minutos</span><strong>{num(report?.summary.minutes || 0)}</strong><MiniTrend metric={report?.comparison.minutes || { current:0, previous:0, change_pct:0, trend:"flat" }} /></div>
            <div><span>Coste</span><strong>{money(report?.summary.cost || 0)}</strong><MiniTrend costSemantics metric={report?.comparison.cost || { current:0, previous:0, change_pct:0, trend:"flat" }} /></div>
            <div><span>Llamadas</span><strong>{num(report?.summary.calls || 0, 0)}</strong><MiniTrend metric={report?.comparison.calls || { current:0, previous:0, change_pct:0, trend:"flat" }} /></div>
            <div><span>Duración media</span><strong>{num(report?.summary.avg_minutes || 0)} min</strong><MiniTrend metric={report?.comparison.avg_minutes || { current:0, previous:0, change_pct:0, trend:"flat" }} /></div>
            <div><span>Coste medio</span><strong>{money(report?.summary.avg_cost || 0)}</strong><MiniTrend costSemantics metric={report?.comparison.avg_cost || { current:0, previous:0, change_pct:0, trend:"flat" }} /></div>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHead}><div><span className={styles.kicker}>CONFIGURACIÓN</span><h2>Tarifa WELLDONE</h2></div><Settings2 size={18}/></div>
          <p className={styles.help}>Cada cambio crea una vigencia. Las llamadas antiguas conservan la tarifa que correspondía a su fecha.</p>
          <div className={styles.rateForm}>
            <label><span>Tarifa €/min</span><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" /></label>
            <label><span>Vigente desde</span><input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
            <button type="button" onClick={saveRate} disabled={savingRate}>{savingRate ? "Guardando…" : "Guardar tarifa"}</button>
          </div>
          <div className={styles.tariffHistory}>
            {(report?.tariffs || []).slice().reverse().slice(0, 6).map((t) => <div key={t.id}><span>Desde {t.effective_from}</span><strong>{num(t.rate_per_minute, 4)} €/min</strong></div>)}
          </div>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>DETALLE WELLDONE</span><h2>Auditoría de llamadas</h2></div><small>{report?.pagination.total || 0} registros</small></div>
        <div className={styles.filters}>
          <label><span>Desde</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
          <label><span>Cliente</span><div className={styles.searchInput}><Search size={14}/><input value={client} onChange={(e) => { setClient(e.target.value); setPage(1); }} placeholder="Nombre" /></div></label>
          <label><span>Teléfono</span><div className={styles.searchInput}><Search size={14}/><input value={phone} onChange={(e) => { setPhone(e.target.value); setPage(1); }} placeholder="Número" /></div></label>
          <label><span>Central</span><select value={telefonista} onChange={(e) => { setTelefonista(e.target.value); setPage(1); }}><option value="">Todas</option>{(report?.filter_options.telefonistas || []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Método</span><select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}><option value="">Todos</option>{(report?.filter_options.methods || []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Tipo</span><select value={callType} onChange={(e) => { setCallType(e.target.value); setPage(1); }}><option value="">Todos</option>{(report?.filter_options.types || []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Corrección</span><select value={corrected} onChange={(e) => { setCorrected(e.target.value); setPage(1); }}><option value="all">Todas</option><option value="yes">Corregidas</option><option value="no">Sin corregir</option></select></label>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Central</th><th>Origen</th><th>Código</th><th>Minutos</th><th>Tarifa</th><th>Coste</th><th>Método</th><th>Referencia</th></tr></thead>
            <tbody>
              {(report?.detail || []).map((row) => <tr key={row.id}>
                <td><strong>{new Date(row.occurred_at).toLocaleDateString("es-ES")}</strong><small>{row.time}</small></td>
                <td><strong>{row.client_name}</strong><small>{row.phone || "Sin teléfono"}</small></td>
                <td>{row.telefonista_name}</td>
                <td><strong>{row.tarotista_origen}</strong><small>{row.type}</small></td>
                <td>{row.code}</td>
                <td><strong>{num(row.minutes)} min</strong>{row.corrected ? <span className={styles.corrected}>CORREGIDA · r{row.revision}</span> : null}</td>
                <td>{row.rate_per_minute == null ? <span className={styles.pendingRate}>Sin tarifa</span> : `${num(row.rate_per_minute, 4)} €`}</td>
                <td><strong>{row.cost == null ? "Pendiente" : money(row.cost)}</strong></td>
                <td>{row.payment_method}</td>
                <td><code>{row.reference.slice(0, 8)}…</code></td>
              </tr>)}
              {!report?.detail?.length ? <tr><td colSpan={10}><div className={styles.empty}>Sin llamadas WELLDONE para los filtros seleccionados.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <button type="button" disabled={(report?.pagination.page || 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
          <span>Página {report?.pagination.page || 1} de {report?.pagination.pages || 1}</span>
          <button type="button" disabled={(report?.pagination.page || 1) >= (report?.pagination.pages || 1)} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </div>
      </article>

      <div className={styles.sourceNote}><CalendarDays size={15}/> Fuente: Rendimiento vigente · filtro estable <b>llamada_call = true</b> · minutos actuales desde <b>tiempo</b>. Las correcciones de Rendimiento se recalculan sobre el mismo registro.</div>
    </section>
  );
}
