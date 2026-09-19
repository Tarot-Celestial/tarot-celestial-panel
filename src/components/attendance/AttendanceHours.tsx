'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { classifyDay, dateKey, hoursLabel, type Schedule } from '@/lib/attendance/hours';
import styles from './AttendanceHours.module.css';

type Row = ReturnType<typeof classifyDay> & { worker_id: string; display_name: string; has_schedule: boolean };
type Disconnect = {
  worker_id: string;
  display_name: string;
  day: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  ongoing: boolean;
  reason: string;
  justification: 'justified' | 'unjustified' | 'pending';
};
type Report = { rows: Row[]; schedules: Schedule[]; disconnects?: Disconnect[] };

const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const dateFormatter = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' });
const timeFormatter = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });

async function request(url: string, body?: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Inicia sesión de nuevo.');
  const response = await fetch(url, {
    cache: 'no-store',
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}

function Review({ row, save, busy }: { row: Row; save: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [justified, setJustified] = useState(row.justified_minutes);
  const [unjustified, setUnjustified] = useState(row.unjustified_minutes);
  const [note, setNote] = useState(row.note);
  return <form className={styles.form} onSubmit={e => { e.preventDefault(); void save({ action: 'review', worker_id: row.worker_id, day: row.day, justified_minutes: justified, unjustified_minutes: unjustified, note, missing_minutes: row.missing_minutes, schedule_signature: row.schedule_signature }); }}>
    <div className={styles.pair}><label>Minutos justificados<input required type="number" min="0" max={row.missing_minutes} value={justified} onChange={e => setJustified(Number(e.target.value))} /></label><label>Minutos no justificados<input required type="number" min="0" max={row.missing_minutes} value={unjustified} onChange={e => setUnjustified(Number(e.target.value))} /></label></div>
    <label>Motivo / situación<textarea required maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
    <span className={styles.muted}>Sin clasificar: {hoursLabel(Math.max(0, row.missing_minutes - justified - unjustified))}. Sin descuento económico.</span>
    <button disabled={busy || justified + unjustified > row.missing_minutes}>{busy ? 'Guardando…' : 'Guardar revisión'}</button>
  </form>;
}

function ScheduleForm({ schedule: s, save, busy }: { schedule: Schedule; save: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  return <form className={styles.form} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save({ action: 'schedule', schedule_id: s.id, worker_id: s.worker_id, day_of_week: Number(data.get('day')), start_time: data.get('start'), end_time: data.get('end'), timezone: data.get('timezone') }); }}>
    <label>Día<select name="day" defaultValue={s.day_of_week}>{days.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
    <div className={styles.pair}><label>Entrada<input name="start" type="time" required defaultValue={s.start_time.slice(0, 5)} /></label><label>Salida<input name="end" type="time" required defaultValue={s.end_time.slice(0, 5)} /></label></div>
    <label>Zona horaria<input name="timezone" required defaultValue={s.timezone || 'Europe/Madrid'} /></label>
    <button disabled={busy}>Guardar horario</button>
  </form>;
}

function dayHeading(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const label = dateFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function timeLabel(value: string | null) {
  return value ? timeFormatter.format(new Date(value)) : 'Ahora';
}

function durationLabel(item: Disconnect, now: number) {
  if (!item.ongoing) return `${item.duration_minutes} min`;
  const minutes = Math.max(1, Math.round((now - Date.parse(item.started_at)) / 60000));
  return `${minutes} min · Desconexión en curso`;
}

function statusCopy(status: Disconnect['justification']) {
  if (status === 'justified') return { label: 'Justificada', tone: 'justified' };
  if (status === 'unjustified') return { label: 'No justificada', tone: 'unjustified' };
  return { label: 'Pendiente de revisión', tone: 'pending' };
}

export default function AttendanceHours({ month, workerId, readOnly = false }: { month?: string; workerId?: string; readOnly?: boolean }) {
  const [day, setDay] = useState(dateKey);
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const generation = useRef(0), savingRef = useRef(false);
  const path = `/api/attendance/hours?${readOnly && month ? `month=${encodeURIComponent(month)}` : `day=${day}`}${workerId ? `&worker_id=${encodeURIComponent(workerId)}` : ''}`;

  const reload = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    try {
      const data = await request(path);
      if (version === generation.current) { setReport(data); setError(''); }
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setReport(null); void reload();
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { generation.current++; window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [reload]);

  useEffect(() => {
    if (!readOnly || !(report?.disconnects || []).some(item => item.ongoing)) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [readOnly, report?.disconnects]);

  async function save(body: Record<string, unknown>) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setMessage('');
    try { await request('/api/attendance/hours', body); setMessage('Guardado. Asistencia y el informe de la factura usan estos mismos datos.'); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { savingRef.current = false; setSaving(false); }
  }

  const rows = (report?.rows || []).filter(r => String(r.display_name).toLowerCase().includes(query.toLowerCase()));
  const sum = (field: 'scheduled_minutes' | 'worked_minutes' | 'missing_minutes' | 'justified_minutes' | 'unjustified_minutes' | 'pending_minutes') => rows.reduce((n, r) => n + r[field], 0);
  const disconnects = report?.disconnects || [];
  const groupedDisconnects = disconnects.reduce<Record<string, Disconnect[]>>((groups, item) => {
    (groups[item.day] ||= []).push(item);
    return groups;
  }, {});

  return <section className={styles.shell} aria-busy={loading || saving}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>Asistencia · control de horas</span>
        <h2>{readOnly ? 'Desconexiones del periodo' : 'Incidencias y horarios'}</h2>
        <p className={styles.muted}>{readOnly ? 'Consulta cuándo estuviste desconectada, durante cuánto tiempo y el estado de revisión.' : 'Información de asistencia. No modifica el importe de la factura.'}</p>
      </div>
      <button onClick={() => void reload()} disabled={loading || saving}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
    </header>

    {!readOnly && <div className={styles.toolbar}><label>Fecha · España peninsular<input type="date" value={day} max={dateKey()} disabled={saving} onChange={e => { if (e.target.value) setDay(e.target.value); }} /></label><label>Buscar tarotista<input type="search" placeholder="Nombre de la tarotista" value={query} onChange={e => setQuery(e.target.value)} /></label></div>}
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {message && <p role="status" className={styles.notice}>{message}</p>}

    {report && readOnly && (
      <div className={styles.disconnectView}>
        {!disconnects.length ? (
          <div className={styles.cleanState}>
            <div className={styles.cleanIcon}>✓</div>
            <div><strong>Sin desconexiones registradas</strong><p>No tienes ausencias registradas durante este periodo.</p></div>
          </div>
        ) : Object.keys(groupedDisconnects).sort((a, b) => b.localeCompare(a)).map(groupDay => (
          <section className={styles.dayGroup} key={groupDay}>
            <div className={styles.dayHeading}><span>{dayHeading(groupDay)}</span><small>{groupedDisconnects[groupDay].length} {groupedDisconnects[groupDay].length === 1 ? 'desconexión' : 'desconexiones'}</small></div>
            <div className={styles.disconnectList}>
              {groupedDisconnects[groupDay].map((item, index) => {
                const status = statusCopy(item.justification);
                return <article className={styles.disconnectCard} key={`${item.started_at}:${index}`}>
                  <div className={styles.disconnectMain}>
                    <div className={styles.timeRange}><strong>{timeLabel(item.started_at)} → {timeLabel(item.ended_at)}</strong><span>{durationLabel(item, nowTick)}</span></div>
                    <span className={styles.statusBadge} data-tone={status.tone}>{status.label}</span>
                  </div>
                  <div className={styles.reasonBlock}><span>Motivo</span><strong>{item.reason || 'Sin motivo indicado'}</strong></div>
                </article>;
              })}
            </div>
          </section>
        ))}
      </div>
    )}

    {report && !readOnly && <>
      <div className={styles.summary}>{([['Horario programado', 'scheduled_minutes'], ['Trabajo registrado', 'worked_minutes'], ['Justificadas', 'justified_minutes'], ['No justificadas', 'unjustified_minutes']] as const).map(([label, field]) => <div className={styles.metric} key={field}><span>{label}</span><strong>{hoursLabel(sum(field))}</strong></div>)}</div>
      <p className={styles.muted}>Sin trabajo registrado en horario transcurrido: <b>{hoursLabel(sum('missing_minutes'))}</b> · Pendiente de revisión: <b>{hoursLabel(sum('pending_minutes'))}</b>. Se usa el horario vigente de Asistencia. Las desconexiones no se clasifican automáticamente como ausencias.</p>
      <div className={styles.grid}>{rows.map(row => <article className={styles.card} key={row.worker_id}>
        <h3>{row.display_name}</h3><span className={styles.badge}>{!row.has_schedule ? 'Sin horario configurado' : row.needs_review ? 'Horario o asistencia modificados · Revisar' : row.pending_minutes ? 'Pendiente de revisión' : 'Al día'}</span>
        <dl><dt>Horario completo</dt><dd>{hoursLabel(row.scheduled_minutes)}</dd><dt>Trabajo dentro del horario</dt><dd>{hoursLabel(row.in_shift_minutes)}</dd><dt>Sin trabajo registrado</dt><dd>{hoursLabel(row.missing_minutes)}</dd><dt>Justificadas</dt><dd>{hoursLabel(row.justified_minutes)}</dd><dt>No justificadas</dt><dd>{hoursLabel(row.unjustified_minutes)}</dd></dl>
        {row.note && <p className={styles.muted}>{row.note}</p>}
        <details><summary>Revisar horas y motivo</summary><Review key={`${row.day}:${row.reviewed_at}:${row.missing_minutes}`} row={row} save={save} busy={saving || loading} /></details>
        <details><summary>Horario conectado con Asistencia</summary><p className={styles.notice}>Cambiar el horario vigente recalcula también periodos anteriores. Revisa las clasificaciones afectadas.</p>{report.schedules.filter(s => s.worker_id === row.worker_id).map(s => <ScheduleForm key={`${s.id}:${s.start_time}:${s.end_time}:${s.day_of_week}:${s.timezone}`} schedule={s} save={save} busy={saving || loading} />)}{!row.has_schedule && <p className={styles.muted}>Configura primero su horario en Administración → Asistencia.</p>}</details>
      </article>)}</div>
      {!rows.length && <p className={styles.muted}>No hay tarotistas para esta selección.</p>}
    </>}
  </section>;
}
