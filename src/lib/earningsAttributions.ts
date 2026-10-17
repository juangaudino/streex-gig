import type { Database } from "@/integrations/supabase/types";
import { isRewardApp, operationalDayTotal } from "./rewardIncome";
import { earningsSnapshotTransitionKey, reconcileEarningsSnapshotDeltas, type ReconciledEarningsSnapshot } from "./earningsSnapshots";
import type {
  DayEntry,
  EarningsAttribution,
  EarningsAttributionIntent,
  EarningsSnapshot,
  ShiftSession,
  WeekRecord,
} from "./types";

type AttributionRow = Database["public"]["Tables"]["earnings_attributions"]["Row"];
type AttributionInsert = Database["public"]["Tables"]["earnings_attributions"]["Insert"];

export interface AttributedHourAmount {
  snapshotId: string;
  app: string;
  dayDate: string;
  shiftId: string;
  hour: number;
  amount: number;
  confidence: "confirmed" | "estimated";
}

export interface AttributionReviewItem {
  snapshot: EarningsSnapshot;
  attribution?: EarningsAttribution;
  reason: "after_shift" | "different_day" | "historical_scale_artifact" | "outside_shift" | "historical_edit" | "unassigned" | "invalid_exact";
  suggestedDayDate?: string;
  suggestedShiftId?: string;
}

const round = (value: number) => Number(value.toFixed(2));

function shiftBlocks(shift: ShiftSession) {
  return shift.blocks?.length
    ? shift.blocks
    : [{ id: `${shift.id}_legacy`, startTime: shift.startTime, endTime: shift.endTime }];
}

