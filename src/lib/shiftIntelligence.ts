import { isRewardApp, operationalDayTotal } from "./rewardIncome";
import { earningsSnapshotTransitionKey, reconcileEarningsSnapshotDeltas } from "./earningsSnapshots";
import { buildAttributedHourAmounts, effectiveShiftId } from "./earningsAttributions";
import type { DayEntry, EarningsAttribution, EarningsSnapshot, ShiftSession, ShiftWorkBlock, WeekRecord } from "./types";
import { getAccumulatedDayMileage, getEffectiveShiftMileage } from "./mileageAttribution";
import { formatLocalTimestamp, OPERATIONAL_DAY_BOUNDARY_HOUR, resolveLegacyOvernightEnd } from "./operationalDay";

export interface ShiftSummary {
  totalShifts: number;
  completedShifts: number;
  activeShifts: number;
  workDays: number;
  multiShiftDays: number;
  totalHours: number;
  averageShiftHours: number | null;
  totalMiles: number;
  totalRides: number;
  earningsPerHour: number | null;
  earningsPerMile: number | null;
  earningsPerRide: number | null;
  ridesPerHour: number | null;
  milesPerRide: number | null;
  minutesPerRide: number | null;
  milesPerHour: number | null;
}

export interface HourBucket {
  hour: number;
  label: string;
  earnings: number;
  hours: number;
  earningsPerHour: number;
  observations?: number;
}

export interface PatternIntelligence {
  summary: ShiftSummary;
  hourlyHeatmap: HourBucket[];
  strongestHours: HourBucket[];
  recoveryWindows: HourBucket[];
  bestAppsByHour: { hour: number; label: string; app: string; earnings: number }[];
  morningVsNight: {
    style: "morning" | "night" | "balanced" | "insufficient";
    morningEarningsPerHour: number;
    nightEarningsPerHour: number;
    copy: string;
  };
  productivityWindows: { label: string; earningsPerHour: number; hours: number }[];
  fatigueNote: string | null;
  hasEnoughShiftData: boolean;
  hasEnoughTimingData: boolean;
  timingSource: "snapshot" | "estimated";
  timingSourceLabel: string;
  timingCopy: string;
}

export type ShiftEarningsSource = "manual" | "snapshot" | "single-shift-day" | "unavailable";

export interface ShiftEarningsResolution {
  earnings: number | null;
  source: ShiftEarningsSource;
  snapshotCount?: number;
}

function round(value: number): number {
  return +value.toFixed(2);
}

function money(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return +parsed.toFixed(2);
}

function shiftTimestamp(_operationalDate: string, now = new Date()): string {
  return formatLocalTimestamp(now);
}

