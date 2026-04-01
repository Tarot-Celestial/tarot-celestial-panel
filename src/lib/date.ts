export function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function buildMonthDateRange(month_key: string) {
  const [y, m] = month_key.split("-").map(Number);
  const lastDay = getLastDayOfMonth(y, m);
  return {
    start: `${month_key}-01`,
    end: `${month_key}-${String(lastDay).padStart(2, "0")}`
  };
}
