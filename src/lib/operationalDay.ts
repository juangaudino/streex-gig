export const OPERATIONAL_DAY_BOUNDARY_HOUR = 4;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Returns the driver's operational date: the new day begins at 4:00 a.m. local time. */
export function getOperationalDate(now = new Date()): string {
  const date = new Date(now);
  if (date.getHours() < OPERATIONAL_DAY_BOUNDARY_HOUR) {
    date.setDate(date.getDate() - 1);
  }
  return localDateKey(date);
}

/** Local wall-clock timestamp used by editable shift records (without a UTC suffix). */
export function formatLocalTimestamp(now = new Date()): string {
  return `${localDateKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/** Read-time compatibility for shifts saved by the old same-calendar-date overnight bug. */
export function resolveLegacyOvernightEnd(startTime: string, endTime?: string): string | undefined {
  if (!endTime || Date.parse(endTime) > Date.parse(startTime)) return endTime;
  const localTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
  if (!localTimestamp.test(startTime) || !localTimestamp.test(endTime) || startTime.slice(0, 10) !== endTime.slice(0, 10)) return endTime;
  const nextDay = new Date(`${endTime.slice(0, 10)}T${endTime.slice(11)}`);
  if (!Number.isFinite(nextDay.getTime())) return endTime;
  nextDay.setDate(nextDay.getDate() + 1);
  return formatLocalTimestamp(nextDay);
}
