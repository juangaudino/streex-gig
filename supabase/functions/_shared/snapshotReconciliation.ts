/** Canonical reconciliation for accumulated earnings updates. */
export interface SnapshotForReconciliation {
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

export interface ReconciledEarningsSnapshot {
  snapshotId: string;
  rawDelta: number;
  effectiveDelta: number;
  recoveryAmount: number;
}

export interface SnapshotCorrectionSummary {
  key: string;
  snapshotIds: string[];
  recoveredAmount: number;
  outstandingAmount: number;
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? +parsed.toFixed(2) : 0;
}

export function earningsSnapshotTransitionKey(snapshot: {
  user_id?: string; userId?: string; week_id?: string; weekId?: string;
  day_date?: string; dayDate?: string; app: string;
  previous_amount?: number; previousAmount?: number; new_amount?: number; newAmount?: number;
  delta: number; shift_id?: string | null; shiftId?: string | null;
}): string {
  return [snapshot.user_id ?? snapshot.userId ?? "", snapshot.week_id ?? snapshot.weekId ?? "",
    snapshot.day_date ?? snapshot.dayDate ?? "", snapshot.app,
    money(snapshot.previous_amount ?? snapshot.previousAmount), money(snapshot.new_amount ?? snapshot.newAmount),
    money(snapshot.delta), snapshot.shift_id ?? snapshot.shiftId ?? ""].join("|");
}

export function reconcileEarningsSnapshotDeltas<T extends SnapshotForReconciliation>(snapshots: T[]): {
  bySnapshotId: Map<string, ReconciledEarningsSnapshot>;
  corrections: SnapshotCorrectionSummary[];
} {
  const bySnapshotId = new Map<string, ReconciledEarningsSnapshot>();
  const grouped = new Map<string, T[]>();
  const seenTransitions = new Set<string>();
  for (const snapshot of snapshots) {
    const transition = earningsSnapshotTransitionKey(snapshot);
    if (seenTransitions.has(transition)) continue;
    seenTransitions.add(transition);
    const key = [snapshot.userId, snapshot.weekId, snapshot.dayDate, snapshot.app].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot]);
  }
  const corrections: SnapshotCorrectionSummary[] = [];
  for (const [key, group] of grouped) {
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let correctionDebt = 0;
    let recoveredAmount = 0;
    const snapshotIds: string[] = [];
    for (const snapshot of ordered) {
      const rawDelta = money(snapshot.delta);
      snapshotIds.push(snapshot.id);
      if (rawDelta < 0) {
        correctionDebt += Math.abs(rawDelta);
        bySnapshotId.set(snapshot.id, { snapshotId: snapshot.id, rawDelta, effectiveDelta: 0, recoveryAmount: 0 });
        continue;
      }
      const recoveryAmount = Math.min(correctionDebt, rawDelta);
      correctionDebt = money(correctionDebt - recoveryAmount);
      recoveredAmount = money(recoveredAmount + recoveryAmount);
      bySnapshotId.set(snapshot.id, { snapshotId: snapshot.id, rawDelta, effectiveDelta: money(rawDelta - recoveryAmount), recoveryAmount });
    }
    if (recoveredAmount > 0 || correctionDebt > 0) {
      corrections.push({ key, snapshotIds, recoveredAmount, outstandingAmount: correctionDebt });
    }
  }
  return { bySnapshotId, corrections };
}

/** Preserve the unobserved historical baseline; include only safely attributed updates. */
export function calculateDayPerformanceTotals(reportedOperationalEarnings: number, observedPositive: number, safeAttributed: number) {
  const baseline = Math.max(0, reportedOperationalEarnings - observedPositive);
  const earnings = money(baseline + safeAttributed);
  return {
    earnings,
    reportedOperationalEarnings: money(reportedOperationalEarnings),
    excludedFromEfficiency: money(Math.max(0, reportedOperationalEarnings - earnings)),
  };
}
