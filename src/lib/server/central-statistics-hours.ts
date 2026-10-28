import { addDate, ecuadorDate, ecuadorInstant, money, type CentralDailyStatistics } from '@/lib/central-statistics';

export type WorkSession = { id: string; worker_id: string; started_at: string; ended_at: string | null; expires_at: string; close_reason: string | null };
export type WorkVersion = { id: string; worker_id: string; effective_from: string; timezone: string; monthly_salary_eur: number | string; overtime_hourly_rate_eur: number | string | null; weekday_start: string | null; weekday_end: string | null; weekend_start: string; weekend_end: string };
export type WorkOverride = { id: string; worker_id: string; work_date: string; is_working: boolean; start_time: string | null; end_time: string | null; created_at: string };
export type WorkAdjustment = { id: string; worker_id: string; work_date: string; minutes: number; category: 'ordinary' | 'outside_schedule'; reason: string; created_at: string; created_by: string; hourly_rate_eur?: number | string | null };
const millis = (s: string) => Date.parse(s);
const monday = (day: string) => addDate(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
export function latestOverrides(rows: WorkOverride[]) {
  const map = new Map<string, WorkOverride>();
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) map.set(row.work_date, row);
  return map;
}
function union(intervals: Array<[number, number]>): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    if (end <= start) continue;
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else result.push([start, end]);
  }
  return result;
}

/** Real recorded sessions only. Unplanned weekend work remains unclassified,
 * never silently payable or absent; adjustments are a separate audited ledger. */
export function centralHours(input: {
  workerId: string; from: string; to: string; coverageStart: string | null; now?: number;
  sessions: WorkSession[]; versions: WorkVersion[]; overrides: WorkOverride[]; adjustments: WorkAdjustment[];
  payments?: Array<{ worker_id: string; date: string; payments_count: number; payments_amount: number }>;
}) {
  const start = millis(input.from), end = Math.min(millis(input.to), input.now ?? Date.now());
  const coverage = input.coverageStart ? millis(input.coverageStart) : Infinity;
  const available = coverage < end;
  const versions = input.versions.filter(v => v.worker_id === input.workerId).sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.id.localeCompare(b.id));
  const overrides = latestOverrides(input.overrides.filter(v => v.worker_id === input.workerId));
  const plannedWeeks = new Set([...overrides.values()].filter(x => x.is_working && [0, 6].includes(new Date(`${x.work_date}T12:00:00Z`).getUTCDay())).map(x => monday(x.work_date)));
  const intervals = union(input.sessions.filter(s => s.worker_id === input.workerId).map(s => [Math.max(start, coverage, millis(s.started_at)), Math.min(end, millis(s.ended_at || s.expires_at), millis(s.expires_at))]));
  const days: CentralDailyStatistics[] = [];
  const pending: string[] = [];
  let priced = true, estimate = 0;
  for (let day = ecuadorDate(new Date(start)); ecuadorInstant(day) < end; day = addDate(day)) {
    const dayStart = Math.max(start, ecuadorInstant(day)), dayEnd = Math.min(end, ecuadorInstant(addDate(day)));
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (dayEnd <= coverage) continue;
    if (isWeekend && !plannedWeeks.has(monday(day))) pending.push(day);
    const row: CentralDailyStatistics = { date: day, minutes: 0, ordinary_minutes: 0, outside_schedule_minutes: 0, unclassified_minutes: 0, adjustment_minutes: 0, payments_count: 0, payments_amount: 0 };
    for (const [sessionStart, sessionEnd] of intervals) {
      const a = Math.max(dayStart, sessionStart), b = Math.min(dayEnd, sessionEnd);
      if (b <= a) continue;
      const cuts = [a, ...versions.map(v => millis(v.effective_from)).filter(t => t > a && t < b), b];
      for (let i = 0; i < cuts.length - 1; i++) {
        const lo = cuts[i], hi = cuts[i + 1];
        const v = [...versions].reverse().find(v => millis(v.effective_from) <= lo);
        const mins = (hi - lo) / 60000;
        row.minutes += mins;
        const override = overrides.get(day);
        if (!v || (!override && ((!isWeekend && !v.weekday_start) || (isWeekend && !plannedWeeks.has(monday(day)))))) { row.unclassified_minutes += mins; continue; }
        const work = override ? override.is_working : !isWeekend;
        const fromTime = override?.start_time || v.weekday_start;
        const toTime = override?.end_time || v.weekday_end;
        const ordinary = work && fromTime && toTime ? Math.max(0, Math.min(hi, ecuadorInstant(day, toTime)) - Math.max(lo, ecuadorInstant(day, fromTime))) / 60000 : 0;
        const outside = mins - ordinary;
        row.ordinary_minutes += ordinary; row.outside_schedule_minutes += outside;
        if (outside > 0) {
          if (v.overtime_hourly_rate_eur == null) priced = false;
          else estimate += outside / 60 * Number(v.overtime_hourly_rate_eur);
        }
      }
    }
    for (const correction of input.adjustments.filter(a => a.worker_id === input.workerId && a.work_date === day)) {
      row.adjustment_minutes += Number(correction.minutes);
      row.minutes += Number(correction.minutes);
      if (correction.category === 'ordinary') row.ordinary_minutes += Number(correction.minutes);
      else {
        row.outside_schedule_minutes += Number(correction.minutes);
        if (correction.hourly_rate_eur == null) priced = false;
        else estimate += Number(correction.minutes) / 60 * Number(correction.hourly_rate_eur);
      }
    }
    const payment = input.payments?.find(p => p.worker_id === input.workerId && p.date === day);
    row.payments_count = Number(payment?.payments_count || 0); row.payments_amount = Number(payment?.payments_amount || 0);
    for (const key of ['minutes', 'ordinary_minutes', 'outside_schedule_minutes', 'unclassified_minutes'] as const) row[key] = money(row[key]);
    days.push(row);
  }
  const sum = (key: 'minutes' | 'ordinary_minutes' | 'outside_schedule_minutes' | 'unclassified_minutes' | 'adjustment_minutes') => money(days.reduce((n, d) => n + d[key], 0));
  return { available, days, worked_minutes: available ? sum('minutes') : null, ordinary_minutes: available ? sum('ordinary_minutes') : null, outside_schedule_minutes: available ? sum('outside_schedule_minutes') : null, unclassified_minutes: sum('unclassified_minutes'), adjustment_minutes: sum('adjustment_minutes'), pending_weekend_days: pending, extra_amount: available && priced && sum('unclassified_minutes') === 0 ? money(estimate) : null };
}
