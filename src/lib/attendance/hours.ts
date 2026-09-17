/** Informational attendance only. No rates or invoice amounts belong in this module. */
export type Schedule = { id: string; worker_id: string; day_of_week: number; start_time: string; end_time: string; timezone: string; active: boolean };
export type AttendanceEvent = { worker_id: string; event_type: string; at: string; meta?: { action?: string; phase?: string } };
type Interval = [number, number];
export const REPORT_TZ = 'Europe/Madrid';
export function dateKey(at = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
export function addDay(day: string, count = 1) { return new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
export function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day; }
export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecciona un mes válido.');
  return { from: `${month}-01`, to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10) };
}
export function localTime(day: string, time: string, tz: string): number {
  const target = Date.parse(`${day}T${time.slice(0, 5)}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let value = target;
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(value));
    const part = (name: string) => parts.find(p => p.type === name)?.value;
    const wall = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    const next = value + target - wall;
    if (next === value) break;
    value = next;
  }
  return value;
}
function merge(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const previous = result[result.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
export function calculateDay(day: string, schedules: Schedule[], events: AttendanceEvent[], now = Date.now()) {
  const start = localTime(day, '00:00', REPORT_TZ), end = localTime(addDay(day), '00:00', REPORT_TZ);
  const shifts: Interval[] = [];
  // Include neighbouring dates: source schedule may be overnight or in another timezone.
  for (let offset = -2; offset <= 1; offset++) {
    const d = addDay(day, offset), dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    for (const s of schedules.filter(s => s.active && Number(s.day_of_week) === dow)) {
      const tz = s.timezone || REPORT_TZ;
      const a = localTime(d, s.start_time, tz);
      const b = localTime(s.end_time <= s.start_time ? addDay(d) : d, s.end_time, tz);
      if (b > start && a < end) shifts.push([Math.max(a, start), Math.min(b, end)]);
    }
  }
  const scheduled = merge(shifts), elapsed = scheduled.map(([a, b]) => [a, Math.min(b, now)] as Interval).filter(([a, b]) => b > a);
  let status = 'offline', previous = 0, worked = 0, breaks = 0, bathroom = 0, inShift = 0;
  const append = (until: number) => {
    // Match live attendance's 90-second freshness; never infer hours from a stale connection.
    const segment: Interval = [Math.max(previous, start), Math.min(until, previous + 90000, end, now)];
    const duration = Math.max(0, segment[1] - segment[0]);
    if (status === 'working') { worked += duration; inShift += elapsed.reduce((n, shift) => n + overlap(segment, shift), 0); }
    else if (status === 'break') breaks += duration;
    else if (status === 'bathroom') bathroom += duration;
  };
  for (const event of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(event.at);
    if (at > Math.min(end, now)) break;
    if (previous) append(at);
    if (at - previous > 90000) status = 'offline';
    if (event.event_type === 'offline') status = 'offline';
    else if (event.event_type === 'heartbeat') { if (status !== 'break' && status !== 'bathroom') status = 'working'; }
    else if (event.event_type === 'online') status = ['break', 'bathroom'].includes(event.meta?.action || '') && event.meta?.phase !== 'end' ? event.meta!.action! : 'working';
    previous = at;
  }
  if (previous) append(Math.min(end, now));
  const expected = scheduled.reduce((n, [a, b]) => n + b - a, 0);
  const due = elapsed.reduce((n, [a, b]) => n + b - a, 0);
  const minutes = (ms: number) => Math.round(ms / 60000);
  return { day, scheduled_minutes: minutes(expected), elapsed_minutes: minutes(due), worked_minutes: minutes(worked), in_shift_minutes: minutes(inShift), break_minutes: minutes(breaks), bathroom_minutes: minutes(bathroom), missing_minutes: Math.max(0, minutes(due) - minutes(inShift)), closed: now >= end, schedule_signature: JSON.stringify(scheduled) };
}
export type DayHours = ReturnType<typeof calculateDay>;
export function classifyDay(row: DayHours, meta?: Record<string, any>) {
  const reviewed = !!meta && meta.schedule_signature === row.schedule_signature && meta.missing_minutes === row.missing_minutes;
  const justified = reviewed ? Math.max(0, Math.min(row.missing_minutes, Number(meta?.justified_minutes) || 0)) : 0;
  const unjustified = reviewed ? Math.max(0, Math.min(row.missing_minutes - justified, Number(meta?.unjustified_minutes) || 0)) : 0;
  return { ...row, justified_minutes: justified, unjustified_minutes: unjustified, pending_minutes: row.missing_minutes - justified - unjustified, needs_review: !!meta && !reviewed, note: String(meta?.note || ''), reviewed_at: meta?.reviewed_at || null };
}
export function hoursLabel(minutes: number) { return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60).toString().padStart(2, '0')} min`; }
