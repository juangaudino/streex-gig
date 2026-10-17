export const DEFAULT_APPS = [
  "Uber",
  "Lyft",
  "Spark Driver",
  "DoorDash",
  "Amazon Flex",
  "Instacart",
  "Shipt",
] as const;

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type DayName = (typeof DAY_NAMES)[number];

export interface ShiftWorkBlock {
  id: string;
  startTime: string;
  endTime?: string;
}

export interface ShiftSession {
  id: string;
  startTime: string;
  endTime?: string;
  /** Business date used for the shift's opening day; day rolls over at 4 a.m. local time. */
  operationalDate?: string;
  blocks?: ShiftWorkBlock[];
  earnings?: number;
  miles?: number;
  rideCount?: number;
  /** Accumulated ride/delivery counts by app for this shift. */
  ridesByApp?: Record<string, number>;
  /** Preserved total from before app attribution existed. */
  legacyRideCount?: number;
  note?: string;
}

export interface BonusEntry {
  id: string;
  app: string;
  amount: number;
  createdAt?: string;
  source?: "manual" | "legacy_octopus";
}

export interface DayEntry {
  dayName: DayName;
  date: string;
  apps: Record<string, number>;
  bonuses?: BonusEntry[];
  logged?: boolean;
  /** Day finalized via "End Day". Distinct from `logged` (which auto-flags on any earnings entry). */
  dayClosed?: boolean;
  shifts?: ShiftSession[];
  /** Reliable day-level worked hours when no precise shift boundaries exist (usually historical imports). */
  workedHours?: number;
  /** Day-level ride total used only when no shift-level ride counts exist. */
  rideCount?: number;
  mileage?: number;
  notes?: string;
}

