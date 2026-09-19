import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/server/auth-cliente';
import { addDay, calculateDay, classifyDay, hoursLabel, localTime, monthDays, REPORT_TZ, validDay, type AttendanceEvent, type Schedule } from '@/lib/attendance/hours';


type AttendanceDisconnect = {
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

function scheduleIntervalsForDay(day: string, schedules: Schedule[]) {
  const start = localTime(day, '00:00', REPORT_TZ);
  const end = localTime(addDay(day), '00:00', REPORT_TZ);
  const intervals: Array<[number, number]> = [];
  for (let offset = -2; offset <= 1; offset++) {
    const sourceDay = addDay(day, offset);
    const dow = new Date(`${sourceDay}T12:00:00Z`).getUTCDay();
    for (const schedule of schedules.filter(item => item.active && Number(item.day_of_week) === dow)) {
      const timezone = schedule.timezone || REPORT_TZ;
      const a = localTime(sourceDay, schedule.start_time, timezone);
      const b = localTime(schedule.end_time <= schedule.start_time ? addDay(sourceDay) : sourceDay, schedule.end_time, timezone);
      if (b > start && a < end) intervals.push([Math.max(a, start), Math.min(b, end)]);
    }
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}

function dayReviewStatus(row: ReturnType<typeof classifyDay>): AttendanceDisconnect['justification'] {
  if (row.needs_review || row.pending_minutes > 0) return 'pending';
  if (row.unjustified_minutes > 0 && row.justified_minutes === 0) return 'unjustified';
  if (row.justified_minutes > 0 && row.unjustified_minutes === 0) return 'justified';
  // A mixed daily review cannot be assigned safely to a specific disconnect interval.
  return 'pending';
}

function buildDisconnects(
  workers: Array<{ id: string; display_name: string }>,
  schedules: Schedule[],
  events: AttendanceEvent[],
  rows: Array<ReturnType<typeof classifyDay> & { worker_id: string; display_name: string }>,
  from: string,
  to: string,
  now = Date.now(),
): AttendanceDisconnect[] {
  const result: AttendanceDisconnect[] = [];
  const reportStart = localTime(from, '00:00', REPORT_TZ);
  const reportEnd = Math.min(now, localTime(addDay(to), '00:00', REPORT_TZ));

  for (const worker of workers) {
    const workerEvents = events
      .filter(event => event.worker_id === worker.id)
      .slice()
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    let offlineStart: number | null = null;
    let offlineMeta: Record<string, any> = {};
    const rawIntervals: Array<{ start: number; end: number; ongoing: boolean; meta: Record<string, any> }> = [];

    for (const event of workerEvents) {
      const at = Date.parse(event.at);
      if (!Number.isFinite(at)) continue;
      if (event.event_type === 'offline') {
        if (offlineStart == null) {
          offlineStart = at;
          offlineMeta = (event.meta || {}) as Record<string, any>;
        }
        continue;
      }
      if (offlineStart != null && (event.event_type === 'online' || event.event_type === 'heartbeat')) {
        if (at > offlineStart) rawIntervals.push({ start: offlineStart, end: at, ongoing: false, meta: offlineMeta });
        offlineStart = null;
        offlineMeta = {};
      }
    }

    if (offlineStart != null && offlineStart < reportEnd) {
      rawIntervals.push({ start: offlineStart, end: reportEnd, ongoing: reportEnd === now, meta: offlineMeta });
    }

    const workerSchedules = schedules.filter(schedule => schedule.worker_id === worker.id);
    for (let day = from; day <= to; day = addDay(day)) {
      const dayRow = rows.find(row => row.worker_id === worker.id && row.day === day);
      if (!dayRow) continue;
      const reviewStatus = dayReviewStatus(dayRow);
      const reviewReason = String(dayRow.note || '').trim();
      const daySchedules = scheduleIntervalsForDay(day, workerSchedules);
      if (!daySchedules.length) continue;

      for (const raw of rawIntervals) {
        for (const [shiftStart, shiftEnd] of daySchedules) {
          const start = Math.max(raw.start, shiftStart, reportStart);
          const end = Math.min(raw.end, shiftEnd, reportEnd);
          if (end <= start) continue;
          const rawReason = String(raw.meta?.reason || raw.meta?.motivo || raw.meta?.note || '').trim();
          result.push({
            worker_id: worker.id,
            display_name: worker.display_name,
            day,
            started_at: new Date(start).toISOString(),
            ended_at: raw.ongoing && end === reportEnd ? null : new Date(end).toISOString(),
            duration_minutes: Math.max(1, Math.round((end - start) / 60000)),
            ongoing: raw.ongoing && end === reportEnd,
            reason: reviewReason || rawReason || 'Sin motivo indicado',
            justification: reviewStatus,
          });
        }
      }
    }
  }

  return result.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

export async function attendanceAccess(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { response: Response.json({ error: 'Inicia sesión de nuevo.' }, { status: 401 }) };
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { response: Response.json({ error: 'Sesión no válida.' }, { status: 401 }) };
  const result = await db.from('workers').select('id, role, is_active').eq('user_id', data.user.id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_active === false || !['admin', 'central', 'tarotista'].includes(result.data.role)) return { response: Response.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { db, worker: result.data };
}
export async function attendanceReport(db: SupabaseClient, from: string, to: string, workerId?: string, allRoles = false) {
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw new Error('Selecciona un intervalo de hasta 31 días.');
  let query = db.from('workers').select('id, display_name, role, team, is_active');
  if (workerId) query = query.eq('id', workerId);
  else query = query.or('is_active.is.null,is_active.eq.true');
  if (!allRoles) query = query.eq('role', 'tarotista');
  const workers = await query;
  if (workers.error) throw workers.error;
  const ids = (workers.data || []).map(w => w.id);
  if (!ids.length) return { rows: [], schedules: [] as Schedule[], workers: workers.data || [] };
  const [schedulesResult, reviewsResult] = await Promise.all([
    db.from('shift_schedules').select('id, worker_id, day_of_week, start_time, end_time, timezone, active').in('worker_id', ids).eq('active', true),
    db.from('incidents').select('worker_id, meta').eq('kind', 'attendance_info').in('worker_id', ids).gte('month_key', from.slice(0, 7)).lte('month_key', to.slice(0, 7)).gte('meta->>day', from).lte('meta->>day', to),
  ]);
  if (schedulesResult.error) throw schedulesResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  const now = Date.now(), events: AttendanceEvent[] = [];
  // Read enough history to reconstruct an explicit offline interval that began before midnight during an overnight shift.
  const start = new Date(localTime(addDay(from, -2), '00:00', REPORT_TZ)).toISOString();
  const end = new Date(Math.min(now, localTime(addDay(to), '00:00', REPORT_TZ))).toISOString();
  if (start < end) {
    for (let offset = 0; ; offset += 1000) {
      const page = await db.from('attendance_events').select('worker_id, event_type, at, meta').in('worker_id', ids).gte('at', start).lt('at', end).order('at').order('id').range(offset, offset + 999);
      if (page.error) throw page.error;
      events.push(...(page.data || []));
      if ((page.data || []).length < 1000) break;
    }
  }
  const schedules = (schedulesResult.data || []) as Schedule[];
  const reviews = new Map((reviewsResult.data || []).map(r => [`${r.worker_id}:${r.meta?.day}`, r.meta]));
  const rows = [];
  for (const worker of workers.data || []) {
    const workerEvents = events.filter(e => e.worker_id === worker.id);
    const workerSchedules = schedules.filter(s => s.worker_id === worker.id);
    for (let day = from; day <= to; day = addDay(day)) {
      rows.push({ ...classifyDay(calculateDay(day, workerSchedules, workerEvents, now), reviews.get(`${worker.id}:${day}`)), worker_id: worker.id, display_name: worker.display_name, role: worker.role, team: worker.team, has_schedule: workerSchedules.length > 0 });
    }
  }
  const disconnects = buildDisconnects((workers.data || []) as Array<{ id: string; display_name: string }>, schedules, events, rows as Array<ReturnType<typeof classifyDay> & { worker_id: string; display_name: string }>, from, to, now);
  return { rows, schedules, workers: workers.data || [], disconnects };
}
export async function invoiceHoursNote(db: SupabaseClient, workerId: string, month: string) {
  const { from, to } = monthDays(month);
  const { rows } = await attendanceReport(db, from, to, workerId);
  if (!rows.length) return '';
  const sum = (key: 'scheduled_minutes' | 'worked_minutes' | 'missing_minutes' | 'justified_minutes' | 'unjustified_minutes' | 'pending_minutes') => rows.reduce((n, r) => n + r[key], 0);
  return `Asistencia informativa · sin efecto en el importe. Horario vigente (Europe/Madrid). Programadas: ${hoursLabel(sum('scheduled_minutes'))}. Trabajo registrado: ${hoursLabel(sum('worked_minutes'))}. Sin trabajo registrado en horario transcurrido: ${hoursLabel(sum('missing_minutes'))}. Justificadas: ${hoursLabel(sum('justified_minutes'))}. No justificadas: ${hoursLabel(sum('unjustified_minutes'))}. Pendientes de revisión: ${hoursLabel(sum('pending_minutes'))}. Las desconexiones requieren revisión; no se consideran automáticamente ausencias injustificadas.`;
}
