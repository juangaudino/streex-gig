import { getShiftBlocks, parseShiftTimestamp, resolveLegacyOvernightEnd, type TimedShift } from "./shiftTiming.ts";
import { calculateDayPerformanceTotals, reconcileEarningsSnapshotDeltas, type SnapshotForReconciliation } from "./snapshotReconciliation.ts";

export interface EvidenceDay {
  date: string;
  apps: Record<string, number>;
  shifts?: TimedShift[];
}
export interface EvidenceWeek { entries: EvidenceDay[] }
export interface EvidenceAttribution {
  snapshotId: string;
  status: string;
  mode: string;
  attributedDayDate?: string | null;
  shiftId?: string | null;
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  confidence?: string | null;
}
export interface EvidenceHour { dayDate: string; hour: number; amount: number; confidence: "confirmed" | "estimated" }
export interface DayPerformanceEvidence {
  earnings: number;
  reportedOperationalEarnings: number;
  excludedFromEfficiency: number;
  observedPositive: number;
  safeAttributed: number;
  legacyBaseline: number;
}

const money = (amount: number) => +amount.toFixed(2);
const isReward = (app: string) => app.trim().toLowerCase() === "octopus";
const operationalTotal = (day: EvidenceDay) => Object.entries(day.apps ?? {}).reduce((sum, [app, value]) =>
  sum + (isReward(app) ? 0 : Math.max(0, Number(value) || 0)), 0);

function formatterFor(timeZone: string | null) {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    return null;
  }
}

