"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Clock3, Download, Info, RefreshCw, Settings2, ShieldCheck, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ecuadorDate, type CentralMetric, type CentralMetricKey, type CentralStatisticsResponse, type CentralWorkerStatistics } from "@/lib/central-statistics";
import styles from "./CentralStatisticsPanel.module.css";

type SaveAction = Record<string, unknown>;
type Save = (action: SaveAction) => Promise<void>;
const number = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const euro = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const hours = (minutes: number | null) => minutes == null ? "Sin registro" : `${Math.floor(Math.round(Math.abs(minutes)) / 60)} h ${(Math.round(Math.abs(minutes)) % 60).toString().padStart(2, "0")} min`;
const shortDate = (d: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
const labelRole = (role: string) => role === "admin" ? "Administración" : "Central";

const metricRows: { key: CentralMetricKey; label: string; help: string; kind?: "money" | "minutes"; lowerIsBetter?: boolean }[] = [
  { key: "captures_confirmed", label: "Captaciones confirmadas", help: "Conversión confirmada atribuida a la central de la primera gestión válida." },
  { key: "recoveries", label: "Recuperaciones confirmadas", help: "Clientes recuperados y atribuidos en el registro de recuperación." },
  { key: "payments_count", label: "Cobros realizados", help: "Pagos económicos válidos atribuidos a esta persona, sin duplicar la llamada." },
  { key: "payments_amount", label: "Importe cobrado", help: "Suma de esos cobros confirmados.", kind: "money" },
  { key: "average_payment", label: "Importe medio por cobro", help: "Importe cobrado dividido entre los cobros realizados.", kind: "money" },
  { key: "payments_during_session_count", label: "Cobros durante su conexión", help: "Cobros de esta persona cuyo momento coincide con una sesión registrada." },
  { key: "payments_during_session_amount", label: "Importe durante su conexión", help: "No incluye compras web atribuidas por coincidir en el tiempo.", kind: "money" },
  { key: "recovery_attempts", label: "Intentos de recuperación", help: "Contactos registrados, incluidos los que no cuentan para la misión." },
  { key: "recovery_counted", label: "Gestiones de recuperación válidas", help: "Gestiones que cumplen las reglas de la misión de recuperación." },
  { key: "capture_actions", label: "Gestiones de captación", help: "Acciones realizadas por esta persona; no equivalen a captaciones ganadas." },
  { key: "followups_completed", label: "Seguimientos completados", help: "Seguimientos cerrados durante el periodo." },
  { key: "notes_written", label: "Notas de seguimiento registradas", help: "Notas atribuidas a esta persona; pueden incluir notas generadas al gestionar una captación." },
  { key: "calls_registered", label: "Llamadas registradas", help: "Gestiones de rendimiento registradas con esta telefonista." },
  { key: "call_minutes", label: "Tiempo de llamadas registrado", help: "Duración anotada en rendimiento, distinta del tiempo de conexión.", kind: "minutes" },
  { key: "unique_clients", label: "Clientes únicos atendidos", help: "Personas distintas presentes en los registros de cobros, llamadas y gestiones de esta central." },
  { key: "xp_earned", label: "XP aplicado", help: "Experiencia concedida por el sistema; excluye eventos pendientes o rechazados." },
  { key: "leads_assigned", label: "Leads asignados", help: "Carga asignada. La asignación no otorga por sí sola el mérito de una captación." },
  { key: "pending_followups", label: "Seguimientos pendientes", help: "Pendientes actuales; si no existe una foto histórica comparable se indica expresamente.", lowerIsBetter: true },
];

function Delta({ value, lowerIsBetter = false }: { value: CentralMetric; lowerIsBetter?: boolean }) {
  if (value.current == null || value.previous == null || value.delta == null) return <span className={styles.muted}>Sin base comparable</span>;
  if (value.delta === 0) return <span className={`${styles.delta} ${styles.neutral}`}>— Sin cambio</span>;
  const up = value.delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`${styles.delta} ${(up !== lowerIsBetter) ? styles.positive : styles.negative}`}>
    <Icon size={14} aria-hidden="true" />{value.percent == null ? `${up ? "+" : ""}${number(value.delta)} · sin base %` : `${up ? "+" : ""}${number(value.percent)} %`}
  </span>;
}

