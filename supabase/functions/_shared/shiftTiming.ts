/** Shift timing shared by the app and server-side analytics. */
export interface TimedWorkBlock {
  id: string;
  startTime: string;
  endTime?: string;
}

export interface TimedShift {
  id: string;
  startTime: string;
  endTime?: string;
  blocks?: TimedWorkBlock[];
}

/** Parse an unzoned wall-clock field in the driver's zone on the server.
 * A null zone explicitly means unknown; undefined retains browser-local behavior.
 * Ambiguous or nonexistent DST wall times are excluded rather than guessed. */
export function parseShiftTimestamp(value: string, timeZone?: string | null): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) return Date.parse(value);
  if (timeZone === undefined) return Date.parse(value);
  if (!timeZone) return NaN;
  try {
    const values = match.slice(1, 7).map((part) => Number(part ?? 0));
    const desired = Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]);
    const validated = new Date(desired);
    if (validated.getUTCFullYear() !== values[0] || validated.getUTCMonth() !== values[1] - 1 || validated.getUTCDate() !== values[2] || validated.getUTCHours() !== values[3] || validated.getUTCMinutes() !== values[4] || validated.getUTCSeconds() !== values[5]) return NaN;
    const milliseconds = Number((match[7] ?? "").padEnd(3, "0") || 0);
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const wallTime = (timestamp: number) => {
      const parts = formatter.formatToParts(new Date(timestamp));
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    };
    let guess = desired;
    for (let attempt = 0; attempt < 4; attempt++) {
      const delta = desired - wallTime(guess);
      if (!delta) break;
      guess += delta;
    }
    if (wallTime(guess) !== desired) return NaN;
    // Some regions repeat 30, 60 or 120 minutes when daylight saving ends.
    if ([-7200000, -3600000, -1800000, 1800000, 3600000, 7200000].some((offset) => wallTime(guess + offset) === desired)) return NaN;
    return guess + milliseconds;
  } catch {
    return NaN;
  }
}

export function formatLocalTimestamp(now = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${date}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/** Interpret the old same-date overnight encoding without changing stored data. */
export function resolveLegacyOvernightEnd(startTime: string, endTime?: string): string | undefined {
  if (!endTime || Date.parse(endTime) > Date.parse(startTime)) return endTime;
  const localTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
  if (!localTimestamp.test(startTime) || !localTimestamp.test(endTime) || startTime.slice(0, 10) !== endTime.slice(0, 10)) return endTime;
  const nextDay = new Date(`${endTime.slice(0, 10)}T${endTime.slice(11)}`);
  if (!Number.isFinite(nextDay.getTime())) return endTime;
  nextDay.setDate(nextDay.getDate() + 1);
  return formatLocalTimestamp(nextDay);
}

/** Preserve actual work blocks, excluding pauses and stale time beyond shift boundaries. */
export function getShiftBlocks(shift: TimedShift, timeZone?: string | null): TimedWorkBlock[] {
  const source = shift.blocks?.length
    ? shift.blocks
    : [{ id: `${shift.id}_block_1`, startTime: shift.startTime, endTime: shift.endTime }];
  const shiftStart = parseShiftTimestamp(shift.startTime, timeZone);
  const resolvedShiftEndTime = resolveLegacyOvernightEnd(shift.startTime, shift.endTime);
  const shiftEnd = resolvedShiftEndTime ? parseShiftTimestamp(resolvedShiftEndTime, timeZone) : null;

  return source.flatMap((block, index) => {
    let startTime = index === 0 ? shift.startTime : block.startTime;
    let endTime = resolveLegacyOvernightEnd(startTime, block.endTime ?? (index === source.length - 1 ? resolvedShiftEndTime : undefined));
    let start = parseShiftTimestamp(startTime, timeZone);
    let end = endTime ? parseShiftTimestamp(endTime, timeZone) : null;
    if (Number.isFinite(shiftStart) && Number.isFinite(start) && start < shiftStart) {
      startTime = shift.startTime;
      start = shiftStart;
    }
    if (shiftEnd !== null && Number.isFinite(shiftEnd) && end !== null && Number.isFinite(end) && end > shiftEnd) {
      endTime = resolvedShiftEndTime;
      end = shiftEnd;
    }
    if (end !== null && Number.isFinite(start) && Number.isFinite(end) && end <= start) return [];
    return [{ ...block, startTime, endTime }];
  });
}

export function shiftDurationHours(shift: TimedShift, timeZone?: string | null): number {
  const hours = getShiftBlocks(shift, timeZone).reduce((sum, block) => {
    const start = parseShiftTimestamp(block.startTime, timeZone);
    const end = block.endTime ? parseShiftTimestamp(block.endTime, timeZone) : NaN;
    return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? +((end - start) / 3_600_000).toFixed(2) : 0);
  }, 0);
  return +hours.toFixed(2);
}
