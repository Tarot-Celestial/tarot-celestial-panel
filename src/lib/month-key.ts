/** Canonical month shared by invoice selectors and server queries. */
export function normalizeMonthKey(raw: unknown): string {
  const match = typeof raw === "string" ? /^(\d{4})-(\d{1,2})$/.exec(raw.trim()) : null;
  if (!match || Number(match[1]) < 1000 || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error("INVALID_MONTH_KEY");
  }
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}