export interface WeekRecord {
  id: string;
  startDate: string;
  endDate: string;
  weeklyGoal: number;
  weeklyHoursGoal?: number;
  status: "open" | "closed";
  entries: DayEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface EarningsSnapshot {
  id: string;
  userId: string;
  weekId: string;
  dayDate: string;
  app: string;
  previousAmount: number;
  newAmount: number;
  delta: number;
  shiftId?: string | null;
  createdAt: string;
}

export type EarningsAttributionStatus = "pending" | "resolved" | "excluded";
export type EarningsAttributionMode = "exact" | "update_interval" | "shift_distributed" | "day_only" | "unassigned";
export type EarningsAttributionConfidence = "confirmed" | "estimated" | "unassigned";

export interface EarningsAttribution {
  id: string;
  userId: string;
  snapshotId: string;
  amount: number;
  status: EarningsAttributionStatus;
  mode: EarningsAttributionMode;
  attributedDayDate?: string | null;
  shiftId?: string | null;
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  source: "automatic" | "user" | "retroactive";
  confidence: EarningsAttributionConfidence;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EarningsAttributionIntent {
  dayDate: string;
  app: string;
  previousAmount: number;
  newAmount: number;
  mode: EarningsAttributionMode;
  attributedDayDate?: string | null;
  shiftId?: string | null;
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  source?: "automatic" | "user" | "retroactive";
  confidence: EarningsAttributionConfidence;
  status: EarningsAttributionStatus;
  note?: string | null;
}

export interface OperationalSnapshot {
  id: string;
  userId: string;
  weekId: string;
  dayDate: string;
  shiftId?: string | null;
  recordedAt: string;
  appTotals: Record<string, number>;
  ridesByApp: Record<string, number>;
  dayMileage: number;
  source: "quick_update";
  eventKey: string;
}

export interface OperationalSnapshotDraft {
  eventKey: string;
  dayDate: string;
  shiftId?: string | null;
  recordedAt: string;
  appTotals: Record<string, number>;
  ridesByApp: Record<string, number>;
  dayMileage: number;
}

export type RideCaptureStatus = "captured" | "unavailable" | "denied" | "stale" | "imprecise";
export type RideAccuracyClass = "high" | "usable";

export interface RideEvent {
  id: string;
  userId: string;
  weekId: string;
  dayDate: string;
  shiftId?: string | null;
  app?: string | null;
  status: "active" | "completed" | "linked_single" | "linked_batch" | "cancelled";
  startedAt: string;
  endedAt?: string | null;
  /** v1 events began at pickup; v2 events begin when the driver accepts and records pickup separately. */
  lifecycleVersion?: 1 | 2;
  startZoneKey?: string | null;
  endZoneKey?: string | null;
  pickupAt?: string | null;
  pickupZoneKey?: string | null;
  startCaptureStatus: RideCaptureStatus;
  endCaptureStatus: RideCaptureStatus;
  pickupCaptureStatus?: RideCaptureStatus;
  startAccuracyClass?: RideAccuracyClass | null;
  endAccuracyClass?: RideAccuracyClass | null;
  pickupAccuracyClass?: RideAccuracyClass | null;
  /** Browser IANA time zone captured for future aggregate operating-window analysis. */
  timeZone?: string | null;
  source: "foreground_browser" | "manual_after_shift";
}

export interface RideUpdateBatch {
  id: string;
  userId: string;
  app: string;
  kind: "single" | "batch";
  earningsSnapshotId: string;
  operationalEventKey?: string | null;
  createdAt: string;
}

export interface RideUpdateBatchEvent {
  batchId: string;
  rideEventId: string;
}

export interface RidePayment {
  id: string;
  userId: string;
  rideEventId: string;
  earningsSnapshotId: string;
  kind: "manual_base" | "late_tip" | "adjustment";
  observedAt: string;
  createdAt: string;
}

/** A portion of an immutable observed snapshot. It can be revised without changing the snapshot or daily total. */
export type RideSnapshotAllocationKind = "ride_base" | "late_tip" | "adjustment" | "update_interval" | "unassigned";

export interface RideSnapshotAllocation {
  id: string;
  userId: string;
  earningsSnapshotId: string;
  rideEventId?: string | null;
  allocationSetId: string;
  kind: RideSnapshotAllocationKind;
  amount: number;
  observedAt: string;
  attributedDayDate?: string | null;
  shiftId?: string | null;
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  note?: string | null;
  isCurrent: boolean;
  replacedAt?: string | null;
  createdAt: string;
}

export interface RideSnapshotAllocationDraft {
  rideEventId?: string | null;
  kind: RideSnapshotAllocationKind;
  amount: number;
  observedAt: string;
  attributedDayDate?: string | null;
  shiftId?: string | null;
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  note?: string | null;
}

/** A revisioned, owner-confirmed split of a historical/manual daily app total. */
export type ManualRideAllocationKind = "ride_base" | "unassigned";

export interface ManualRideAllocation {
  id: string;
  userId: string;
  weekId: string;
  dayDate: string;
  app: string;
  rideEventId?: string | null;
  allocationSetId: string;
  kind: ManualRideAllocationKind;
  amount: number;
  sourceTotal: number;
  note?: string | null;
  isCurrent: boolean;
  replacedAt?: string | null;
  createdAt: string;
}

export interface ManualRideAllocationDraft {
  rideEventId?: string | null;
  kind: ManualRideAllocationKind;
  amount: number;
  note?: string | null;
}

export interface ZoneLabel {
  id: string;
  userId: string;
  zoneKey: string;
  label: string;
  source: "user" | "suggested";
  createdAt: string;
  updatedAt: string;
}

export interface RideCaptureResult {
  zoneKey?: string | null;
  status: RideCaptureStatus;
  accuracyClass?: RideAccuracyClass | null;
}

export interface AppSettings {
  defaultWeeklyGoal: number;
  defaultWeeklyHoursGoal?: number;
  currencySymbol: string;
  activeApps: string[];
  octopusPoints: number;
  octopusUpdatedAt?: string;
}
