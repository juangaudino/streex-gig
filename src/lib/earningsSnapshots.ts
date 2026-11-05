import type { DayEntry, EarningsSnapshot, WeekRecord } from "./types";
import { earningsSnapshotTransitionKey } from "../../supabase/functions/_shared/snapshotReconciliation";
export { earningsSnapshotTransitionKey, reconcileEarningsSnapshotDeltas } from "../../supabase/functions/_shared/snapshotReconciliation";
export type { ReconciledEarningsSnapshot, SnapshotCorrectionSummary } from "../../supabase/functions/_shared/snapshotReconciliation";

export interface EarningsSnapshotInsert {
  user_id: string;
  week_id: string;
  day_date: string;
  app: string;
  previous_amount: number;
  new_amount: number;
  delta: number;
  shift_id?: string | null;
  event_key: string;
}

function money(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return +parsed.toFixed(2);
}

function activeShiftId(day: DayEntry): string | null {
  return day.shifts?.find((shift) => !shift.endTime)?.id ?? null;
}

export function dbToEarningsSnapshot(row: {
  id: string;
  user_id: string;
  week_id: string;
  day_date: string;
  app: string;
  previous_amount: number;
  new_amount: number;
  delta: number;
  shift_id: string | null;
  created_at: string;
}): EarningsSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    weekId: row.week_id,
    dayDate: row.day_date,
    app: row.app,
    previousAmount: Number(row.previous_amount),
    newAmount: Number(row.new_amount),
    delta: Number(row.delta),
    shiftId: row.shift_id,
    createdAt: row.created_at,
  };
}

export function buildEarningsSnapshotRows(params: {
  userId: string;
  previousWeek?: WeekRecord | null;
  nextWeek: WeekRecord;
  sourceRevision?: string;
}): EarningsSnapshotInsert[] {
  const { userId, previousWeek, nextWeek } = params;
  if (!previousWeek) return [];

  const previousDays = new Map(previousWeek.entries.map((day) => [day.date, day]));
  const rows: EarningsSnapshotInsert[] = [];

  for (const nextDay of nextWeek.entries) {
    const previousDay = previousDays.get(nextDay.date);
    if (!previousDay) continue;

    const apps = new Set([
      ...Object.keys(previousDay.apps ?? {}),
      ...Object.keys(nextDay.apps ?? {}),
    ]);

    for (const app of apps) {
      const previousAmount = money(previousDay.apps?.[app]);
      const newAmount = money(nextDay.apps?.[app]);
      const delta = money(newAmount - previousAmount);
      if (Math.abs(delta) < 0.01) continue;

      const transition = {
        user_id: userId,
        week_id: nextWeek.id,
        day_date: nextDay.date,
        app,
        previous_amount: previousAmount,
        new_amount: newAmount,
        delta,
        shift_id: activeShiftId(nextDay),
      };
      rows.push({
        ...transition,
        // A week revision identifies one logical save. Concurrent/retried
        // saves of that revision share a key, while a later correction cycle
        // receives a new revision and remains a legitimate new observation.
        event_key: `${params.sourceRevision ?? previousWeek.updatedAt}|${earningsSnapshotTransitionKey(transition)}`,
      });
    }
  }

  return rows;
}
