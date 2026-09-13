/**
 * Canonical daily operational calculations shared by read-only Edge Functions.
 * These rules mirror Ask My Data's week normalization: reported earnings keep
 * rewards/bonuses, while operational earnings exclude the Octopus reward app.
 */

export interface DailyOpsDay {
  date?: string;
  apps?: Record<string, number>;
  bonuses?: { app: string; amount: number }[];
  shifts?: {
    startTime: string;
    endTime?: string;
    miles?: number;
    rideCount?: number;
  }[];
  mileage?: number;
}

export function isBonusApp(app: string): boolean {
  return app.trim().toLowerCase() === "octopus";
}

export function bonusDayTotal(day: DailyOpsDay): number {
  const manualBonuses = (day.bonuses ?? []).reduce(
    (sum, bonus) => sum + Math.max(0, Number(bonus.amount) || 0),
    0,
  );
  const legacyBonusApps = Object.entries(day.apps ?? {}).reduce(
    (sum, [app, value]) => sum + (isBonusApp(app) ? Math.max(0, Number(value) || 0) : 0),
    0,
  );
  return manualBonuses + legacyBonusApps;
}

export function appBonusTotal(day: DailyOpsDay, app: string): number {
  const target = app.trim().toLowerCase();
  return (day.bonuses ?? []).reduce(
    (sum, bonus) => sum + (bonus.app.trim().toLowerCase() === target ? Math.max(0, Number(bonus.amount) || 0) : 0),
    0,
  );
}

export function operationalDayTotal(day: DailyOpsDay): number {
  return Object.entries(day.apps ?? {}).reduce(
    (sum, [app, value]) => sum + (isBonusApp(app) ? 0 : Math.max(0, Number(value) || 0)),
    0,
  );
}

export function dayTotal(day: DailyOpsDay): number {
  return operationalDayTotal(day) + bonusDayTotal(day);
}

export function round(value: number): number {
  return +value.toFixed(2);
}

export function shiftDurationHours(shift: NonNullable<DailyOpsDay["shifts"]>[number]): number {
  if (!shift.endTime) return 0;
  const start = Date.parse(shift.startTime);
  const end = Date.parse(shift.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3_600_000;
}

export function dayShiftStats(day: DailyOpsDay) {
  const shifts = day.shifts ?? [];
  const totalHours = shifts.reduce((sum, shift) => sum + shiftDurationHours(shift), 0);
  const totalRides = shifts.reduce((sum, shift) => sum + Math.max(0, Math.trunc(Number(shift.rideCount) || 0)), 0);
  const shiftMiles = shifts.reduce((sum, shift) => sum + (Number(shift.miles) || 0), 0);

  return {
    hours: round(totalHours),
    rides: totalRides,
    miles: round(shiftMiles || Number(day.mileage) || 0),
    completedShifts: shifts.filter((shift) => Boolean(shift.endTime)).length,
    activeShifts: shifts.filter((shift) => !shift.endTime).length,
  };
}

export function parseEntries<T>(entries: T[] | string | null | undefined): T[] {
  if (Array.isArray(entries)) return entries;
  if (!entries) return [];
  try {
    const parsed: unknown = JSON.parse(entries);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function normalizeAppTotals(day: DailyOpsDay): Record<string, number> {
  const totals = new Map<string, number>();
  for (const [app, value] of Object.entries(day.apps ?? {})) {
    const key = app.trim().toLowerCase();
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + (Number(value) || 0) + appBonusTotal(day, app));
  }
  for (const bonus of day.bonuses ?? []) {
    const key = bonus.app.trim().toLowerCase();
    if (!key || Object.prototype.hasOwnProperty.call(day.apps ?? {}, bonus.app)) continue;
    totals.set(key, (totals.get(key) ?? 0) + (Number(bonus.amount) || 0));
  }
  return Object.fromEntries([...totals.entries()].map(([app, value]) => [app, round(value)]));
}