function createWorkBlock(shiftId: string, startTime: string, index = 0): ShiftWorkBlock {
  return {
    id: `${shiftId}_block_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
    startTime,
  };
}

function durationHours(startTime?: string, endTime?: string): number {
  if (!startTime || !endTime) return 0;
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round((end - start) / 3600000);
}

export function getShiftBlocks(shift: ShiftSession): ShiftWorkBlock[] {
  const source = shift.blocks?.length
    ? shift.blocks
    : [{ id: `${shift.id}_block_1`, startTime: shift.startTime, endTime: shift.endTime }];
  const shiftStart = Date.parse(shift.startTime);
  const resolvedShiftEndTime = resolveLegacyOvernightEnd(shift.startTime, shift.endTime);
  const shiftEnd = resolvedShiftEndTime ? Date.parse(resolvedShiftEndTime) : null;

  return source.flatMap((block, index) => {
    let startTime = index === 0 ? shift.startTime : block.startTime;
    let endTime = resolveLegacyOvernightEnd(startTime, block.endTime ?? (index === source.length - 1 ? resolvedShiftEndTime : undefined));
    let start = Date.parse(startTime);
    let end = endTime ? Date.parse(endTime) : null;

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

export function updateShiftBoundaryTime(
  shift: ShiftSession,
  field: "startTime" | "endTime",
  value: string,
): ShiftSession | null {
  const next = field === "endTime"
    ? { ...shift, endTime: resolveLegacyOvernightEnd(shift.startTime, value) }
    : { ...shift, startTime: value };
  if (next.endTime && Date.parse(next.endTime) <= Date.parse(next.startTime)) return null;
  const source = shift.blocks?.length
    ? shift.blocks
    : [{ id: `${shift.id}_block_1`, startTime: shift.startTime, endTime: shift.endTime }];
  const blocks = source.map((block, index) => ({
    ...block,
    ...(index === 0 ? { startTime: next.startTime } : {}),
    ...(index === source.length - 1 && next.endTime ? { endTime: next.endTime } : {}),
  }));
  return { ...next, blocks: getShiftBlocks({ ...next, blocks }) };
}

export function shiftDurationHours(shift: ShiftSession): number {
  return round(getShiftBlocks(shift).reduce((sum, block) => sum + durationHours(block.startTime, block.endTime), 0));
}

export function activeShiftDurationHours(shift: ShiftSession, now = new Date()): number {
  const nowLocal = `${localDateKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
  return round(getShiftBlocks(shift).reduce((sum, block) => {
    const endTime = block.endTime ?? (!shift.endTime ? nowLocal : undefined);
    return sum + durationHours(block.startTime, endTime);
  }, 0));
}

export function shiftBreakHours(shift: ShiftSession): number {
  const blocks = getShiftBlocks(shift)
    .filter((block) => block.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return round(blocks.reduce((sum, block, index) => {
    if (index === 0) return sum;
    const previous = blocks[index - 1];
    return sum + durationHours(previous.endTime, block.startTime);
  }, 0));
}

export function isShiftPaused(shift: ShiftSession): boolean {
  if (shift.endTime) return false;
  const blocks = getShiftBlocks(shift);
  return blocks.length > 0 && blocks.every((block) => Boolean(block.endTime));
}

export function isShiftRunning(shift: ShiftSession): boolean {
  if (shift.endTime) return false;
  return getShiftBlocks(shift).some((block) => !block.endTime);
}

export function getDayMiles(day: DayEntry): number {
  return getAccumulatedDayMileage(day);
}

export function getShiftMiles(day: DayEntry, shift: ShiftSession): number {
  return getEffectiveShiftMileage(day, shift);
}

export function getWeekMiles(week: WeekRecord): number {
  return round(week.entries.reduce((sum, day) => sum + getDayMiles(day), 0));
}

export function getDayRideCount(day: DayEntry): number {
  const shiftTotal = (day.shifts ?? []).reduce((sum, shift) => sum + Math.max(0, Math.trunc(Number(shift.rideCount) || 0)), 0);
  if (shiftTotal > 0) return shiftTotal;
  return Math.max(0, Math.trunc(Number(day.rideCount) || 0));
}

export function getWeekRideCount(week: WeekRecord): number {
  return week.entries.reduce((sum, day) => sum + getDayRideCount(day), 0);
}

export function getDayShiftHours(day: DayEntry, now = new Date()): number {
  const shiftHours = round((day.shifts ?? []).reduce((sum, shift) => {
    return sum + (shift.endTime ? shiftDurationHours(shift) : activeShiftDurationHours(shift, now));
  }, 0));
  if (shiftHours > 0) return shiftHours;
  return Number.isFinite(day.workedHours) ? Math.max(0, Number(day.workedHours)) : 0;
}

export function getWeekShiftHours(week: WeekRecord): number {
  return round(week.entries.reduce((sum, day) => sum + getDayShiftHours(day), 0));
}

/** Worked hours inside one 4 a.m.–4 a.m. local operational day, including a shift opened on a prior day. */
export function getOperationalDayShiftHours(week: WeekRecord, date: string, now = new Date()): number {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  if (![year, month, dayOfMonth].every(Number.isFinite)) return 0;
  const start = new Date(year, month - 1, dayOfMonth, OPERATIONAL_DAY_BOUNDARY_HOUR).getTime();
  const endDate = new Date(year, month - 1, dayOfMonth + 1, OPERATIONAL_DAY_BOUNDARY_HOUR);
  const end = endDate.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let hours = 0;

  for (const shift of week.entries.flatMap((entry) => entry.shifts ?? [])) {
    for (const block of getShiftBlocks(shift)) {
      const blockStart = Date.parse(block.startTime);
      const blockEnd = Date.parse(block.endTime ?? (!shift.endTime ? formatLocalTimestamp(now) : ""));
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockEnd <= blockStart) continue;
      hours += Math.max(0, Math.min(end, blockEnd) - Math.max(start, blockStart)) / 3_600_000;
    }
  }

  if (hours > 0) return round(hours);
  const dayEntry = week.entries.find((entry) => entry.date === date);
  return dayEntry && !(dayEntry.shifts?.length) && Number.isFinite(dayEntry.workedHours)
    ? Math.max(0, Number(dayEntry.workedHours))
    : 0;
}

export function createShift(date: string, now = new Date()): ShiftSession {
  const current = new Date(now);
  const id = `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = formatLocalTimestamp(current);
  return {
    id,
    startTime,
    operationalDate: date || startTime.slice(0, 10),
    blocks: [createWorkBlock(id, startTime)],
  };
}

export function createHistoricalShift(date: string): ShiftSession {
  const datePrefix = date || new Date().toISOString().slice(0, 10);
  const id = `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = `${datePrefix}T09:00:00`;
  const endTime = `${datePrefix}T17:00:00`;
  return {
    id,
    startTime,
    endTime,
    operationalDate: datePrefix,
    blocks: [{ ...createWorkBlock(id, startTime), endTime }],
  };
}

export function hasActiveShift(day: DayEntry): boolean {
  return Boolean(day.shifts?.some((shift) => !shift.endTime));
}

export function getActiveShift(day: DayEntry): ShiftSession | null {
  return day.shifts?.find((shift) => !shift.endTime) ?? null;
}

function isSnapshotInsideShift(snapshot: EarningsSnapshot, shift: ShiftSession): boolean {
  const created = Date.parse(snapshot.createdAt);
  const start = Date.parse(shift.startTime);
  const resolvedEnd = resolveLegacyOvernightEnd(shift.startTime, shift.endTime);
  const end = resolvedEnd ? Date.parse(resolvedEnd) : Date.now();
  if (!Number.isFinite(created) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return created >= start && created <= end;
}

function snapshotShiftEarnings(shift: ShiftSession, snapshots: EarningsSnapshot[] = [], attributions: EarningsAttribution[] = [], weeks: WeekRecord[] = []): ShiftEarningsResolution {
  const seen = new Set<string>();
  const reconciled = reconcileEarningsSnapshotDeltas(snapshots).bySnapshotId;
  let total = 0;
  let count = 0;

  const bySnapshot = new Map(attributions.map((item) => [item.snapshotId, item]));
  const relevant = snapshots.filter((snapshot) => {
    if (isRewardApp(snapshot.app)) return false;
    const attribution = bySnapshot.get(snapshot.id);
    const effectiveDay = attribution?.status === "resolved" ? attribution.attributedDayDate : snapshot.dayDate;
    if (attribution) return attribution.status === "resolved" && attribution.shiftId === shift.id;
    if (snapshot.shiftId) return snapshot.shiftId === shift.id;
    if (effectiveDay !== (shift.operationalDate ?? shift.startTime.slice(0, 10))) return false;
    if (weeks.length) return effectiveShiftId(snapshot, undefined, weeks) === shift.id;
    return isSnapshotInsideShift(snapshot, shift);
  });

  for (const snapshot of relevant) {
    const delta = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
    if (delta <= 0) continue;
    const transitionKey = earningsSnapshotTransitionKey(snapshot);
    if (seen.has(transitionKey)) continue;
    seen.add(transitionKey);
    total += delta;
    count += 1;
  }

  if (count <= 0 || total <= 0) return { earnings: null, source: "unavailable", snapshotCount: count };
  return { earnings: round(total), source: "snapshot", snapshotCount: count };
}

export function resolveShiftEarnings(
  day: DayEntry,
  shift: ShiftSession,
  snapshots: EarningsSnapshot[] = [],
  attributions: EarningsAttribution[] = [],
  weeks: WeekRecord[] = [],
): ShiftEarningsResolution {
  const manual = money(shift.earnings);
  if (manual !== null) {
    const reconciled = reconcileEarningsSnapshotDeltas(snapshots).bySnapshotId;
    const attributionBySnapshot = new Map(attributions.map((item) => [item.snapshotId, item]));
    const completedManualTotal = (day.shifts ?? []).filter((item) => item.endTime).reduce<number | null>((sum, item) => {
      const value = money(item.earnings);
      return sum === null || value === null ? null : sum + value;
    }, 0);
    const manualAssignmentsAlreadyReconcileDay = completedManualTotal !== null
      && Math.abs(completedManualTotal - operationalDayTotal(day)) < 0.01;
    const seen = new Set<string>();
    let lateAttributed = 0;
    let snapshotCount = 0;
    for (const snapshot of snapshots) {
      const attribution = attributionBySnapshot.get(snapshot.id);
      if (!attribution || attribution.status !== "resolved" || attribution.shiftId !== shift.id) continue;
      const effectiveDelta = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
      if (effectiveDelta <= 0 || isRewardApp(snapshot.app) || isSnapshotInsideShift(snapshot, shift)) continue;
      if (snapshot.dayDate === day.date && manualAssignmentsAlreadyReconcileDay) continue;
      const key = earningsSnapshotTransitionKey(snapshot);
      if (seen.has(key)) continue;
      seen.add(key);
      lateAttributed += effectiveDelta;
      snapshotCount += 1;
    }
    return {
      earnings: round(manual + lateAttributed),
      source: lateAttributed > 0 ? "snapshot" : "manual",
      snapshotCount: snapshotCount || undefined,
    };
  }

  const fromSnapshots = snapshotShiftEarnings(shift, snapshots, attributions, weeks);
  const completedShiftsForDay = (day.shifts ?? []).filter((item) => item.endTime).length;
  if (completedShiftsForDay === 1) {
    const reconciled = reconcileEarningsSnapshotDeltas(snapshots).bySnapshotId;
    const seen = new Set<string>();
    const effectiveSnapshotTotal = snapshots.reduce((sum, snapshot) => {
      const effectiveDelta = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
      if (snapshot.dayDate !== day.date || effectiveDelta <= 0 || isRewardApp(snapshot.app)) return sum;
      const key = earningsSnapshotTransitionKey(snapshot);
      if (seen.has(key)) return sum;
      seen.add(key);
      return sum + effectiveDelta;
    }, 0);
    const baseline = Math.max(0, operationalDayTotal(day) - effectiveSnapshotTotal);
    const attributed = fromSnapshots.earnings ?? 0;
    const earnings = round(baseline + attributed);
    if (effectiveSnapshotTotal > 0) {
      return earnings > 0
        ? { earnings, source: fromSnapshots.earnings !== null ? "snapshot" : "single-shift-day", snapshotCount: fromSnapshots.snapshotCount }
        : { earnings: null, source: "unavailable", snapshotCount: fromSnapshots.snapshotCount };
    }
    return { earnings: round(operationalDayTotal(day)), source: "single-shift-day" };
  }

  if (fromSnapshots.earnings !== null) return fromSnapshots;

  return { earnings: null, source: "unavailable" };
}

export function resolveShiftRate(
  day: DayEntry,
  shift: ShiftSession,
  snapshots: EarningsSnapshot[] = [],
  attributions: EarningsAttribution[] = [],
  weeks: WeekRecord[] = [],
): { rate: number | null; earnings: number | null; source: ShiftEarningsSource } {
  const hours = shift.endTime ? shiftDurationHours(shift) : activeShiftDurationHours(shift);
  if (hours <= 0) return { rate: null, earnings: null, source: "unavailable" };
  const resolved = resolveShiftEarnings(day, shift, snapshots, attributions, weeks);
  if (resolved.earnings === null) return { rate: null, earnings: null, source: resolved.source };
  return { rate: round(resolved.earnings / hours), earnings: resolved.earnings, source: resolved.source };
}

export type WeeklyGoalOutcome =
  | "money-victory"
  | "discipline-victory"
  | "complete-victory"
  | "elite-week"
  | "building"
  | "unconfigured";

export interface WeeklyGoalClassification {
  outcome: WeeklyGoalOutcome;
  title: string;
  copy: string;
}

export function classifyWeeklyGoalOutcome(args: {
  earnings: number;
  earningsGoal: number;
  hours: number;
  hoursGoal?: number;
}): WeeklyGoalClassification {
  const earningsGoal = Number(args.earningsGoal) || 0;
  const hoursGoal = Number(args.hoursGoal) || 0;
  if (earningsGoal <= 0 && hoursGoal <= 0) {
    return { outcome: "unconfigured", title: "Goals not set", copy: "Set weekly targets to read the week as money, discipline, or complete victory." };
  }
  const moneyDone = earningsGoal > 0 && args.earnings >= earningsGoal;
  const hoursDone = hoursGoal > 0 && args.hours >= hoursGoal;
  const moneyElite = earningsGoal > 0 && args.earnings >= earningsGoal * 1.2;
  const hoursElite = hoursGoal > 0 && args.hours >= hoursGoal * 1.1;

  if (moneyElite && hoursElite) {
    return { outcome: "elite-week", title: "Elite Week", copy: "Elite week. You beat both the target and the commitment." };
  }
  if (moneyDone && hoursDone) {
    return { outcome: "complete-victory", title: "Complete Victory", copy: "Complete week. Money and discipline aligned." };
  }
  if (moneyDone) {
    const hoursEarly = hoursGoal > 0 ? Math.max(0, hoursGoal - args.hours) : 0;
    return {
      outcome: "money-victory",
      title: "Money Victory",
      copy: hoursEarly > 0
        ? `You reached your earnings goal ${round(hoursEarly)}h before the hours target. Everything from now on is bonus territory.`
        : "You reached your earnings goal. Everything from now on is bonus territory.",
    };
  }
  if (hoursDone) {
    return { outcome: "discipline-victory", title: "Discipline Victory", copy: "You showed up. The market did not fully cooperate yet, but your commitment is there." };
  }
  return { outcome: "building", title: "Building Week", copy: "The week is still building. Keep the money target and commitment target separate." };
}

export function endActiveShift(day: DayEntry, now = new Date()): DayEntry {
  const shifts = (day.shifts ?? []).map((shift) => {
    if (shift.endTime) return shift;
    const end = shiftTimestamp(day.date, now);
    const blocks = getShiftBlocks(shift).map((block) => block.endTime ? block : { ...block, endTime: end });
    return { ...shift, endTime: end, blocks };
  });
  return { ...day, shifts };
}

export function pauseActiveShift(day: DayEntry, now = new Date()): DayEntry {
  const pauseTime = shiftTimestamp(day.date, now);
  const shifts = (day.shifts ?? []).map((shift) => {
    if (shift.endTime || isShiftPaused(shift)) return shift;
    const blocks = getShiftBlocks(shift).map((block) => block.endTime ? block : { ...block, endTime: pauseTime });
    return { ...shift, blocks };
  });
  return { ...day, shifts };
}

export function resumePausedShift(day: DayEntry, now = new Date()): DayEntry {
  const resumeTime = shiftTimestamp(day.date, now);
  const shifts = (day.shifts ?? []).map((shift) => {
    if (shift.endTime || !isShiftPaused(shift)) return shift;
    const blocks = getShiftBlocks(shift);
    return { ...shift, blocks: [...blocks, createWorkBlock(shift.id, resumeTime, blocks.length)] };
  });
  return { ...day, shifts };
}

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

function overlapHours(startMs: number, endMs: number, hour: number, date: string): number {
  const bucketStart = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00`);
  const bucketEnd = bucketStart + 3600000;
  const overlap = Math.max(0, Math.min(endMs, bucketEnd) - Math.max(startMs, bucketStart));
  return overlap / 3600000;
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildSnapshotHourMap(segments: ReturnType<typeof buildAttributedHourAmounts>) {
  const hourMap = new Map<number, { earnings: number; observations: number; appTotals: Record<string, number> }>();
  const seenByHour = new Set<string>();
  for (const segment of segments) {
    const hour = segment.hour;
    const current = hourMap.get(hour) ?? { earnings: 0, observations: 0, appTotals: {} };
    current.earnings += segment.amount;
    const observationKey = `${segment.snapshotId}:${hour}`;
    if (!seenByHour.has(observationKey)) current.observations += 1;
    seenByHour.add(observationKey);
    current.appTotals[segment.app] = (current.appTotals[segment.app] || 0) + segment.amount;
    hourMap.set(hour, current);
  }

  return hourMap;
}

export function buildPatternIntelligence(
  weeks: WeekRecord[],
  earningsSnapshots: EarningsSnapshot[] = [],
  earningsAttributions: EarningsAttribution[] = [],
  now = new Date(),
): PatternIntelligence {
  const hourMap = new Map<number, { earnings: number; hours: number; appTotals: Record<string, number> }>();
  let totalHours = 0;
  let completedHours = 0;
  let totalMiles = 0;
  let totalRides = 0;
  let totalShiftEarnings = 0;
  let totalShifts = 0;
  let completedShifts = 0;
  let activeShifts = 0;
  let workDays = 0;
  let multiShiftDays = 0;
  const firstHalf: number[] = [];
  const secondHalf: number[] = [];

  for (const week of weeks) {
    for (const day of week.entries) {
      const shifts = day.shifts ?? [];
      if (!shifts.length) continue;
      workDays += 1;
      if (shifts.length > 1) multiShiftDays += 1;
      const workedHours = getDayShiftHours(day, now);
      const earnings = operationalDayTotal(day);
      const miles = getDayMiles(day);
      const rides = getDayRideCount(day);
      totalMiles += miles;
      totalRides += rides;
      totalShifts += shifts.length;
      activeShifts += shifts.filter((shift) => !shift.endTime).length;
      completedShifts += shifts.filter((shift) => Boolean(shift.endTime)).length;
      completedHours += shifts.filter((shift) => shift.endTime).reduce((sum, shift) => sum + shiftDurationHours(shift), 0);
      if (workedHours <= 0) continue;
      totalHours += workedHours;
      totalShiftEarnings += earnings;

      const sortedShifts = [...shifts].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const completedForDay = sortedShifts.filter((shift) => shift.endTime);
      sortedShifts.forEach((shift) => {
        const duration = shift.endTime ? shiftDurationHours(shift) : activeShiftDurationHours(shift, now);
        if (duration <= 0) return;
        const shiftShare = duration / workedHours;
        const shiftEarnings = earnings * shiftShare;
        if (shift.endTime) {
          const completedIndex = completedForDay.findIndex((candidate) => candidate.id === shift.id);
          if (completedIndex < completedForDay.length / 2) firstHalf.push(shiftEarnings / duration);
          else secondHalf.push(shiftEarnings / duration);
        }

        for (const block of getShiftBlocks(shift)) {
          const startMs = Date.parse(block.startTime);
          const endMs = Date.parse(block.endTime ?? `${localDateKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`);
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
          for (let hour = 0; hour < 24; hour++) {
            const hours = overlapHours(startMs, endMs, hour, day.date);
            if (hours <= 0) continue;
            const current = hourMap.get(hour) ?? { earnings: 0, hours: 0, appTotals: {} };
            current.hours += hours;
            current.earnings += shiftEarnings * (hours / duration);
            for (const [app, value] of Object.entries(day.apps || {})) {
              if (isRewardApp(app)) continue;
              current.appTotals[app] = (current.appTotals[app] || 0) + (Number(value) || 0) * shiftShare * (hours / duration);
            }
            hourMap.set(hour, current);
          }
        }
      });
    }
  }

  const estimatedHourlyHeatmap = Array.from({ length: 24 }, (_, hour) => {
    const value = hourMap.get(hour) ?? { earnings: 0, hours: 0, appTotals: {} };
    return {
      hour,
      label: hourLabel(hour),
      earnings: round(value.earnings),
      hours: round(value.hours),
      earningsPerHour: value.hours > 0 ? round(value.earnings / value.hours) : 0,
    };
  });
  const attributedSegments = buildAttributedHourAmounts({ weeks, snapshots: earningsSnapshots, attributions: earningsAttributions });
  const snapshotHourMap = buildSnapshotHourMap(attributedSegments);
  const snapshotObservationCount = [...snapshotHourMap.values()].reduce((sum, value) => sum + value.observations, 0);
  const hasSnapshotTimingData = snapshotObservationCount > 0;
  const timingSource = hasSnapshotTimingData ? "snapshot" : "estimated";
  const reconciledSnapshotDeltas = reconcileEarningsSnapshotDeltas(earningsSnapshots).bySnapshotId;
  const seenPositive = new Set<string>();
  const positiveSnapshotTotal = earningsSnapshots.reduce((sum, snapshot) => {
    const effectiveDelta = reconciledSnapshotDeltas.get(snapshot.id)?.effectiveDelta ?? 0;
    if (effectiveDelta <= 0 || isRewardApp(snapshot.app)) return sum;
    const key = earningsSnapshotTransitionKey(snapshot);
    if (seenPositive.has(key)) return sum;
    seenPositive.add(key);
    return sum + effectiveDelta;
  }, 0);
  const safeSnapshotIds = new Set(attributedSegments.map((segment) => segment.snapshotId));
  const safeSnapshotTotal = earningsSnapshots.reduce((sum, snapshot) => {
    if (!safeSnapshotIds.has(snapshot.id)) return sum;
    return sum + (reconciledSnapshotDeltas.get(snapshot.id)?.effectiveDelta ?? 0);
  }, 0);
  const legacyBaseline = Math.max(0, totalShiftEarnings - positiveSnapshotTotal);
  const estimatedTotal = [...hourMap.values()].reduce((sum, value) => sum + value.earnings, 0);
  const estimatedScale = estimatedTotal > 0 ? legacyBaseline / estimatedTotal : 0;
  const hourlyHeatmap = hasSnapshotTimingData
    ? Array.from({ length: 24 }, (_, hour) => {
        const value = snapshotHourMap.get(hour) ?? { earnings: 0, observations: 0, appTotals: {} };
        const estimated = hourMap.get(hour) ?? { earnings: 0, hours: 0, appTotals: {} };
        const earnings = value.earnings + estimated.earnings * estimatedScale;
        return {
          hour,
          label: hourLabel(hour),
          earnings: round(earnings),
          hours: round(estimated.hours),
          earningsPerHour: estimated.hours > 0 ? round(earnings / estimated.hours) : 0,
          observations: value.observations,
        };
      })
    : estimatedHourlyHeatmap;
  const workedBuckets = hourlyHeatmap.filter((bucket) => bucket.hours >= 0.5);
  const strongestHours = [...workedBuckets].sort((a, b) => b.earningsPerHour - a.earningsPerHour).slice(0, 3);
  const recoveryWindows = [...workedBuckets].sort((a, b) => a.earningsPerHour - b.earningsPerHour).slice(0, 3);

  const appHourEntries = hasSnapshotTimingData
    ? [...snapshotHourMap.entries()].map(([hour, value]) => [hour, { ...value, hours: value.observations }] as const)
    : [...hourMap.entries()];

  const bestAppsByHour = appHourEntries
    .map(([hour, value]) => {
      const appTotals = value.appTotals as Record<string, number>;
      const best = Object.entries(appTotals).sort((a, b) => b[1] - a[1])[0];
      return best ? { hour, label: hourLabel(hour), app: best[0], earnings: round(best[1]) } : null;
    })
    .filter((item): item is { hour: number; label: string; app: string; earnings: number } => Boolean(item))
    .filter((item) => item.earnings > 0)
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 6);

  const morning = workedBuckets.filter((bucket) => bucket.hour >= 5 && bucket.hour < 12);
  const night = workedBuckets.filter((bucket) => bucket.hour >= 17 || bucket.hour < 2);
  const morningEarnings = morning.reduce((sum, bucket) => sum + bucket.earnings, 0);
  const morningHours = morning.reduce((sum, bucket) => sum + bucket.hours, 0);
  const nightEarnings = night.reduce((sum, bucket) => sum + bucket.earnings, 0);
  const nightHours = night.reduce((sum, bucket) => sum + bucket.hours, 0);
  const morningEph = morningHours ? morningEarnings / morningHours : 0;
  const nightEph = nightHours ? nightEarnings / nightHours : 0;
  const hasMorningNight = morningHours >= 1 && nightHours >= 1;
  const style = !hasMorningNight ? "insufficient" : morningEph > nightEph * 1.15 ? "morning" : nightEph > morningEph * 1.15 ? "night" : "balanced";

  const summary = {
    totalShifts,
    completedShifts,
    activeShifts,
    workDays,
    multiShiftDays,
    totalHours: round(totalHours),
    averageShiftHours: completedShifts > 0 ? round(completedHours / completedShifts) : null,
    totalMiles: round(totalMiles),
    totalRides,
    // This is the weekly operations headline, so it must reconcile to the
    // authoritative operational total shown elsewhere in the app. Snapshot
    // timing only determines hourly ranking detail, never the reported rate.
    earningsPerHour: totalHours > 0 ? round(totalShiftEarnings / totalHours) : null,
    earningsPerMile: totalMiles > 0 ? round(totalShiftEarnings / totalMiles) : null,
    earningsPerRide: totalRides > 0 ? round(totalShiftEarnings / totalRides) : null,
    ridesPerHour: totalHours > 0 && totalRides > 0 ? round(totalRides / totalHours) : null,
    milesPerRide: totalRides > 0 ? round(totalMiles / totalRides) : null,
    minutesPerRide: totalRides > 0 && totalHours > 0 ? round((totalHours * 60) / totalRides) : null,
    milesPerHour: totalHours > 0 ? round(totalMiles / totalHours) : null,
  };

  return {
    summary,
    hourlyHeatmap,
    strongestHours,
    recoveryWindows,
    bestAppsByHour,
    morningVsNight: {
      style,
      morningEarningsPerHour: round(morningEph),
      nightEarningsPerHour: round(nightEph),
      copy: hasSnapshotTimingData
        ? style === "morning"
          ? "Your saved earning updates lean stronger earlier in the day."
          : style === "night"
          ? "Your saved earning updates lean stronger later in the day."
          : style === "balanced"
          ? "Morning and night earning updates look fairly balanced so far."
          : "Save a few more earning updates across the day to compare your operating style."
        : style === "morning"
        ? "Estimated from shift duration: your shifts lean stronger earlier in the day."
        : style === "night"
        ? "Estimated from shift duration: your shifts lean stronger later in the day."
        : style === "balanced"
        ? "Estimated from shift duration: morning and night performance look fairly balanced so far."
        : "Log a few morning and evening shifts to compare your operating style.",
    },
    productivityWindows: strongestHours.map((bucket) => ({
      label: bucket.label,
      earningsPerHour: bucket.earningsPerHour,
      hours: bucket.hours,
    })),
    fatigueNote: firstHalf.length >= 2 && secondHalf.length >= 2 &&
      (secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length) <
        (firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length) * 0.75
      ? "Longer work blocks show some softer output later in the session. Treat it as a pacing signal, not a warning."
      : null,
    hasEnoughShiftData: totalShifts >= 3 && totalHours >= 3,
    hasEnoughTimingData: hasSnapshotTimingData || (totalShifts >= 3 && totalHours >= 3),
    timingSource,
    timingSourceLabel: hasSnapshotTimingData ? "Attributed earnings timing" : "Estimated from shift duration",
    timingCopy: hasSnapshotTimingData
      ? "Based on confirmed or safely estimated earning intervals. Unassigned tips and historical adjustments stay out of hourly rankings until reviewed."
      : "Estimated by spreading operational earnings across completed shift time. Rewards like Octopus still count in totals, but are excluded from timing so efficiency stays work-focused.",
  };
}
