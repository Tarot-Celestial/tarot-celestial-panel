const TIMEZONE = "Europe/Madrid";
const MIN_SAMPLE_DAYS = 3;
const MAX_SAMPLE_DAYS = 7;
const LOOKBACK_DAYS = 28;
const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export type CentralDailyPerformance = {
  metric: "xp";
  status: "good" | "medium" | "low" | "neutral";
  reason: "compared" | "no_activity" | "insufficient_history";
  label: string;
  description: string;
  current_xp: number;
  reference_xp: number | null;
  ratio_percent: number | null;
  sample_days: number;
  baseline_dates: string[];
  cutoff_hour: number;
  cutoff_label: string;
  thresholds: { good_percent: 100; medium_percent: 70 };
  hourly: Array<{
    hour: number;
    label: string;
    xp: number;
    cumulative_xp: number | null;
    reference_xp: number | null;
  }>;
};

type XpEvent = {
  id?: unknown;
  worker_id?: unknown;
  status?: unknown;
  xp_amount?: unknown;
  created_at?: unknown;
};

function validXpEvent(event: XpEvent, workerId: string, now: number) {
  if (!workerId || event.worker_id !== workerId || event.status !== "applied") return null;
  if (typeof event.xp_amount !== "number" && typeof event.xp_amount !== "string") return null;
  if (typeof event.xp_amount === "string" && !event.xp_amount.trim()) return null;
  const xp = Number(event.xp_amount);
  const timestamp = typeof event.created_at === "string" ? Date.parse(event.created_at) : NaN;
  if (!Number.isFinite(xp) || !Number.isFinite(timestamp) || timestamp > now) return null;
  return { xp, timestamp, id: typeof event.id === "string" && event.id ? event.id : null };
}

/** The activity list and chart use the same applied ledger and real instants.
 * String comparison is unsafe because Postgres may return +00:00 instead of Z.
 */
export function selectCentralDayXpEvents<T extends XpEvent>(
  events: readonly T[],
  options: { workerId: string; start: string; end: string; now?: Date },
): T[] {
  const start = Date.parse(options.start), end = Date.parse(options.end);
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || start >= end) {
    throw new Error("INVALID_PERFORMANCE_PERIOD");
  }
  const ids = new Set<string>();
  return events.filter(event => {
    const value = validXpEvent(event, options.workerId, now);
    if (!value || value.timestamp < start || value.timestamp >= end) return false;
    if (value.id && ids.has(value.id)) return false;
    if (value.id) ids.add(value.id);
    return true;
  });
}