class StatisticsRequestError extends Error {
  constructor(message: string, readonly definitive: boolean) { super(message); }
}
async function request(month: string, signal: AbortSignal, body?: SaveAction) {
  signal.throwIfAborted();
  const readSession = () => supabaseBrowser().auth.getSession();
  const session = await new Promise<Awaited<ReturnType<typeof readSession>>>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; signal.removeEventListener("abort", abort); fn(); } };
    const abort = () => finish(() => reject(signal.reason || new DOMException("Tiempo de espera agotado.", "AbortError")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(readSession).then(result => finish(() => resolve(result)), error => finish(() => reject(error)));
  });
  signal.throwIfAborted();
  if (!session.data.session) throw new Error("Inicia sesión con tu cuenta de administración.");
  const response = await fetch(`/api/admin/central-statistics?month=${encodeURIComponent(month)}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${session.data.session.access_token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new StatisticsRequestError(result?.message || result?.error || "No se han podido cargar las estadísticas. Reintenta.", response.status >= 400 && response.status < 500 && response.status !== 409);
  return result;
}

export default function CentralStatisticsPanel({ month }: { month: string }) {
  const [data, setData] = useState<CentralStatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updated, setUpdated] = useState("");
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pendingSave = useRef<{ key: string; operationId: string; uncertain: boolean } | null>(null);
  const saving = useRef(false);
  const activeMonth = useRef(month);
  activeMonth.current = month;

  const load = useCallback(async () => {
    if (activeMonth.current !== month) return;
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    const version = ++requestVersion.current;
    const timer = window.setTimeout(() => controller.abort(), 25000);
    setLoading(true); setError("");
    try {
      const result = await request(month, controller.signal) as CentralStatisticsResponse;
      if (mounted.current && version === requestVersion.current) { setData(result); setUpdated(new Date().toLocaleTimeString("es-ES")); }
    } catch (e) {
      if (mounted.current && version === requestVersion.current) setError(controller.signal.aborted ? "La consulta tardó demasiado. Pulsa Actualizar para reintentar." : e instanceof Error ? e.message : "No se pudo consultar el periodo.");
    } finally {
      clearTimeout(timer);
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    mounted.current = true; setData(null); setNotice(""); void load();
    return () => { mounted.current = false; ++requestVersion.current; requestController.current?.abort(); };
  }, [load]);

  async function save(action: SaveAction) {
    if (saving.current) throw new Error("Espera a que termine el guardado actual.");
    const key = JSON.stringify(action);
    if (pendingSave.current && pendingSave.current.key !== key) throw new Error("El resultado del guardado anterior está pendiente. Reintenta los mismos datos antes de cambiarlos.");
    pendingSave.current ||= { key, operationId: crypto.randomUUID(), uncertain: false };
    saving.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      await request(month, controller.signal, { ...action, operation_id: pendingSave.current.operationId });
      pendingSave.current = null;
      if (mounted.current) { setNotice("Cambio guardado con autor y fecha. Los registros originales se conservan."); await load(); }
    } catch (e) {
      if (pendingSave.current) {
        if (!pendingSave.current.uncertain && e instanceof StatisticsRequestError && e.definitive) pendingSave.current = null;
        else pendingSave.current.uncertain = true;
      }
      throw new Error(controller.signal.aborted ? "No se pudo confirmar el guardado. Reintenta con los mismos datos para evitar duplicados." : e instanceof Error ? e.message : "No se pudo confirmar el cambio.");
    } finally { clearTimeout(timer); saving.current = false; }
  }

  return <div className={styles.panel}>
    {error && <div className={styles.error} role="alert">{error} <button className={styles.button} disabled={loading} onClick={() => void load()}>Reintentar</button></div>}
    {notice && <div className={styles.success} role="status">{notice}</div>}
    {data?.month === month ? <CentralStatisticsView data={data} loading={loading} updated={updated} onRefresh={() => void load()} onSave={save} /> : <section className={styles.section}><h2>Estadísticas de centrales</h2><p className={styles.loading} role="status">{loading ? "Consultando el progreso y las jornadas…" : "No hay datos cargados para este mes."}</p></section>}
  </div>;
}

export function CentralStatisticsView({ data, loading = false, updated = "", onRefresh, onSave }: { data: CentralStatisticsResponse; loading?: boolean; updated?: string; onRefresh: () => void; onSave: Save }) {
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<"progress" | "hours" | "settings">("progress");
  const selected = data.workers.find(w => w.id === selectedId) || data.workers.find(w => w.role === "central" && w.is_active) || data.workers[0];
  const notices = [...new Set([...data.coverage, ...(selected?.coverage || [])])];

  return <>
    <header className={styles.hero}><div><div className={styles.eyebrow}><Users size={15} /> Equipo · seguimiento mensual</div><h2>Estadísticas de centrales</h2><p>El trabajo de cada persona, sus resultados y el tiempo que dedica.</p></div><div className={styles.heroActions}><button className={`${styles.button} ${styles.primary}`} disabled={loading} onClick={onRefresh}><RefreshCw size={15} />{loading ? "Actualizando…" : "Actualizar"}</button><span className={styles.stamp}>{updated ? `Última consulta · ${updated}` : "Datos del periodo seleccionado"}</span></div></header>
    <div className={styles.period}><CalendarDays size={16} /><strong>{data.month}</strong><span>{data.period.is_partial ? "Mes en curso · comparación al mismo corte" : "Mes completo"}</span><span className={styles.badge}>Hora de Ecuador</span></div>
    <div className={styles.info}><Info size={16} /><div><p><strong>Periodo actual:</strong> {data.period.label}</p><p><strong>Comparación:</strong> {data.period.previous_label}</p></div></div>

    <section className={styles.section} aria-label="Resumen por persona"><div className={styles.sectionTitle}><h3>Tu equipo, de un vistazo</h3><small>Selecciona una persona para ver el detalle</small></div><div className={styles.scroll}><table className={styles.table}><thead><tr><th scope="col">Persona</th><th scope="col" className={styles.num}>Captaciones</th><th scope="col" className={styles.num}>Recuperaciones</th><th scope="col" className={styles.num}>Cobros</th><th scope="col" className={styles.num}>Importe</th><th scope="col" className={styles.num}>Conexión registrada</th></tr></thead><tbody>{data.workers.map(w => <tr key={w.id} className={selected?.id === w.id ? styles.activeRow : undefined}><td><button className={styles.personButton} aria-pressed={selected?.id === w.id} onClick={() => setSelectedId(w.id)}><span className={styles.avatar} aria-hidden="true">{initials(w.display_name)}</span><span><span className={styles.name}>{w.display_name}</span><span className={styles.role}>{labelRole(w.role)}{w.is_active ? "" : " · Inactiva"}</span></span></button></td><td className={styles.num}>{formatMetric(w.metrics.captures_confirmed.current)}</td><td className={styles.num}>{formatMetric(w.metrics.recoveries.current)}</td><td className={styles.num}>{formatMetric(w.metrics.payments_count.current)}</td><td className={styles.num}>{formatMetric(w.metrics.payments_amount.current, "money")}</td><td className={styles.num}>{hours(w.hours.worked_minutes)}</td></tr>)}</tbody></table></div>{data.workers.length === 0 && <p className={styles.empty}>Todavía no hay centrales ni administradores disponibles.</p>}<p>Web automática: <strong>{euro(data.totals.web_payments_amount)}</strong> en {number(data.totals.web_payments_count)} cobros. Sin autor identificado: {euro(data.totals.unattributed_payments_amount)}. Se muestran aparte.</p></section>

    {selected && <div className={styles.selected}>
      <section className={styles.person}><div className={styles.personIdentity}><span className={styles.avatar} aria-hidden="true">{initials(selected.display_name)}</span><div><h3>{selected.display_name}</h3><p>{labelRole(selected.role)} · detalle de {data.month}</p></div></div><div className={styles.xp}><div className={styles.xpLabel}><strong>Nivel {selected.xp.level}</strong><span>{number(selected.xp.total)} XP acumulado al cierre del periodo</span></div><progress max={100} value={Math.min(100, Math.max(0, selected.xp.progress_percent))} aria-label="Progreso hacia el siguiente nivel" /><span className={styles.muted}>{selected.xp.next_level_xp == null ? "Nivel máximo configurado" : `Siguiente nivel: ${number(selected.xp.next_level_xp)} XP`}</span></div></section>
      <nav className={styles.tabs} aria-label="Detalle de la central"><button className={styles.tab} aria-pressed={view === "progress"} onClick={() => setView("progress")}><TrendingUp size={15} />Progreso</button><button className={styles.tab} aria-pressed={view === "hours"} onClick={() => setView("hours")}><Clock3 size={15} />Jornada y extras</button><button className={styles.tab} aria-pressed={view === "settings"} onClick={() => setView("settings")}><Settings2 size={15} />Horario y revisión</button></nav>

      {view === "progress" && <>
        <div className={styles.cards}><MetricCard title="Captaciones confirmadas" icon={<Users size={23} />} metric={selected.metrics.captures_confirmed} note="Mérito de la primera gestión" /><MetricCard title="Recuperaciones" icon={<RefreshCw size={23} />} metric={selected.metrics.recoveries} note="Clientes recuperados confirmados" /><MetricCard title="Importe cobrado" icon={<Wallet size={23} />} metric={selected.metrics.payments_amount} kind="money" note={`${formatMetric(selected.metrics.payments_count.current)} cobros realizados`} /><MetricCard title="XP ganado en el periodo" icon={<Sparkles size={23} />} metric={selected.metrics.xp_earned} note="Experiencia aplicada" /></div>
        <section className={styles.section}><div className={styles.sectionTitle}><h3>Actividad y evolución</h3><span className={styles.muted}>La variación describe cada métrica, no una valoración personal</span></div><div className={styles.scroll}><table className={styles.table}><thead><tr><th scope="col">Indicador</th><th scope="col" className={styles.num}>Este periodo</th><th scope="col" className={styles.num}>Anterior comparable</th><th scope="col" className={styles.num}>Cambio</th></tr></thead><tbody>{metricRows.map(row => <tr key={row.key}><th scope="row"><span className={styles.metricGroup}>{row.label}</span><span className={styles.metricDescription}>{row.help}</span></th><td className={styles.num}>{formatMetric(selected.metrics[row.key].current, row.kind)}</td><td className={styles.num}>{formatMetric(selected.metrics[row.key].previous, row.kind)}</td><td className={styles.num}><Delta value={selected.metrics[row.key]} lowerIsBetter={row.lowerIsBetter} /></td></tr>)}</tbody></table></div></section>
      </>}

      {view === "hours" && <HoursDetail worker={selected} month={data.month} />}
      {view === "settings" && <ScheduleEditor key={`${selected.id}:${selected.config.version_id || "new"}:${data.month}`} worker={selected} month={data.month} onSave={onSave} />}
    </div>}

    {notices.length > 0 && <section className={styles.section}><div className={styles.sectionTitle}><h3>Cobertura de los registros</h3><ShieldCheck size={18} /></div><ul className={styles.warningList}>{notices.map(note => <li key={note}>{note}</li>)}</ul></section>}
    <details className={`${styles.section} ${styles.definitions}`}><summary>Cómo se cuentan los resultados</summary><dl><dt>Primera gestión y captación</dt><dd>El mérito sigue la asignación confirmada de la primera gestión válida. Reasignar un lead o hacer un seguimiento posterior no mueve el XP ya atribuido.</dd><dt>Cobros y llamadas</dt><dd>Cada pago confirmado se cuenta una vez. Una llamada enlazada con ese pago no añade un segundo ingreso. Los pagos automáticos de la web no se reparten entre las personas conectadas.</dd><dt>Comparación mensual</dt><dd>Un mes abierto se compara hasta el mismo día y hora de Ecuador del mes anterior. Si no existe un registro comparable se muestra “Sin base comparable”; un mes sin datos no se convierte en cero.</dd><dt>Jornada y remuneración</dt><dd>La conexión al panel es un registro operativo. Las llamadas, incidencias y tareas fuera del navegador pueden requerir correcciones justificadas. Los importes de extras son estimaciones revisables y no generan un pago ni un descuento.</dd></dl></details>
  </>;
}

function formatMetric(value: number | null, kind?: "money" | "minutes") { return value == null ? "Sin registro" : kind === "money" ? euro(value) : kind === "minutes" ? hours(value) : number(value); }
function MetricCard({ title, icon, metric, note, kind }: { title: string; icon: React.ReactNode; metric: CentralMetric; note: string; kind?: "money" }) {
  return <article className={styles.metric}><div className={styles.metricIcon}>{icon}</div><span className={styles.metricLabel}>{title}</span><strong className={styles.metricValue}>{formatMetric(metric.current, kind)}</strong><Delta value={metric} /><span className={styles.metricNote}>{note}</span></article>;
}

function exportHours(worker: CentralWorkerStatistics, month: string) {
  const rows = [["Fecha Ecuador", "Minutos registrados", "Minutos en turno", "Minutos fuera de turno", "Minutos por clasificar", "Correcciones minutos", "Cobros", "Importe EUR"], ...worker.day_breakdown.map(d => [d.date, d.minutes, d.ordinary_minutes, d.outside_schedule_minutes, d.unclassified_minutes, d.adjustment_minutes, d.payments_count, d.payments_amount])];
  const csv = "\uFEFF" + rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = `jornada-${worker.id}-${month}.csv`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HoursDetail({ worker, month }: { worker: CentralWorkerStatistics; month: string }) {
  const h = worker.hours;
  const maxMinutes = Math.max(60, ...worker.day_breakdown.map(d => d.minutes));
  return <>
    <div className={styles.cards}>{[
      ["Conexión registrada", hours(h.worked_minutes), "Sesiones limitadas por actividad"],
      ["Dentro del horario", hours(h.ordinary_minutes), "Intersección con el horario vigente"],
      ["Fuera del horario", hours(h.outside_schedule_minutes), "Tiempo pendiente de clasificación laboral"],
      ["Estimación de extras", h.extra_amount == null ? "Por revisar" : euro(h.extra_amount), h.extra_amount == null ? "Sin tarifa validada" : "Estimación; no es una liquidación"],
    ].map(([title, value, note]) => <article key={title} className={styles.metric}><Clock3 className={styles.metricIcon} size={22} /><span className={styles.metricLabel}>{title}</span><strong className={styles.metricValue}>{value}</strong><span className={styles.metricNote}>{note}</span></article>)}</div>
    <div className={styles.info}><Info size={16} /><div><p>{h.coverage_start ? `Seguimiento de actividad disponible desde ${shortDate(ecuadorDate(new Date(h.coverage_start)))}. ` : "Todavía no hay sesiones con el nuevo seguimiento. "}La presencia anterior no demuestra actividad humana ni permite reconstruir extras exactas.</p><p>Sin horario clasificable: {hours(h.unclassified_minutes)}. Correcciones: {h.adjustment_minutes >= 0 ? "+" : "−"}{hours(h.adjustment_minutes)}. Descansos: fuera del tiempo de trabajo registrado.</p></div></div>
    {h.pending_weekend_days.length > 0 && <div className={styles.info}><CalendarDays size={16} /><p>Hay conexión en fines de semana sin turno elegido: {h.pending_weekend_days.map(shortDate).join(", ")}. Esas horas quedan por clasificar.</p></div>}
    <section className={styles.section}><div className={styles.sectionTitle}><div><h3>Jornada por día</h3><p>Duración en el panel y cobros atribuidos a {worker.display_name}.</p></div><button className={styles.button} disabled={!worker.day_breakdown.length} onClick={() => exportHours(worker, month)}><Download size={15} />Exportar CSV</button></div>
      {worker.day_breakdown.length > 0 ? <><div className={styles.chart} role="img" aria-label="Minutos de conexión por día. Valores detallados en la tabla siguiente.">{worker.day_breakdown.map(d => <div key={d.date} className={styles.barGroup} title={`${shortDate(d.date)}: ${hours(d.minutes)}`}><div className={styles.bar} style={{ height: `${Math.max(0, d.minutes) / maxMinutes * 100}%` }} /></div>)}</div><div className={styles.chartLegend}><span>{shortDate(worker.day_breakdown[0].date)}</span><span>Escala máxima: {hours(maxMinutes)}</span><span>{shortDate(worker.day_breakdown[worker.day_breakdown.length - 1].date)}</span></div><div className={styles.scroll}><table className={styles.table}><thead><tr><th scope="col">Día</th><th scope="col" className={styles.num}>Conexión</th><th scope="col" className={styles.num}>En turno</th><th scope="col" className={styles.num}>Fuera de turno</th><th scope="col" className={styles.num}>Por clasificar</th><th scope="col" className={styles.num}>Cobros</th><th scope="col" className={styles.num}>Importe</th></tr></thead><tbody>{worker.day_breakdown.map(d => <tr key={d.date}><th scope="row">{shortDate(d.date)}</th><td className={styles.num}>{hours(d.minutes)}</td><td className={styles.num}>{hours(d.ordinary_minutes)}</td><td className={styles.num}>{hours(d.outside_schedule_minutes)}</td><td className={styles.num}>{hours(d.unclassified_minutes)}</td><td className={styles.num}>{number(d.payments_count)}</td><td className={styles.num}>{euro(d.payments_amount)}</td></tr>)}</tbody></table></div></> : <p className={styles.empty}>Aún no hay jornadas registradas con el nuevo control en este periodo.</p>}
    </section>
    {worker.adjustments.length > 0 && <section className={styles.section}><h3>Correcciones registradas</h3><div className={styles.scroll}><table className={styles.table}><thead><tr><th scope="col">Día</th><th scope="col">Clasificación</th><th scope="col">Minutos</th><th scope="col">Motivo</th><th scope="col">Registro</th></tr></thead><tbody>{worker.adjustments.map(a => <tr key={a.id}><td>{shortDate(a.date)}</td><td>{a.category === "ordinary" ? "Dentro del horario" : "Fuera del horario"}</td><td>{a.minutes > 0 ? "+" : ""}{number(a.minutes)}</td><td>{a.reason}</td><td>{new Date(a.created_at).toLocaleString("es-ES", { timeZone: "America/Guayaquil" })}</td></tr>)}</tbody></table></div></section>}
  </>;
}

function weekendGroups(month: string) {
  const start = new Date(`${month}-01T12:00:00Z`);
  if (!Number.isFinite(start.getTime())) return [];
  const groups = new Map<string, string[]>();
  for (let n = 1; n <= 31; n++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), n, 12));
    if (d.getUTCMonth() !== start.getUTCMonth()) break;
    if (![0, 6].includes(d.getUTCDay())) continue;
    const key = new Date(d.getTime() - (d.getUTCDay() === 0 ? 1 : 0) * 86400000).toISOString().slice(0, 10);
    groups.set(key, [...(groups.get(key) || []), d.toISOString().slice(0, 10)]);
  }
  return [...groups.entries()];
}

function ScheduleEditor({ worker, month, onSave }: { worker: CentralWorkerStatistics; month: string; onSave: Save }) {
  const [salary, setSalary] = useState(String(worker.config.monthly_salary_eur));
  const [rate, setRate] = useState(worker.config.overtime_hourly_rate_eur == null ? "" : String(worker.config.overtime_hourly_rate_eur));
  const [start, setStart] = useState(worker.config.weekday_start?.slice(0, 5) || "");
  const [end, setEnd] = useState(worker.config.weekday_end?.slice(0, 5) || "");
  const [weekendStart, setWeekendStart] = useState(worker.config.weekend_start.slice(0, 5));
  const [weekendEnd, setWeekendEnd] = useState(worker.config.weekend_end.slice(0, 5));
  const [days, setDays] = useState(worker.weekend_days);
  const today = ecuadorDate();
  const [planningMonth, setPlanningMonth] = useState(month < today.slice(0, 7) ? today.slice(0, 7) : month);
  const maxPlanningMonth = `${Number(today.slice(0, 4)) + 1}${today.slice(4, 7)}`;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [adjustDate, setAdjustDate] = useState(ecuadorDate());
  const [adjustMinutes, setAdjustMinutes] = useState("");
  const [adjustCategory, setAdjustCategory] = useState<"ordinary" | "outside_schedule">("outside_schedule");
  const [reason, setReason] = useState("");
  async function submit(name: string, action: SaveAction) {
    if (busy) return;
    setBusy(name); setError("");
    try { await onSave({ ...action, worker_id: worker.id }); if (name === "adjustment") { setAdjustMinutes(""); setReason(""); } }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(""); }
  }
  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.section}><div className={styles.sectionTitle}><h3>Horario de {worker.display_name}</h3><span className={styles.badge}>Ecuador · UTC−5</span></div><p>Los cambios crean una versión desde el momento del guardado. El horario de las jornadas anteriores se conserva.</p><form className={styles.form} onSubmit={e => { e.preventDefault(); void submit("settings", { action: "settings", monthly_salary_eur: Number(salary), overtime_hourly_rate_eur: rate.trim() ? Number(rate) : null, weekday_start: start || null, weekday_end: end || null, weekend_start: weekendStart, weekend_end: weekendEnd }); }}><fieldset disabled={!!busy}><div className={styles.fields}><label className={styles.field}>Sueldo mensual de referencia (€)<input type="number" min="0" max="100000" step="0.01" value={salary} onChange={e => setSalary(e.target.value)} required /></label><label className={styles.field}>Tarifa revisada para estimación de extras (€/h)<input type="number" min="0" max="1000" step="0.0001" value={rate} onChange={e => setRate(e.target.value)} placeholder="Pendiente de validar" /></label><label className={styles.field}>Lunes a viernes · entrada<input type="time" value={start} onChange={e => setStart(e.target.value)} required={!!end} /></label><label className={styles.field}>Lunes a viernes · salida<input type="time" value={end} onChange={e => setEnd(e.target.value)} required={!!start} /></label><label className={styles.field}>Día elegido del fin de semana · entrada<input type="time" value={weekendStart} onChange={e => setWeekendStart(e.target.value)} required /></label><label className={styles.field}>Día elegido del fin de semana · salida<input type="time" value={weekendEnd} onChange={e => setWeekendEnd(e.target.value)} required /></label></div></fieldset><div className={styles.info}><Info size={16} /><p>La jornada laboral y los recargos requieren revisión del contrato. “Fuera del horario” no equivale por sí solo a una categoría legal de horas extras. Puedes dejar la tarifa vacía mientras se valida.</p></div><div className={styles.formActions}><button className={styles.button} type="button" disabled={!!busy} onClick={() => { setStart("07:00"); setEnd("15:00"); }}>Cargar horario de mañana · 07:00–15:00</button><button className={`${styles.button} ${styles.primary}`} disabled={!!busy}>{busy === "settings" ? "Guardando…" : "Guardar nueva versión del horario"}</button></div></form></section>

    <section className={styles.section}><h3>Planificar fines de semana</h3><label className={styles.field}>Mes del calendario<input type="month" min={today.slice(0, 7)} max={maxPlanningMonth} value={planningMonth} disabled={!!busy} onChange={e => { if (e.target.value) setPlanningMonth(e.target.value); }} /></label><p>Elige un solo día de trabajo por semana. La franja será {weekendStart}–{weekendEnd} de Ecuador. Los días pasados se conservan; un fin de semana pendiente no se trata automáticamente como descanso ni como extra.</p><form className={styles.form} onSubmit={e => { e.preventDefault(); void submit("weekends", { action: "weekends", month: planningMonth, days: days.filter(d => d.startsWith(planningMonth) && d > today) }); }}><div className={styles.calendar}>{weekendGroups(planningMonth).map(([key, pair]) => <fieldset key={key} className={styles.week} disabled={!!busy}><legend>Fin de semana del {shortDate(key)}</legend>{pair.map(day => <label key={day}><input type="checkbox" checked={days.includes(day)} disabled={day <= today} onChange={e => setDays(current => e.target.checked ? [...current.filter(d => !pair.includes(d)), day] : current.filter(d => d !== day))} />{new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}{day <= today ? " · cerrado" : ""}</label>)}</fieldset>)}</div><div className={styles.formActions}><button className={`${styles.button} ${styles.primary}`} disabled={!!busy || planningMonth < today.slice(0, 7) || planningMonth > maxPlanningMonth}>{busy === "weekends" ? "Guardando…" : "Guardar próximos fines de semana"}</button></div></form></section>

    <details className={`${styles.section} ${styles.editor}`}><summary>Registrar una corrección de jornada</summary><p>Para una llamada, corte de conexión o trabajo acreditado fuera del navegador. La corrección queda separada de las sesiones originales, con motivo, autor y fecha.</p><form className={styles.form} onSubmit={e => { e.preventDefault(); void submit("adjustment", { action: "adjustment", date: adjustDate, minutes: Number(adjustMinutes), category: adjustCategory, reason: reason.trim() }); }}><fieldset disabled={!!busy}><div className={styles.fields}><label className={styles.field}>Fecha de Ecuador<input type="date" max={today} min={worker.hours.coverage_start ? ecuadorDate(new Date(worker.hours.coverage_start)) : undefined} value={adjustDate} onChange={e => setAdjustDate(e.target.value)} required /></label><label className={styles.field}>Minutos que se añaden o se restan<input type="number" min="-1440" max="1440" step="1" value={adjustMinutes} onChange={e => setAdjustMinutes(e.target.value)} placeholder="Ej. 30 o -15" required /></label><label className={styles.field}>Clasificación operativa<select value={adjustCategory} onChange={e => setAdjustCategory(e.target.value as "ordinary" | "outside_schedule")}><option value="ordinary">Dentro del horario</option><option value="outside_schedule">Fuera del horario</option></select></label><label className={styles.field}>Motivo verificable<textarea minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Indica qué ocurrió y cómo se comprobó el tiempo." required /></label></div></fieldset><div className={styles.formActions}><button className={`${styles.button} ${styles.primary}`} disabled={!!busy || !worker.hours.coverage_start || !Number(adjustMinutes)}>{busy === "adjustment" ? "Guardando…" : "Registrar corrección auditada"}</button></div></form></details>
  </>;
}
