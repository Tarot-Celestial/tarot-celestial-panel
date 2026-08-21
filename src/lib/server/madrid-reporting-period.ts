export const MADRID_TIME_ZONE = "Europe/Madrid";

function pad2(value: number) { return String(value).padStart(2, "0"); }

export function madridTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("INVALID_REPORTING_DATE");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function shiftDateKey(value: string, days: number) {
  const parsed = parseDateKey(value);
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function timeZoneOffsetMs(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) === 24 ? 0 : Number(values.hour), Number(values.minute), Number(values.second)) - date.getTime();
}

export function madridMidnightUtc(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  let utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  for (let index = 0; index < 2; index += 1) {
    utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) - timeZoneOffsetMs(utc));
  }
  return utc;
}

export function previousMonthEquivalentKey(value: string) {
  const parsed = parseDateKey(value);
  const previous = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(Math.min(parsed.day, lastDay))}`;
}

export function monthToDateComparison(selectedDay: string) {
  const current = parseDateKey(selectedDay);
  const previousEnd = previousMonthEquivalentKey(selectedDay);
  const currentMonth = `${current.year}-${pad2(current.month)}`;
  const previousMonth = previousEnd.slice(0, 7);
  return {
    mode: "mtd" as const,
    timeZone: MADRID_TIME_ZONE,
    currentMonth,
    previousMonth,
    currentStartKey: `${currentMonth}-01`,
    currentEndKey: selectedDay,
    previousStartKey: `${previousMonth}-01`,
    previousEndKey: previousEnd,
    currentStartIso: madridMidnightUtc(`${currentMonth}-01`).toISOString(),
    currentEndExclusiveIso: madridMidnightUtc(shiftDateKey(selectedDay, 1)).toISOString(),
    previousStartIso: madridMidnightUtc(`${previousMonth}-01`).toISOString(),
    previousEndExclusiveIso: madridMidnightUtc(shiftDateKey(previousEnd, 1)).toISOString(),
  };
}

export function fullMonthComparison(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return monthToDateComparison(`${monthKey}-${pad2(lastDay)}`);
}
