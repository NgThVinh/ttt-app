export function vietnamToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export function monthDays(month: string) {
  const [year, index] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return [
    ...Array(offset).fill(null),
    ...Array.from(
      { length: count },
      (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  ] as (string | null)[];
}
export function shiftDate(day: string, days: number): string {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function shiftMonth(month: string, offset: number): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1))
    .toISOString()
    .slice(0, 7);
}