/** Actual work-block overlap, divided by local clock hour. */
function overlapHours(shift: TimedShift, start: number, end: number, timeZone: string | null): Array<{ hour: number; hours: number }> {
  const formatter = formatterFor(timeZone);
  if (!formatter || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const hours = new Map<number, number>();
  for (const block of getShiftBlocks(shift, timeZone)) {
    let cursor = Math.max(start, parseShiftTimestamp(block.startTime, timeZone));
    const blockEnd = Math.min(end, parseShiftTimestamp(block.endTime ?? "", timeZone));
    if (!Number.isFinite(cursor) || !Number.isFinite(blockEnd) || blockEnd <= cursor) continue;
    while (cursor < blockEnd) {
      const parts = formatter.formatToParts(new Date(cursor));
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      const hour = part("hour");
      const minute = part("minute");
      const second = part("second");
      if (![hour, minute, second].every(Number.isFinite)) break;
      const milliseconds = ((cursor % 1000) + 1000) % 1000;
      const remaining = 3_600_000 - minute * 60_000 - second * 1000 - milliseconds;
      const next = Math.min(blockEnd, cursor + Math.max(1, remaining));
      hours.set(hour, (hours.get(hour) ?? 0) + (next - cursor) / 3_600_000);
      cursor = next;
    }
  }
  return [...hours].map(([hour, duration]) => ({ hour, hours: duration }));
}

function pointInsideShift(shift: TimedShift, timestamp: number, timeZone: string | null): boolean {
  if (!Number.isFinite(timestamp) || !shift.endTime) return false;
  return getShiftBlocks(shift, timeZone).some((block) => {
    const start = parseShiftTimestamp(block.startTime, timeZone);
    const end = parseShiftTimestamp(block.endTime ?? "", timeZone);
    return Number.isFinite(start) && Number.isFinite(end) && timestamp >= start && timestamp <= end;
  });
}

/**
 * Match observed money to actual worked shifts. Unresolved and excluded events
 * remain in reported totals but are not used to claim hourly earnings.
 */
export function buildEarningsEvidence(args: {
  weeks: EvidenceWeek[];
  snapshots: SnapshotForReconciliation[];
  attributions: EvidenceAttribution[];
  timeZone: string | null;
}): { byDay: Map<string, DayPerformanceEvidence>; hourly: EvidenceHour[] } {
  const days = args.weeks.flatMap((week) => week.entries);
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const shifts = days.flatMap((day) => (day.shifts ?? []).map((shift) => ({ day, shift })));
  const shiftById = new Map(shifts.map((entry) => [entry.shift.id, entry]));
  const attributionBySnapshot = new Map(args.attributions.map((entry) => [entry.snapshotId, entry]));
  const reconciled = reconcileEarningsSnapshotDeltas(args.snapshots).bySnapshotId;
  const observedByDay = new Map<string, number>();
  const safeByDay = new Map<string, number>();
  const hourly: EvidenceHour[] = [];

  for (const snapshot of args.snapshots) {
    const amount = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
    if (amount <= 0 || isReward(snapshot.app)) continue;
    observedByDay.set(snapshot.dayDate, (observedByDay.get(snapshot.dayDate) ?? 0) + amount);
    const attribution = attributionBySnapshot.get(snapshot.id);
    if (attribution && (attribution.status !== "resolved" || attribution.mode === "day_only" || attribution.mode === "unassigned")) continue;
    const observedAt = Date.parse(snapshot.createdAt);
    let target = attribution?.shiftId ? shiftById.get(attribution.shiftId) : snapshot.shiftId ? shiftById.get(snapshot.shiftId) : undefined;
    if (!target && !attribution) {
      const candidates = shifts.filter((entry) => entry.day.date === snapshot.dayDate && pointInsideShift(entry.shift, observedAt, args.timeZone));
      if (candidates.length === 1) target = candidates[0];
    }
    if (!target?.shift.endTime) continue;
    // A saved shift id alone does not establish when a late update was earned.
    // Only a user-resolved attribution can place a post-shift observation.
    if (!attribution && !pointInsideShift(target.shift, observedAt, args.timeZone)) continue;
    const attributedDay = attribution?.attributedDayDate ?? snapshot.dayDate;
    if (target.day.date !== attributedDay || !dayByDate.has(attributedDay)) continue;

    if (attribution?.mode === "exact") {
      const at = Date.parse(attribution.effectiveStartAt ?? "");
      if (!pointInsideShift(target.shift, at, args.timeZone)) continue;
      const formatter = formatterFor(args.timeZone);
      const hour = formatter ? Number(formatter.formatToParts(new Date(at)).find((part) => part.type === "hour")?.value) : NaN;
      if (!Number.isInteger(hour)) continue;
      hourly.push({ dayDate: attributedDay, hour, amount, confidence: attribution.confidence === "confirmed" ? "confirmed" : "estimated" });
      safeByDay.set(attributedDay, (safeByDay.get(attributedDay) ?? 0) + amount);
      continue;
    }

    const shiftStart = parseShiftTimestamp(target.shift.startTime, args.timeZone);
    const shiftEnd = parseShiftTimestamp(resolveLegacyOvernightEnd(target.shift.startTime, target.shift.endTime) ?? "", args.timeZone);
    const prior = !attribution ? args.snapshots.filter((candidate) => candidate.id !== snapshot.id && candidate.dayDate === snapshot.dayDate && candidate.app === snapshot.app && candidate.shiftId === target!.shift.id && Date.parse(candidate.createdAt) < observedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] : undefined;
    const start = attribution?.effectiveStartAt ? Date.parse(attribution.effectiveStartAt) : prior ? Date.parse(prior.createdAt) : shiftStart;
    const end = attribution?.effectiveEndAt ? Date.parse(attribution.effectiveEndAt) : attribution ? shiftEnd : observedAt;
    let overlaps = overlapHours(target.shift, start, end, args.timeZone);
    if (!overlaps.length && attribution?.mode === "shift_distributed") overlaps = overlapHours(target.shift, shiftStart, shiftEnd, args.timeZone);
    const totalHours = overlaps.reduce((sum, item) => sum + item.hours, 0);
    if (totalHours <= 0) continue;
    safeByDay.set(attributedDay, (safeByDay.get(attributedDay) ?? 0) + amount);
    for (const item of overlaps) hourly.push({ dayDate: attributedDay, hour: item.hour, amount: amount * item.hours / totalHours, confidence: "estimated" });
  }

  const byDay = new Map<string, DayPerformanceEvidence>();
  for (const day of days) {
    const reported = operationalTotal(day);
    const observedPositive = money(observedByDay.get(day.date) ?? 0);
    const safeAttributed = money(safeByDay.get(day.date) ?? 0);
    byDay.set(day.date, {
      ...calculateDayPerformanceTotals(reported, observedPositive, safeAttributed),
      observedPositive, safeAttributed, legacyBaseline: money(Math.max(0, reported - observedPositive)),
    });
  }
  return { byDay, hourly };
}

export function workedHoursByClockHour(shift: TimedShift, timeZone: string | null): Array<{ hour: number; hours: number }> {
  if (!shift.endTime) return [];
  return overlapHours(shift, parseShiftTimestamp(shift.startTime, timeZone), parseShiftTimestamp(resolveLegacyOvernightEnd(shift.startTime, shift.endTime) ?? "", timeZone), timeZone);
}
