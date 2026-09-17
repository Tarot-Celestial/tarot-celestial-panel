import { attendanceAccess, attendanceReport } from '@/lib/server/attendance-hours';
import { addDay, dateKey, validDay } from '@/lib/attendance/hours';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function groupKey(day: string, group: string) {
  if (group === 'month') return day.slice(0, 7);
  if (group !== 'week') return day;
  const dt = new Date(`${day}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const year = dt.getUTCFullYear();
  const week = Math.ceil(((dt.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export async function GET(req: Request) {
  try {
    const gate = await attendanceAccess(req);
    if (gate.response) return gate.response;
    if (gate.worker.role !== 'admin') return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    const params = new URL(req.url).searchParams;
    const fromYMD = params.get('from') || addDay(dateKey(), -6), toYMD = params.get('to') || dateKey();
    const group = params.get('group') || 'day';
    if (!validDay(fromYMD) || !validDay(toYMD) || fromYMD > toYMD || Date.parse(toYMD) - Date.parse(fromYMD) > 366 * 86400000 || !['day', 'week', 'month'].includes(group)) return Response.json({ ok: false, error: 'INVALID_RANGE' }, { status: 400 });
    const acc = new Map<string, any>();
    for (let from = fromYMD; from <= toYMD; from = addDay(from, 31)) {
      const to = addDay(from, 30) < toYMD ? addDay(from, 30) : toYMD;
      const report = await attendanceReport(gate.db, from, to, params.get('worker_id') || undefined, true);
      for (const row of report.rows) {
        const key = groupKey(row.day, group), id = `${row.worker_id}:${key}`;
        const out = acc.get(id) || { worker_id: row.worker_id, display_name: row.display_name, role: row.role, team: row.team, group_key: key, worked_minutes: 0, break_minutes: 0, bathroom_minutes: 0, expected_minutes: 0, missing_minutes: 0, justified_minutes: 0, unjustified_minutes: 0, pending_minutes: 0, diff_minutes: 0 };
        for (const field of ['worked_minutes', 'break_minutes', 'bathroom_minutes', 'missing_minutes', 'justified_minutes', 'unjustified_minutes', 'pending_minutes'] as const) out[field] += row[field];
        out.expected_minutes += row.scheduled_minutes;
        out.diff_minutes = out.worked_minutes - out.expected_minutes;
        acc.set(id, out);
      }
    }
    return Response.json({ ok: true, rows: [...acc.values()].sort((a, b) => a.group_key.localeCompare(b.group_key) || String(a.display_name).localeCompare(String(b.display_name))), meta: { fromYMD, toYMD, group } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { console.error('[attendance:stats]', e); return Response.json({ ok: false, error: 'No se pudo calcular la asistencia.' }, { status: 500 }); }
}
