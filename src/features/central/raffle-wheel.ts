export type WheelEntry = { id: string; number: number; name: string; clientId: string };

export function eligibleEntries(entries: Array<{
  id: string; raffle_number: number; client_id: string;
  client?: { nombre?: string | null; apellido?: string | null } | null;
}>): WheelEntry[] {
  const seen = new Set<number>();
  return entries.flatMap((entry) => {
    const number = Number(entry.raffle_number);
    if (!entry.client_id || !entry.client || !Number.isSafeInteger(number) || number < 1 || seen.has(number)) return [];
    seen.add(number);
    return [{ id: entry.id, number, clientId: entry.client_id,
      name: [entry.client.nombre, entry.client.apellido].filter(Boolean).join(" ").trim() || "Cliente sin nombre" }];
  }).sort((a, b) => a.number - b.number);
}

// Rejection sampling gives every ticket the same probability (not every client).
export function randomTicketIndex(count: number, draw: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error("No hay participaciones válidas para girar.");
  const limit = Math.floor(4294967296 / count) * count;
  let value: number;
  do { value = draw(); } while (value >= limit);
  return value % count;
}

export function landingRotation(previous: number, index: number, count: number) {
  const target = (360 - (index + 0.5) * (360 / count)) % 360;
  return previous + 6 * 360 + ((target - previous % 360 + 360) % 360);
}
