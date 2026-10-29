export const CENTRAL_TIMEZONE = 'America/Guayaquil' as const;
export const CENTRAL_METRICS = ['payments_count', 'payments_amount', 'payments_during_session_count', 'payments_during_session_amount', 'average_payment', 'captures_confirmed', 'recoveries', 'recovery_attempts', 'recovery_counted', 'capture_actions', 'followups_completed', 'calls_registered', 'call_minutes', 'notes_written', 'unique_clients', 'xp_earned', 'leads_assigned', 'pending_followups'] as const;
export type CentralMetricKey = typeof CENTRAL_METRICS[number];
export type CentralMetric = { current: number | null; previous: number | null; delta: number | null; percent: number | null };
export type CentralWorkConfig = {
  version_id: string | null; effective_from: string | null; timezone: string;
  monthly_salary_eur: number; overtime_hourly_rate_eur: number | null;
  weekday_start: string | null; weekday_end: string | null;
  weekend_start: string; weekend_end: string;
};
export type CentralDailyStatistics = {
  date: string; minutes: number; ordinary_minutes: number; outside_schedule_minutes: number;
  unclassified_minutes: number; adjustment_minutes: number; payments_count: number; payments_amount: number;
};
export type CentralAdjustment = { id: string; date: string; minutes: number; category: 'ordinary' | 'outside_schedule'; reason: string; created_at: string; created_by: string };
export type CentralWorkerStatistics = {
  id: string; display_name: string; role: string; is_active: boolean;
  metrics: Record<CentralMetricKey, CentralMetric>;
  hours: {
    worked_minutes: number | null; ordinary_minutes: number | null; outside_schedule_minutes: number | null;
    break_minutes: null; previous_worked_minutes: number | null; coverage_start: string | null;
    unclassified_minutes: number; pending_weekend_days: string[]; extra_amount: number | null;
    adjustment_minutes: number; estimate_only: true;
  };
  xp: { total: number; level: number; progress_percent: number; next_level_xp: number | null };
  config: CentralWorkConfig; weekend_days: string[]; coverage: string[];
  day_breakdown: CentralDailyStatistics[]; adjustments: CentralAdjustment[];
};
export type CentralStatisticsResponse = {
  ok: true; month: string; timezone: typeof CENTRAL_TIMEZONE;
  period: { current_start: string; current_end: string; previous_start: string; previous_end: string; is_partial: boolean; label: string; previous_label: string };
  workers: CentralWorkerStatistics[];
  totals: { payments_amount: number; payments_count: number; web_payments_amount: number; web_payments_count: number; unattributed_payments_amount: number; unattributed_payments_count: number };
  coverage: string[];
  templates: { morning: { start: '07:00'; end: '15:00'; timezone: typeof CENTRAL_TIMEZONE; assigned: false } };
};

export const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function metric(current: number | null, previous: number | null): CentralMetric {
  return { current, previous, delta: current == null || previous == null ? null : money(current - previous), percent: current == null || previous == null || previous === 0 ? null : money((current - previous) / Math.abs(previous) * 100) };
}
/** Partial source histories can show recorded counts, but not a fair trend. */
export function coveredMetric(current: number | null, previous: number | null, complete: boolean): CentralMetric {
  const value = metric(current, previous);
  return complete ? value : { ...value, delta: null, percent: null };
}
export function ecuadorDate(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CENTRAL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function addDate(value: string, days = 1) { return new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function ecuadorInstant(day: string, time = '00:00') { return Date.parse(`${day}T${time.slice(0, 5)}:00-05:00`); }
export function centralPeriod(month: string, now = new Date()): CentralStatisticsResponse['period'] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > ecuadorDate(now).slice(0, 7)) throw new Error('INVALID_MONTH');
  const [year, m] = month.split('-').map(Number);
  const previous = new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
  const start = ecuadorInstant(`${month}-01`), end = ecuadorInstant(next);
  const isPartial = now.getTime() < end;
  const currentEnd = Math.min(now.getTime(), end);
  let previousEnd = start;
  if (isPartial) {
    const local = new Date(now.getTime() - 5 * 3600000);
    const day = local.getUTCDate();
    const previousDays = new Date(Date.UTC(year, m - 1, 0)).getUTCDate();
    previousEnd = day > previousDays ? start : ecuadorInstant(`${previous}-${String(day).padStart(2, '0')}`) + local.getUTCHours() * 3600000 + local.getUTCMinutes() * 60000 + local.getUTCSeconds() * 1000 + local.getUTCMilliseconds();
  }
  const iso = (n: number) => new Date(n).toISOString();
  const label = (a: number, b: number) => `${new Intl.DateTimeFormat('es', { timeZone: CENTRAL_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }).format(a)} – ${new Intl.DateTimeFormat('es', { timeZone: CENTRAL_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }).format(b)} (fin exclusivo)`;
  const previousStart = ecuadorInstant(`${previous}-01`);
  return { current_start: iso(start), current_end: iso(currentEnd), previous_start: iso(previousStart), previous_end: iso(previousEnd), is_partial: isPartial, label: label(start, currentEnd), previous_label: label(previousStart, previousEnd) };
}
