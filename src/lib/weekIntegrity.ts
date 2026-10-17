import { z } from "zod";
import { DAY_NAMES, type EarningsSnapshot, type WeekRecord } from "./types";
import { resolveLegacyOvernightEnd } from "./operationalDay";

export type IntegritySeverity = "P0" | "P1" | "P2" | "P3";

export interface IntegrityIssue {
  severity: IntegritySeverity;
  code: string;
  path: string;
  message: string;
}

const finiteNonNegative = z.number().finite().nonnegative();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workBlockSchema = z.object({
  id: z.string().min(1),
  startTime: timestamp,
  endTime: timestamp.optional(),
}).passthrough();

const shiftSchema = z.object({
  id: z.string().min(1),
  startTime: timestamp,
  endTime: timestamp.optional(),
  blocks: z.array(workBlockSchema).optional(),
  earnings: finiteNonNegative.optional(),
  miles: finiteNonNegative.optional(),
  rideCount: finiteNonNegative.optional(),
  ridesByApp: z.record(z.string(), finiteNonNegative).optional(),
  legacyRideCount: finiteNonNegative.optional(),
  note: z.string().optional(),
}).passthrough();

const daySchema = z.object({
  dayName: z.enum(DAY_NAMES),
  date: dateKey,
  apps: z.record(z.string(), finiteNonNegative),
  bonuses: z.array(z.object({
    id: z.string().min(1),
    app: z.string().min(1),
    amount: finiteNonNegative,
    createdAt: timestamp.optional(),
    source: z.enum(["manual", "legacy_octopus"]).optional(),
  }).passthrough()).optional(),
  logged: z.boolean().optional(),
  dayClosed: z.boolean().optional(),
  shifts: z.array(shiftSchema).optional(),
  workedHours: finiteNonNegative.optional(),
  rideCount: finiteNonNegative.optional(),
  mileage: finiteNonNegative.optional(),
  notes: z.string().optional(),
}).passthrough();

export const weekRecordSchema = z.object({
  id: z.string().min(1),
  startDate: dateKey,
  endDate: dateKey,
  weeklyGoal: finiteNonNegative,
  weeklyHoursGoal: finiteNonNegative.optional(),
  status: z.enum(["open", "closed"]),
  entries: z.array(daySchema).length(7),
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough();

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

export function inspectWeekIntegrity(week: WeekRecord): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const seenDates = new Set<string>();
  if (week.startDate > week.endDate) {
    issues.push({ severity: "P0", code: "WEEK_DATE_RANGE", path: "week", message: "Week end precedes week start." });
  }

  week.entries.forEach((day, dayIndex) => {
    const path = `entries[${dayIndex}]`;
    if (seenDates.has(day.date)) issues.push({ severity: "P1", code: "DUPLICATE_DAY", path, message: "Day date appears more than once." });
    seenDates.add(day.date);
    if (day.date < week.startDate || day.date > week.endDate) {
      issues.push({ severity: "P1", code: "DAY_OUTSIDE_WEEK", path, message: "Day date falls outside its week." });
    }

    const shifts = day.shifts ?? [];
    shifts.forEach((shift, shiftIndex) => {
      const shiftPath = `${path}.shifts[${shiftIndex}]`;
      const normalizedShiftEnd = resolveLegacyOvernightEnd(shift.startTime, shift.endTime);
      if ((shift.operationalDate ?? dateOnly(shift.startTime)) !== day.date) {
        issues.push({ severity: "P1", code: "SHIFT_OUTSIDE_DAY", path: shiftPath, message: "Shift boundary is outside its day." });
      }
      if (normalizedShiftEnd && Date.parse(normalizedShiftEnd) <= Date.parse(shift.startTime)) {
        issues.push({ severity: "P1", code: "INVERTED_SHIFT", path: shiftPath, message: "Shift end does not follow its start." });
      }
      const attributed = Object.values(shift.ridesByApp ?? {}).reduce((sum, value) => sum + value, 0);
      if (shift.ridesByApp && shift.rideCount !== undefined && attributed > shift.rideCount) {
        issues.push({ severity: "P1", code: "RIDES_ATTRIBUTION_EXCEEDS_TOTAL", path: shiftPath, message: "App ride counts exceed the shift total." });
      }
      (shift.blocks ?? []).forEach((block, blockIndex) => {
        const normalizedBlockEnd = resolveLegacyOvernightEnd(block.startTime, block.endTime);
        if (Date.parse(block.startTime) < Date.parse(shift.startTime)
          || (normalizedShiftEnd && (!normalizedBlockEnd || Date.parse(normalizedBlockEnd) > Date.parse(normalizedShiftEnd)))) {
          issues.push({ severity: "P1", code: "BLOCK_OUTSIDE_SHIFT", path: `${shiftPath}.blocks[${blockIndex}]`, message: "Work block exceeds edited shift boundaries." });
        }
        if (normalizedBlockEnd && Date.parse(normalizedBlockEnd) <= Date.parse(block.startTime)) {
          issues.push({ severity: "P1", code: "INVERTED_BLOCK", path: `${shiftPath}.blocks[${blockIndex}]`, message: "Work block end does not follow its start." });
        }
      });
    });

    for (let left = 0; left < shifts.length; left += 1) {
      if (!shifts[left].endTime) continue;
      for (let right = left + 1; right < shifts.length; right += 1) {
        if (shifts[right].endTime && overlaps(shifts[left].startTime, shifts[left].endTime!, shifts[right].startTime, shifts[right].endTime!)) {
          issues.push({ severity: "P1", code: "OVERLAPPING_SHIFTS", path, message: "Two completed shifts overlap." });
        }
      }
    }

    const shiftMiles = shifts.reduce((sum, shift) => sum + (shift.miles ?? 0), 0);
    if (day.mileage !== undefined && shiftMiles > day.mileage + 0.02) {
      issues.push({ severity: "P1", code: "SHIFT_MILES_EXCEED_DAY", path, message: "Stored shift miles exceed the authoritative accumulated day mileage." });
    }
  });
  return issues;
}

export function parseWeekRecord(value: unknown): WeekRecord {
  return weekRecordSchema.parse(value);
}

export function inspectSnapshotIntegrity(snapshot: EarningsSnapshot, week?: WeekRecord): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (Math.abs((snapshot.newAmount - snapshot.previousAmount) - snapshot.delta) > 0.009) {
    issues.push({ severity: "P1", code: "SNAPSHOT_DELTA_MISMATCH", path: `snapshot:${snapshot.id}`, message: "Snapshot delta does not match its transition." });
  }
  if (week && (!week.entries.some((day) => day.date === snapshot.dayDate) || snapshot.weekId !== week.id)) {
    issues.push({ severity: "P1", code: "SNAPSHOT_OUTSIDE_WEEK", path: `snapshot:${snapshot.id}`, message: "Snapshot does not belong to its referenced week/day." });
  }
  return issues;
}