export function dbToEarningsAttribution(row: AttributionRow): EarningsAttribution {
  return {
    id: row.id,
    userId: row.user_id,
    snapshotId: row.snapshot_id,
    amount: Number(row.amount),
    status: row.status as EarningsAttribution["status"],
    mode: row.mode as EarningsAttribution["mode"],
    attributedDayDate: row.attributed_day_date,
    shiftId: row.shift_id,
    effectiveStartAt: row.effective_start_at,
    effectiveEndAt: row.effective_end_at,
    source: row.source as EarningsAttribution["source"],
    confidence: row.confidence as EarningsAttribution["confidence"],
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function attributionIntentMatchesSnapshot(intent: EarningsAttributionIntent, snapshot: EarningsSnapshot): boolean {
  return intent.dayDate === snapshot.dayDate
    && intent.app === snapshot.app
    && round(intent.previousAmount) === round(snapshot.previousAmount)
    && round(intent.newAmount) === round(snapshot.newAmount);
}

export function intentToAttributionRow(
  intent: EarningsAttributionIntent,
  snapshot: EarningsSnapshot,
  userId: string,
): AttributionInsert {
  return {
    user_id: userId,
    snapshot_id: snapshot.id,
    amount: Math.max(0.01, round(snapshot.delta)),
    status: intent.status,
    mode: intent.mode,
    attributed_day_date: intent.attributedDayDate ?? null,
    shift_id: intent.shiftId ?? null,
    effective_start_at: intent.effectiveStartAt ?? null,
    effective_end_at: intent.effectiveEndAt ?? null,
    source: intent.source ?? "automatic",
    confidence: intent.confidence,
    note: intent.note ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function attributionToUpdateRow(
  patch: Omit<EarningsAttributionIntent, "dayDate" | "app" | "previousAmount" | "newAmount">,
): Database["public"]["Tables"]["earnings_attributions"]["Update"] {
  return {
    status: patch.status,
    mode: patch.mode,
    attributed_day_date: patch.attributedDayDate ?? null,
    shift_id: patch.shiftId ?? null,
    effective_start_at: patch.effectiveStartAt ?? null,
    effective_end_at: patch.effectiveEndAt ?? null,
    source: patch.source ?? "user",
    confidence: patch.confidence,
    note: patch.note ?? null,
    updated_at: new Date().toISOString(),
  };
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function findDay(weeks: WeekRecord[], date: string): DayEntry | undefined {
  return weeks.flatMap((week) => week.entries).find((day) => day.date === date);
}

function findShift(weeks: WeekRecord[], date: string, shiftId?: string | null): ShiftSession | undefined {
  if (!shiftId) return undefined;
  return findDay(weeks, date)?.shifts?.find((shift) => shift.id === shiftId)
    ?? weeks.flatMap((week) => week.entries).flatMap((day) => day.shifts ?? []).find((shift) => shift.id === shiftId);
}

function hasSuspiciousHistoricalScale(snapshot: EarningsSnapshot, day: DayEntry | undefined): boolean {
  const reported = Number(day?.apps?.[snapshot.app]) || 0;
  if (reported <= 0 || Number(snapshot.newAmount) <= 0) return false;
  const ratio = Number(snapshot.newAmount) / reported;
  return [10, 100, 1000].some((factor) => Math.abs(ratio - factor) < 0.03);
}

function snapshotInsideShift(snapshot: EarningsSnapshot, shift: ShiftSession): boolean {
  const at = Date.parse(snapshot.createdAt);
  const start = Date.parse(shift.startTime);
  const end = Date.parse(shift.endTime ?? shift.startTime);
  return Number.isFinite(at) && Number.isFinite(start) && Number.isFinite(end) && at >= start && at <= end;
}

export function effectiveShiftId(
  snapshot: EarningsSnapshot,
  attribution: EarningsAttribution | undefined,
  weeks: WeekRecord[],
): string | null {
  if (attribution) {
    if (attribution.status !== "resolved") return null;
    return attribution.shiftId ?? null;
  }
  if (snapshot.shiftId && findShift(weeks, snapshot.dayDate, snapshot.shiftId)) return snapshot.shiftId;
  const day = findDay(weeks, snapshot.dayDate);
  const containing = (day?.shifts ?? []).filter((shift) => shift.endTime && snapshotInsideShift(snapshot, shift));
  return containing.length === 1 ? containing[0].id : null;
}

function overlapByHour(startAt: string, endAt: string, shift: ShiftSession): Array<{ hour: number; hours: number }> {
  const rangeStart = Date.parse(startAt);
  const rangeEnd = Date.parse(endAt);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return [];
  const result = new Map<number, number>();
  for (const block of shiftBlocks(shift)) {
    let cursor = Math.max(rangeStart, Date.parse(block.startTime));
    const rawBlockEnd = block.endTime ? Date.parse(block.endTime) : rangeEnd;
    const blockEnd = Math.min(rangeEnd, rawBlockEnd);
    if (!Number.isFinite(cursor) || !Number.isFinite(blockEnd) || blockEnd <= cursor) continue;
    while (cursor < blockEnd) {
      const date = new Date(cursor);
      const hourEnd = new Date(date);
      hourEnd.setMinutes(60, 0, 0);
      const segmentEnd = Math.min(blockEnd, hourEnd.getTime());
      const hour = date.getHours();
      result.set(hour, (result.get(hour) ?? 0) + (segmentEnd - cursor) / 3_600_000);
      cursor = segmentEnd;
    }
  }
  return [...result.entries()].map(([hour, hours]) => ({ hour, hours }));
}

export function isExactTimeInsideWorkedShift(shift: ShiftSession, value: string | Date): boolean {
  if (!shift.endTime) return false;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  const shiftStart = Date.parse(shift.startTime);
  const shiftEnd = Date.parse(shift.endTime);
  if (!Number.isFinite(at) || !Number.isFinite(shiftStart) || !Number.isFinite(shiftEnd) || at < shiftStart || at > shiftEnd) return false;
  return shiftBlocks(shift).some((block) => {
    if (!block.endTime) return false;
    const start = Date.parse(block.startTime);
    const end = Date.parse(block.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && at >= start && at <= end;
  });
}

function previousSafeSnapshot(
  snapshot: EarningsSnapshot,
  allSnapshots: EarningsSnapshot[],
  shiftId: string,
): EarningsSnapshot | undefined {
  return allSnapshots
    .filter((candidate) => candidate.id !== snapshot.id
      && candidate.dayDate === snapshot.dayDate
      && candidate.app === snapshot.app
      && candidate.shiftId === shiftId
      && Date.parse(candidate.createdAt) < Date.parse(snapshot.createdAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function attributedHoursForSnapshot(args: {
  snapshot: EarningsSnapshot;
  attribution?: EarningsAttribution;
  weeks: WeekRecord[];
  snapshots: EarningsSnapshot[];
  reconciledDeltas?: Map<string, ReconciledEarningsSnapshot>;
}): AttributedHourAmount[] {
  const { snapshot, attribution, weeks, snapshots, reconciledDeltas } = args;
  const reconciled = reconciledDeltas ?? reconcileEarningsSnapshotDeltas(snapshots).bySnapshotId;
  const effectiveDelta = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
  if (effectiveDelta <= 0 || isRewardApp(snapshot.app)) return [];
  const shiftId = effectiveShiftId(snapshot, attribution, weeks);
  if (!shiftId) return [];
  const dayDate = attribution?.attributedDayDate ?? snapshot.dayDate;
  const shift = findShift(weeks, dayDate, shiftId);
  if (!shift) return [];
  const activeUpdateInterval = !shift.endTime
    && attribution?.status === "resolved"
    && attribution.mode === "update_interval"
    && Boolean(attribution.effectiveEndAt);
  if (!shift.endTime && !activeUpdateInterval) return [];

  if (attribution?.status === "resolved" && attribution.mode === "exact" && attribution.effectiveStartAt) {
    if (!isExactTimeInsideWorkedShift(shift, attribution.effectiveStartAt)) return [];
    const at = new Date(attribution.effectiveStartAt);
    if (Number.isNaN(at.getTime())) return [];
    return [{ snapshotId: snapshot.id, app: snapshot.app, dayDate, shiftId, hour: at.getHours(), amount: round(effectiveDelta), confidence: "confirmed" }];
  }

  let startAt = shift.startTime;
  let endAt = shift.endTime ?? snapshot.createdAt;
  let confidence: "confirmed" | "estimated" = "estimated";
  if (attribution?.status === "resolved") {
    if (attribution.mode === "day_only" || attribution.mode === "unassigned") return [];
    startAt = attribution.effectiveStartAt ?? shift.startTime;
    endAt = attribution.effectiveEndAt ?? shift.endTime;
    confidence = attribution.confidence === "confirmed" ? "confirmed" : "estimated";
  } else {
    const previous = previousSafeSnapshot(snapshot, snapshots, shiftId);
    startAt = previous?.createdAt ?? shift.startTime;
    endAt = snapshot.createdAt;
  }

  let overlaps = overlapByHour(startAt, endAt, shift);
  if (!overlaps.length && attribution?.mode === "shift_distributed") {
    overlaps = overlapByHour(shift.startTime, shift.endTime, shift);
  }
  const totalHours = overlaps.reduce((sum, item) => sum + item.hours, 0);
  if (totalHours <= 0) return [];
  // Attribution rows preserve the original positive transition for audit.
  // Use the reconciled amount for analytics so a correction recovery cannot
  // become a second earned interval.
  const amount = effectiveDelta;
  return overlaps.map((item) => ({
    snapshotId: snapshot.id,
    app: snapshot.app,
    dayDate,
    shiftId,
    hour: item.hour,
    amount: round(amount * (item.hours / totalHours)),
    confidence,
  }));
}

export function resolveDayPerformanceEarnings(args: {
  day: DayEntry;
  weeks: WeekRecord[];
  snapshots?: EarningsSnapshot[];
  attributions?: EarningsAttribution[];
  attributedSegments?: AttributedHourAmount[];
}): { earnings: number; reportedOperationalEarnings: number; excludedFromEfficiency: number } {
  const snapshots = args.snapshots ?? [];
  const attributions = args.attributions ?? [];
  const reconciled = reconcileEarningsSnapshotDeltas(snapshots).bySnapshotId;
  const seenObserved = new Set<string>();
  const observedPositive = snapshots.reduce((sum, snapshot) => {
    const effectiveDelta = reconciled.get(snapshot.id)?.effectiveDelta ?? 0;
    if (snapshot.dayDate !== args.day.date || effectiveDelta <= 0 || isRewardApp(snapshot.app)) return sum;
    const key = earningsSnapshotTransitionKey(snapshot);
    if (seenObserved.has(key)) return sum;
    seenObserved.add(key);
    return sum + effectiveDelta;
  }, 0);
  const attributedSegments = args.attributedSegments ?? buildAttributedHourAmounts({ weeks: args.weeks, snapshots, attributions });
  const safeSnapshotIds = new Set(
    attributedSegments.filter((segment) => segment.dayDate === args.day.date).map((segment) => segment.snapshotId),
  );
  const safeAttributed = snapshots.reduce((sum, snapshot) => {
    if (!safeSnapshotIds.has(snapshot.id)) return sum;
    return sum + (reconciled.get(snapshot.id)?.effectiveDelta ?? 0);
  }, 0);
  const reportedOperationalEarnings = operationalDayTotal(args.day);
  const legacyBaseline = Math.max(0, reportedOperationalEarnings - observedPositive);
  const earnings = round(legacyBaseline + safeAttributed);
  return {
    earnings,
    reportedOperationalEarnings: round(reportedOperationalEarnings),
    excludedFromEfficiency: round(Math.max(0, reportedOperationalEarnings - earnings)),
  };
}

export function buildAttributedHourAmounts(args: {
  weeks: WeekRecord[];
  snapshots: EarningsSnapshot[];
  attributions?: EarningsAttribution[];
}): AttributedHourAmount[] {
  const bySnapshot = new Map((args.attributions ?? []).map((item) => [item.snapshotId, item]));
  const reconciledDeltas = reconcileEarningsSnapshotDeltas(args.snapshots).bySnapshotId;
  const seen = new Set<string>();
  return args.snapshots.flatMap((snapshot) => {
    const transition = earningsSnapshotTransitionKey(snapshot);
    if (seen.has(transition)) return [];
    seen.add(transition);
    return attributedHoursForSnapshot({
      snapshot,
      attribution: bySnapshot.get(snapshot.id),
      weeks: args.weeks,
      snapshots: args.snapshots,
      reconciledDeltas,
    });
  });
}

export function buildAttributionReviewItems(args: {
  weeks: WeekRecord[];
  snapshots: EarningsSnapshot[];
  attributions?: EarningsAttribution[];
}): AttributionReviewItem[] {
  const bySnapshot = new Map((args.attributions ?? []).map((item) => [item.snapshotId, item]));
  return args.snapshots.flatMap((snapshot) => {
    if (Number(snapshot.delta) <= 0 || isRewardApp(snapshot.app)) return [];
    const attribution = bySnapshot.get(snapshot.id);
    if (attribution?.status === "excluded") return [];
    if (attribution?.status === "resolved") {
      const attributedDayDate = attribution.attributedDayDate ?? snapshot.dayDate;
      const attributedShift = findShift(args.weeks, attributedDayDate, attribution.shiftId);
      const invalidExact = attribution.mode === "exact"
        && (!attributedShift || !attribution.effectiveStartAt || !isExactTimeInsideWorkedShift(attributedShift, attribution.effectiveStartAt));
      if (!invalidExact) return [];
      return [{
        snapshot,
        attribution,
        reason: "invalid_exact",
        suggestedDayDate: attributedDayDate,
        suggestedShiftId: attributedShift?.id,
      }];
    }
    const observed = new Date(snapshot.createdAt);
    const day = findDay(args.weeks, snapshot.dayDate);
    const completed = (day?.shifts ?? []).filter((shift) => shift.endTime);
    const containing = completed.filter((shift) => snapshotInsideShift(snapshot, shift));
    if (snapshot.shiftId || containing.length === 1) return [];
    const lastShift = [...completed].sort((a, b) => (b.endTime ?? "").localeCompare(a.endTime ?? ""))[0];
    const sameDay = !Number.isNaN(observed.getTime()) && localDateKey(observed) === snapshot.dayDate;
    const afterShift = sameDay && lastShift?.endTime && Date.parse(snapshot.createdAt) > Date.parse(lastShift.endTime);
    const suspiciousScale = hasSuspiciousHistoricalScale(snapshot, day);
    const reason: AttributionReviewItem["reason"] = suspiciousScale
      ? "historical_scale_artifact"
      : !sameDay
      ? "different_day"
      : afterShift
        ? "after_shift"
        : completed.length === 0
          ? "historical_edit"
          : "outside_shift";
    return [{
      snapshot,
      attribution,
      reason,
      suggestedDayDate: snapshot.dayDate,
      suggestedShiftId: sameDay && !suspiciousScale && completed.length === 1 ? completed[0].id : undefined,
    }];
  }).sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt));
}
