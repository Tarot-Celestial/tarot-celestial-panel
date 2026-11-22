const localTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string) {
  let cached = localTimeFormatters.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    localTimeFormatters.set(zone, cached);
  }
  return cached;
}

export function canonicalZone(zone: string) {
  const name = formatter(zone.trim()).resolvedOptions().timeZone;
  if (/^[+-]/.test(name)) throw new Error("Selecciona una zona horaria IANA.");
  return name;
}

export function localMinute(date: Date, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function deadlineCandidates(value: string, zone: string): string[] {
  // Even a task without a deadline must have a valid time zone.
  zone = canonicalZone(zone);
  if (!value) return [];
  const wallTime = Date.parse(value + ":00Z");
  if (!Number.isFinite(wallTime)) return [];
  const offsets = new Set<number>();
  // A transition can skip a local minute or give it two distinct UTC instants.
  for (const days of [-1, 0, 1]) {
    const sample = wallTime + days * 86400000;
    const wallAtSample = localMinute(new Date(sample), zone);
    offsets.add(Date.parse(wallAtSample + ":00Z") - sample);
  }
  return Array.from(offsets, offset => new Date(wallTime - offset))
    .filter(date => localMinute(date, zone) === value)
    .map(date => date.toISOString()).sort();
}

export function displayTime(iso: string, zone = "Europe/Madrid") {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short", timeStyle: "short", timeZone: zone,
  }).format(new Date(iso));
}
