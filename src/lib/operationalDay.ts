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

export { formatLocalTimestamp, resolveLegacyOvernightEnd } from "../../supabase/functions/_shared/shiftTiming";