function madridClock(instant: Date) {
  const parts = Object.fromEntries(clock.formatToParts(instant).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    label: `${parts.hour}:${parts.minute}`,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** An indicative comparison of recorded XP, never a sales target or a quality score.
 * Reuses the already-authorized, fully paginated event history without new queries.
 */
export function buildCentralDailyPerformance(
  events: readonly XpEvent[],
  selectedDate: string,
  options: { workerId: string; now?: Date },
): CentralDailyPerformance {
  const now = options.now ?? new Date();
  const dayStart = Date.parse(`${selectedDate}T00:00:00.000Z`);
  if (!Number.isFinite(now.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    || !Number.isFinite(dayStart) || new Date(dayStart).toISOString().slice(0, 10) !== selectedDate) {
    throw new Error("INVALID_PERFORMANCE_DATE");
  }
  const currentClock = madridClock(now);
  if (selectedDate > currentClock.date) throw new Error("FUTURE_PERFORMANCE_DATE");
  const isToday = selectedDate === currentClock.date;
  const cutoffSeconds = isToday ? currentClock.seconds : 86399;
  const cutoffHour = isToday ? currentClock.seconds / 3600 : 24;
  const firstDate = new Date(dayStart - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const days = new Map<string, number[]>();
  const seenIds = new Set<string>();

  for (const event of events) {
    const value = validXpEvent(event, options.workerId, now.getTime());
    if (!value) continue;
    const { xp, timestamp, id } = value;
    // The margin covers Madrid's UTC offset; exact calendar checks follow below.
    if (timestamp < dayStart - (LOOKBACK_DAYS + 1) * 86400000 || timestamp > dayStart + 86400000) continue;
    const local = madridClock(new Date(timestamp));
    if (local.date < firstDate || local.date > selectedDate) continue;
    // Today's actual timestamps take precedence during the repeated autumn hour:
    // an event at the first 02:30 has already happened at the second 02:15.
    if (local.date < selectedDate && local.seconds > cutoffSeconds) continue;
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    const amounts = days.get(local.date) ?? Array<number>(24).fill(0);
    amounts[local.hour] += xp;
    days.set(local.date, amounts);
  }

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  // A day without positive XP by the comparison time is not evidence of a shift.
  const baselineDates = [...days.keys()]
    .filter(date => date < selectedDate && sum(days.get(date)!) > 0)
    .sort().reverse().slice(0, MAX_SAMPLE_DAYS);
  const referenceDays = baselineDates.map(date => days.get(date)!);
  const comparable = referenceDays.length >= MIN_SAMPLE_DAYS;
  const referenceXp = comparable ? median(referenceDays.map(sum)) : null;
  const selectedHours = days.get(selectedDate) ?? Array<number>(24).fill(0);
  const currentXp = sum(selectedHours);
  const ratio = referenceXp !== null && referenceXp > 0 ? currentXp / referenceXp * 100 : null;
  const reason = currentXp <= 0 ? "no_activity" : !comparable ? "insufficient_history" : "compared";
  const status = reason !== "compared" || ratio === null ? "neutral"
    : ratio >= 100 ? "good" : ratio >= 70 ? "medium" : "low";
  const label = reason === "no_activity" ? "Sin XP positivo registrado"
    : reason === "insufficient_history" ? "Construyendo tu referencia"
    : status === "good" ? "En tu referencia o por encima"
    : status === "medium" ? "Cerca de tu referencia" : "Por debajo de tu referencia";
  const period = isToday ? `hasta las ${currentClock.label} (Madrid)` : "en la jornada completa";
  const description = reason === "no_activity"
    ? "Esta jornada no acumula XP positivo. Se muestra en neutro; no es una valoración de tu trabajo."
    : reason === "insufficient_history"
      ? `Necesitas al menos 3 jornadas anteriores con XP positivo ${period}, dentro de los últimos 28 días. Solo se muestra tu actividad registrada.`
      : `XP aplicados ${period}, comparados con la mediana de ${referenceDays.length} jornadas anteriores con XP positivo, dentro de los últimos 28 días. Verde: 100% o más; naranja: 70–99%; rojo: menos del 70%. Es una referencia orientativa, no un objetivo ni una valoración personal.`;
  let cumulative = 0;
  const referenceCumulative = referenceDays.map(() => 0);
  const hourly: CentralDailyPerformance["hourly"] = [{
    hour: 0, label: "00:00", xp: 0, cumulative_xp: 0, reference_xp: comparable ? 0 : null,
  }, ...selectedHours.map((xp, hour) => {
    cumulative += xp;
    referenceDays.forEach((day, index) => { referenceCumulative[index] += day[hour]; });
    const observed = !isToday || hour <= currentClock.hour;
    const pointHour = observed ? Math.min(hour + 1, cutoffHour) : hour + 1;
    return {
      hour: pointHour,
      label: observed && isToday && hour === currentClock.hour ? currentClock.label : `${String(hour + 1).padStart(2, "0")}:00`,
      xp,
      cumulative_xp: observed ? cumulative : null,
      reference_xp: observed && comparable ? median(referenceCumulative) : null,
    };
  })];
  return {
    metric: "xp", status, reason, label, description, current_xp: currentXp,
    reference_xp: referenceXp, ratio_percent: reason === "compared" ? ratio : null,
    sample_days: referenceDays.length, baseline_dates: baselineDates,
    cutoff_hour: cutoffHour, cutoff_label: isToday ? currentClock.label : "23:59",
    thresholds: { good_percent: 100, medium_percent: 70 }, hourly,
  };
}
