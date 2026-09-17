import { createHash } from 'node:crypto';
import { attendanceAccess, attendanceReport } from '@/lib/server/attendance-hours';
import { dateKey, monthDays, validDay } from '@/lib/attendance/hours';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req: Request) {
  try {
    const gate = await attendanceAccess(req);
    if (gate.response) return gate.response;
    const params = new URL(req.url).searchParams;
    const month = params.get('month');
    const range = month ? monthDays(month) : { from: params.get('day') || dateKey(), to: params.get('day') || dateKey() };
    const workerId = gate.worker.role === 'tarotista' ? gate.worker.id : params.get('worker_id') || undefined;
    const report = await attendanceReport(gate.db, range.from, range.to, workerId);
    return json({ ok: true, ...report });
  } catch (e) { console.error('[attendance:hours]', e); return json({ error: 'No se pudo cargar la asistencia. Comprueba el periodo y vuelve a intentarlo.' }, 500); }
}
export async function POST(req: Request) {
  try {
    const gate = await attendanceAccess(req);
    if (gate.response) return gate.response;
    if (!['admin', 'central'].includes(gate.worker.role)) return json({ error: 'Sin permiso para editar.' }, 403);
    const body = await req.json();
    const workerId = String(body.worker_id || '');
    const target = await gate.db.from('workers').select('id').eq('id', workerId).eq('role', 'tarotista').maybeSingle();
    if (target.error) throw target.error;
    if (!target.data) return json({ error: 'Tarotista no encontrada.' }, 404);
    if (body.action === 'schedule') {
      const dow = Number(body.day_of_week), start = String(body.start_time || ''), end = String(body.end_time || ''), timezone = String(body.timezone || 'Europe/Madrid');
      if (!Number.isInteger(dow) || dow < 0 || dow > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start === end) return json({ error: 'Revisa el día y las horas.' }, 400);
      try { new Intl.DateTimeFormat('es', { timeZone: timezone }).format(); } catch { return json({ error: 'Zona horaria no válida.' }, 400); }
      // Only edit an existing schedule: same source as Admin → Asistencia.
      const result = await gate.db.from('shift_schedules').update({ day_of_week: dow, start_time: start, end_time: end, timezone }).eq('id', String(body.schedule_id || '')).eq('worker_id', workerId).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return json({ error: 'El horario ya no existe. Recarga la vista.' }, 409);
      return json({ ok: true });
    }
    if (body.action !== 'review') return json({ error: 'Acción no válida.' }, 400);
    const day = String(body.day || ''), justified = Number(body.justified_minutes), unjustified = Number(body.unjustified_minutes), note = String(body.note || '').trim();
    if (!validDay(day) || day > dateKey() || !Number.isInteger(justified) || !Number.isInteger(unjustified) || justified < 0 || unjustified < 0 || !note || note.length > 2000) return json({ error: 'Indica una fecha válida, minutos positivos y el motivo (máximo 2000 caracteres).' }, 400);
    const { rows } = await attendanceReport(gate.db, day, day, workerId);
    const row = rows[0];
    if (!row || justified + unjustified > row.missing_minutes || body.schedule_signature !== row.schedule_signature || Number(body.missing_minutes) !== row.missing_minutes) return json({ error: 'La asistencia ha cambiado. Recarga antes de clasificar las horas.' }, 409);
    const hash = createHash('sha256').update(`attendance_info:${workerId}:${day}`).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const at = new Date().toISOString();
    // status=justified deliberately excludes this informational entry from monetary generation.
    const result = await gate.db.from('incidents').upsert({ id, worker_id: workerId, month_key: day.slice(0, 7), title: `Asistencia informativa · ${day}`, reason: note, amount: 0, kind: 'attendance_info', status: 'justified', decided_by: gate.worker.id, decided_at: at, evidence_note: note, meta: { type: 'attendance_hours', day, justified_minutes: justified, unjustified_minutes: unjustified, missing_minutes: row.missing_minutes, schedule_signature: row.schedule_signature, note, reviewed_at: at, reviewed_by: gate.worker.id } }, { onConflict: 'id' });
    if (result.error) throw result.error;
    return json({ ok: true });
  } catch (e) { console.error('[attendance:hours:save]', e); return json({ error: 'No se pudo guardar. Vuelve a intentarlo.' }, 500); }
}
