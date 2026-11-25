import { useState, useCallback, useEffect } from "react";
import { WeekRecord, AppSettings, DEFAULT_APPS, DayEntry, EarningsSnapshot, OperationalSnapshot, OperationalSnapshotDraft, EarningsAttribution, EarningsAttributionIntent, RideCaptureResult, RideEvent, RidePayment, RideSnapshotAllocation, RideSnapshotAllocationDraft, ManualRideAllocation, ManualRideAllocationDraft, RideUpdateBatch, RideUpdateBatchEvent, ZoneLabel } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { getWeeks as getLocalWeeks } from "@/lib/store";
import { lifecycleDebug } from "@/lib/appLifecycle";
import { buildEarningsSnapshotRows, dbToEarningsSnapshot, earningsSnapshotTransitionKey } from "@/lib/earningsSnapshots";
import { normalizeLegacyBonusWeek } from "@/lib/rewardIncome";
import { inspectWeekIntegrity, parseWeekRecord } from "@/lib/weekIntegrity";
import { loadWeekRevisions, restoreWeekRevision, saveWeekWithRevision, type WeekRevision } from "@/lib/weekRevisions";
import type { Database, Json } from "@/integrations/supabase/types";
import { dbToOperationalSnapshot, operationalDraftToRow } from "@/lib/operationalSnapshots";
import { attributionIntentMatchesSnapshot, attributionToUpdateRow, dbToEarningsAttribution, intentToAttributionRow } from "@/lib/earningsAttributions";
import { dbToRideEvent, loadRideEventPages } from "@/lib/movementCapture";

const DEFAULT_SETTINGS: AppSettings = {
  defaultWeeklyGoal: 1200,
  defaultWeeklyHoursGoal: 0,
  currencySymbol: "$",
  activeApps: [...DEFAULT_APPS],
  octopusPoints: 0,
};

interface WeekStoreSnapshot {
  weeks: WeekRecord[];
  settings: AppSettings;
  earningsSnapshots: EarningsSnapshot[];
  operationalSnapshots: OperationalSnapshot[];
  earningsAttributions: EarningsAttribution[];
  rideEvents?: RideEvent[];
  rideUpdateBatches?: RideUpdateBatch[];
  rideUpdateBatchEvents?: RideUpdateBatchEvent[];
  ridePayments?: RidePayment[];
  rideSnapshotAllocations?: RideSnapshotAllocation[];
  manualRideAllocations?: ManualRideAllocation[];
  zoneLabels?: ZoneLabel[];
  hasLocalData: boolean;
}

const storeCache = new Map<string, WeekStoreSnapshot>();
const pendingSnapshotKeys = new Set<string>();
type WeekRow = Database["public"]["Tables"]["weeks"]["Row"];

function dbToRideUpdateBatch(row: Database["public"]["Tables"]["ride_update_batches"]["Row"]): RideUpdateBatch {
  return {
    id: row.id, userId: row.user_id, app: row.app, kind: row.kind as RideUpdateBatch["kind"],
    earningsSnapshotId: row.earnings_snapshot_id, operationalEventKey: row.operational_event_key, createdAt: row.created_at,
  };
}

function dbToRideUpdateBatchEvent(row: Database["public"]["Tables"]["ride_update_batch_events"]["Row"]): RideUpdateBatchEvent {
  return { batchId: row.batch_id, rideEventId: row.ride_event_id };
}

function dbToRidePayment(row: Database["public"]["Tables"]["ride_payments"]["Row"]): RidePayment {
  return {
    id: row.id, userId: row.user_id, rideEventId: row.ride_event_id, earningsSnapshotId: row.earnings_snapshot_id,
    kind: row.kind as RidePayment["kind"], observedAt: row.observed_at, createdAt: row.created_at,
  };
}

function dbToRideSnapshotAllocation(row: Database["public"]["Tables"]["earnings_snapshot_allocations"]["Row"]): RideSnapshotAllocation {
  return {
    id: row.id, userId: row.user_id, earningsSnapshotId: row.earnings_snapshot_id, rideEventId: row.ride_event_id,
    allocationSetId: row.allocation_set_id, kind: row.kind as RideSnapshotAllocation["kind"], amount: Number(row.amount),
    observedAt: row.observed_at, attributedDayDate: row.attributed_day_date, shiftId: row.shift_id,
    effectiveStartAt: row.effective_start_at, effectiveEndAt: row.effective_end_at, note: row.note,
    isCurrent: row.is_current, replacedAt: row.replaced_at, createdAt: row.created_at,
  };
}

function dbToManualRideAllocation(row: Database["public"]["Tables"]["manual_ride_allocations"]["Row"]): ManualRideAllocation {
  return {
    id: row.id, userId: row.user_id, weekId: row.week_id, dayDate: row.day_date, app: row.app,
    rideEventId: row.ride_event_id, allocationSetId: row.allocation_set_id,
    kind: row.kind as ManualRideAllocation["kind"], amount: Number(row.amount), sourceTotal: Number(row.source_total),
    note: row.note, isCurrent: row.is_current, replacedAt: row.replaced_at, createdAt: row.created_at,
  };
}

function dbToZoneLabel(row: Database["public"]["Tables"]["user_zone_labels"]["Row"]): ZoneLabel {
  return { id: row.id, userId: row.user_id, zoneKey: row.zone_key, label: row.label, source: row.source as ZoneLabel["source"], createdAt: row.created_at, updatedAt: row.updated_at };
}

function dbToWeek(row: WeekRow): WeekRecord {
  const week = parseWeekRecord(normalizeLegacyBonusWeek({
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    weeklyGoal: Number(row.weekly_goal),
    weeklyHoursGoal: Number(row.weekly_hours_goal ?? 0),
    status: row.status as "open" | "closed",
    entries: (typeof row.entries === "string" ? JSON.parse(row.entries) : row.entries) as DayEntry[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const integrityIssues = inspectWeekIntegrity(week);
  if (integrityIssues.length) {
    console.warn("[weeks.integrity] semantic inconsistencies detected", {
      weekId: week.id,
      issues: integrityIssues.map(({ severity, code, path }) => ({ severity, code, path })),
    });
  }
  return week;
}

export function useWeekStore(user: User | null) {
  const cachedStore = user ? storeCache.get(user.id) : undefined;
  const [weeks, setWeeks] = useState<WeekRecord[]>(() => cachedStore?.weeks ?? []);
  const [settings, setSettingsState] = useState<AppSettings>(() => cachedStore?.settings ?? DEFAULT_SETTINGS);
  const [earningsSnapshots, setEarningsSnapshots] = useState<EarningsSnapshot[]>(() => cachedStore?.earningsSnapshots ?? []);
  const [operationalSnapshots, setOperationalSnapshots] = useState<OperationalSnapshot[]>(() => cachedStore?.operationalSnapshots ?? []);
  const [earningsAttributions, setEarningsAttributions] = useState<EarningsAttribution[]>(() => cachedStore?.earningsAttributions ?? []);
  const [rideEvents, setRideEvents] = useState<RideEvent[]>(() => cachedStore?.rideEvents ?? []);
  const [rideUpdateBatches, setRideUpdateBatches] = useState<RideUpdateBatch[]>(() => cachedStore?.rideUpdateBatches ?? []);
  const [rideUpdateBatchEvents, setRideUpdateBatchEvents] = useState<RideUpdateBatchEvent[]>(() => cachedStore?.rideUpdateBatchEvents ?? []);
  const [ridePayments, setRidePayments] = useState<RidePayment[]>(() => cachedStore?.ridePayments ?? []);
  const [rideSnapshotAllocations, setRideSnapshotAllocations] = useState<RideSnapshotAllocation[]>(() => cachedStore?.rideSnapshotAllocations ?? []);
  const [manualRideAllocations, setManualRideAllocations] = useState<ManualRideAllocation[]>(() => cachedStore?.manualRideAllocations ?? []);
  const [zoneLabels, setZoneLabels] = useState<ZoneLabel[]>(() => cachedStore?.zoneLabels ?? []);
  const [loading, setLoading] = useState(() => !cachedStore);
  const [hasLocalData, setHasLocalData] = useState(() => cachedStore?.hasLocalData ?? false);
  const [syncStatus, setSyncStatus] = useState<"saved" | "saving" | "conflict" | "error">("saved");
  const [conflictDraft, setConflictDraft] = useState<WeekRecord | null>(null);
  const [retryDraft, setRetryDraft] = useState<WeekRecord | null>(null);

  // Load data from DB
  const reload = useCallback(async () => {
    if (!user) { setWeeks([]); setLoading(false); return; }
    const hasCachedStore = storeCache.has(user.id);
    if (!hasCachedStore) setLoading(true);
    try {
      const [{ data, error }, { data: sData, error: settingsError }, snapshotsResult, operationalResult, attributionResult, rideEventsResult, rideUpdateBatchesResult, rideUpdateBatchEventsResult, ridePaymentsResult, allocationsResult, manualAllocationsResult, zoneLabelsResult] = await Promise.all([
        supabase
          .from("weeks")
          .select("*")
          .order("start_date", { ascending: false }),
        supabase
          .from("user_settings")
          .select("*")
          .maybeSingle(),
        supabase
          .from("earnings_snapshots")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("operational_snapshots")
          .select("*")
          .order("recorded_at", { ascending: true }),
        supabase
          .from("earnings_attributions")
          .select("*")
          .order("created_at", { ascending: true }),
        loadRideEventPages((from, to) => supabase
          .from("ride_events")
          .select("*")
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)),
        supabase
          .from("ride_update_batches")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("ride_update_batch_events")
          .select("*"),
        supabase
          .from("ride_payments")
          .select("*")
          .order("observed_at", { ascending: true }),
        supabase
          .from("earnings_snapshot_allocations")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("manual_ride_allocations")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("user_zone_labels")
          .select("*")
          .order("updated_at", { ascending: false }),
      ]);
      if (error) throw error;
      if (settingsError) throw settingsError;

      const nextWeeks = data?.map(dbToWeek) ?? [];
      const nextSettings = sData ? {
        defaultWeeklyGoal: Number(sData.default_weekly_goal),
        defaultWeeklyHoursGoal: Number(sData.default_weekly_hours_goal ?? 0),
        currencySymbol: sData.currency_symbol,
        activeApps: (typeof sData.active_apps === "string"
          ? JSON.parse(sData.active_apps)
          : sData.active_apps) as string[],
        octopusPoints: Math.max(0, Number(sData.octopus_points ?? 0)),
        octopusUpdatedAt: sData.octopus_updated_at ?? undefined,
      } : storeCache.get(user.id)?.settings ?? DEFAULT_SETTINGS;
      const nextSnapshots = snapshotsResult.error
        ? storeCache.get(user.id)?.earningsSnapshots ?? []
        : snapshotsResult.data?.map(dbToEarningsSnapshot) ?? [];
      let nextOperationalSnapshots = operationalResult.error
        ? storeCache.get(user.id)?.operationalSnapshots ?? []
        : operationalResult.data?.map(dbToOperationalSnapshot) ?? [];
      const nextAttributions = attributionResult.error
        ? storeCache.get(user.id)?.earningsAttributions ?? []
        : attributionResult.data?.map(dbToEarningsAttribution) ?? [];
      const nextRideEvents = rideEventsResult.error
        ? storeCache.get(user.id)?.rideEvents ?? []
        : rideEventsResult.data?.map(dbToRideEvent) ?? [];
      const nextRideUpdateBatches = rideUpdateBatchesResult.error
        ? storeCache.get(user.id)?.rideUpdateBatches ?? []
        : rideUpdateBatchesResult.data?.map(dbToRideUpdateBatch) ?? [];
      const nextRideUpdateBatchEvents = rideUpdateBatchEventsResult.error
        ? storeCache.get(user.id)?.rideUpdateBatchEvents ?? []
        : rideUpdateBatchEventsResult.data?.map(dbToRideUpdateBatchEvent) ?? [];
      const nextRidePayments = ridePaymentsResult.error
        ? storeCache.get(user.id)?.ridePayments ?? []
        : ridePaymentsResult.data?.map(dbToRidePayment) ?? [];
      const nextRideSnapshotAllocations = allocationsResult.error
        ? storeCache.get(user.id)?.rideSnapshotAllocations ?? []
        : allocationsResult.data?.map(dbToRideSnapshotAllocation) ?? [];
      const nextManualRideAllocations = manualAllocationsResult.error
        ? storeCache.get(user.id)?.manualRideAllocations ?? []
        : manualAllocationsResult.data?.map(dbToManualRideAllocation) ?? [];
      const nextZoneLabels = zoneLabelsResult.error
        ? storeCache.get(user.id)?.zoneLabels ?? []
        : zoneLabelsResult.data?.map(dbToZoneLabel) ?? [];

      if (snapshotsResult.error) {
        console.warn("[weeks.reload] earnings snapshots unavailable", snapshotsResult.error);
      }
      if (operationalResult.error) {
        console.warn("[weeks.reload] operational snapshots unavailable", operationalResult.error);
      } else {
        const queueKey = `streex_operational_snapshot_queue:${user.id}`;
        try {
          const queued = JSON.parse(localStorage.getItem(queueKey) ?? "[]") as Database["public"]["Tables"]["operational_snapshots"]["Insert"][];
          if (queued.length) {
            const retry = await supabase.from("operational_snapshots").upsert(queued, { onConflict: "event_key", ignoreDuplicates: true }).select("*");
            if (!retry.error) {
              localStorage.removeItem(queueKey);
              const byKey = new Map(nextOperationalSnapshots.map((snapshot) => [snapshot.eventKey, snapshot]));
              retry.data?.map(dbToOperationalSnapshot).forEach((snapshot) => byKey.set(snapshot.eventKey, snapshot));
              nextOperationalSnapshots = [...byKey.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
            }
          }
        } catch (retryError) {
          console.warn("[weeks.reload] operational snapshot retry deferred", retryError);
        }
      }
      if (attributionResult.error) {
        console.warn("[weeks.reload] earnings attributions unavailable", attributionResult.error);
      }
      if (rideEventsResult.error) {
        console.warn("[weeks.reload] ride events unavailable", rideEventsResult.error);
      }
      if (rideUpdateBatchesResult.error || rideUpdateBatchEventsResult.error || ridePaymentsResult.error || allocationsResult.error || manualAllocationsResult.error || zoneLabelsResult.error) {
        console.warn("[weeks.reload] zone evidence unavailable", {
          batches: rideUpdateBatchesResult.error,
          batchEvents: rideUpdateBatchEventsResult.error,
          payments: ridePaymentsResult.error,
          allocations: allocationsResult.error,
          manualAllocations: manualAllocationsResult.error,
          zoneLabels: zoneLabelsResult.error,
        });
      }

      // Check for local data to import
      const local = getLocalWeeks();
      const nextHasLocalData = local.length > 0;
      storeCache.set(user.id, {
        weeks: nextWeeks,
        settings: nextSettings,
        earningsSnapshots: nextSnapshots,
        operationalSnapshots: nextOperationalSnapshots,
        earningsAttributions: nextAttributions,
        rideEvents: nextRideEvents,
        rideUpdateBatches: nextRideUpdateBatches,
        rideUpdateBatchEvents: nextRideUpdateBatchEvents,
        ridePayments: nextRidePayments,
        rideSnapshotAllocations: nextRideSnapshotAllocations,
        manualRideAllocations: nextManualRideAllocations,
        zoneLabels: nextZoneLabels,
        hasLocalData: nextHasLocalData,
      });
      setWeeks(nextWeeks);
      setSettingsState(nextSettings);
      setEarningsSnapshots(nextSnapshots);
      setOperationalSnapshots(nextOperationalSnapshots);
      setEarningsAttributions(nextAttributions);
      setRideEvents(nextRideEvents);
      setRideUpdateBatches(nextRideUpdateBatches);
      setRideUpdateBatchEvents(nextRideUpdateBatchEvents);
      setRidePayments(nextRidePayments);
      setRideSnapshotAllocations(nextRideSnapshotAllocations);
      setManualRideAllocations(nextManualRideAllocations);
      setZoneLabels(nextZoneLabels);
      setHasLocalData(nextHasLocalData);
      lifecycleDebug("week store hydrated", {
        userId: user.id,
        weeks: nextWeeks.length,
        fromCache: hasCachedStore,
      });
    } catch (error) {
      console.warn("[weeks.reload] failed to hydrate week store", error);
      lifecycleDebug("week store hydration failed", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
        preservedCache: hasCachedStore,
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const addWeek = useCallback(async (w: WeekRecord): Promise<boolean> => {
    if (!user) return false;
    const normalizedWeek = normalizeLegacyBonusWeek(w);
    const integrityIssues = inspectWeekIntegrity(normalizedWeek);
    if (integrityIssues.length) {
      console.warn("[weeks.addWeek] semantic inconsistencies before save", {
        weekId: normalizedWeek.id,
        issues: integrityIssues.map(({ severity, code, path }) => ({ severity, code, path })),
      });
    }
    const { data, error } = await supabase.from("weeks").insert({
      user_id: user.id,
      start_date: normalizedWeek.startDate,
      end_date: normalizedWeek.endDate,
      weekly_goal: normalizedWeek.weeklyGoal,
      weekly_hours_goal: normalizedWeek.weeklyHoursGoal ?? 0,
      status: normalizedWeek.status,
      entries: normalizedWeek.entries as unknown as Json,
    }).select().single();
    if (error) {
      console.error("Save failed:", error);
      alert("Error saving week: " + error.message);
      return false;
    }
    await reload();
    return true;
  }, [user, reload]);

  const updateWeek = useCallback(async (
    w: WeekRecord,
    attributionIntents: EarningsAttributionIntent[] = [],
    options: { recordSnapshots?: boolean; onSnapshotsRecorded?: (snapshots: EarningsSnapshot[]) => Promise<void> | void } = {},
  ): Promise<boolean> => {
    if (!user) {
      console.warn("[weeks.updateWeek] skipped: no authenticated user", { weekId: w.id });
      return false;
    }
    const previousWeek = storeCache.get(user.id)?.weeks.find((week) => week.id === w.id)
      ?? weeks.find((week) => week.id === w.id)
      ?? null;
    if (!previousWeek) {
      console.warn("[weeks.updateWeek] skipped: unknown local revision", { weekId: w.id });
      setSyncStatus("error");
      setRetryDraft(w);
      return false;
    }
    const normalizedWeek = normalizeLegacyBonusWeek(w);
    try {
      const integrityIssues = inspectWeekIntegrity(normalizedWeek);
      if (integrityIssues.length) {
        console.warn("[weeks.updateWeek] semantic inconsistencies before save", {
          weekId: normalizedWeek.id,
          userId: user.id,
          issues: integrityIssues.map(({ severity, code, path }) => ({ severity, code, path })),
        });
      }
      setSyncStatus("saving");
      console.info("[weeks.updateWeek] saving", {
        weekId: w.id,
        userId: user.id,
        startDate: normalizedWeek.startDate,
        endDate: normalizedWeek.endDate,
        status: normalizedWeek.status,
        entries: normalizedWeek.entries.length,
      });
      const saveResult = await saveWeekWithRevision(normalizedWeek, previousWeek.updatedAt);
      if (saveResult.status === "conflict") {
        setConflictDraft(normalizedWeek);
        setRetryDraft(null);
        setSyncStatus("conflict");
        await reload();
        return false;
      }
      if (saveResult.status === "failed") {
        console.error("[weeks.updateWeek] Supabase update failed", {
          weekId: w.id,
          userId: user.id,
          error: saveResult.error,
        });
        setRetryDraft(normalizedWeek);
        setSyncStatus("error");
        alert("Could not save this week. Your latest edit is kept locally so you can retry.");
        return false;
      }
      const now = saveResult.updatedAt ?? new Date().toISOString();
      const existingSnapshotKeys = new Set(
        earningsSnapshots.map((snapshot) => earningsSnapshotTransitionKey(snapshot)),
      );
      const snapshotRows = options.recordSnapshots === false ? [] : buildEarningsSnapshotRows({
        userId: user.id,
        previousWeek,
        nextWeek: normalizedWeek,
        sourceRevision: previousWeek?.updatedAt,
      }).filter((row) => {
        const key = earningsSnapshotTransitionKey(row);
        if (existingSnapshotKeys.has(key) || pendingSnapshotKeys.has(key)) return false;
        pendingSnapshotKeys.add(key);
        return true;
      });
      let insertedSnapshots: EarningsSnapshot[] = [];
      if (snapshotRows.length) {
        try {
          const { data: snapshotData, error: snapshotError } = await supabase
            .from("earnings_snapshots")
            .upsert(snapshotRows, { onConflict: "event_key", ignoreDuplicates: true })
            .select("*");
          if (snapshotError) {
            console.warn("[weeks.updateWeek] earnings snapshots unavailable", {
              weekId: w.id,
              count: snapshotRows.length,
              error: snapshotError,
            });
          } else if (snapshotData?.length) {
            insertedSnapshots = snapshotData.map(dbToEarningsSnapshot);
            setEarningsSnapshots((prev) => [...prev, ...insertedSnapshots]);
          }
        } finally {
          snapshotRows.forEach((row) => pendingSnapshotKeys.delete(earningsSnapshotTransitionKey(row)));
        }
      }
      let nextAttributions = earningsAttributions;
      if (attributionIntents.length && insertedSnapshots.length) {
        const attributionRows = insertedSnapshots.flatMap((snapshot) => {
          if (Number(snapshot.delta) <= 0) return [];
          const intent = attributionIntents.find((candidate) => attributionIntentMatchesSnapshot(candidate, snapshot));
          return intent ? [intentToAttributionRow(intent, snapshot, user.id)] : [];
        });
        if (attributionRows.length) {
          const { data: attributionData, error: attributionError } = await supabase
            .from("earnings_attributions")
            .upsert(attributionRows, { onConflict: "snapshot_id" })
            .select("*");
          if (attributionError) {
            console.warn("[weeks.updateWeek] earnings attribution unavailable", attributionError);
          } else if (attributionData?.length) {
            const inserted = attributionData.map(dbToEarningsAttribution);
            const bySnapshot = new Map(earningsAttributions.map((item) => [item.snapshotId, item]));
            inserted.forEach((item) => bySnapshot.set(item.snapshotId, item));
            nextAttributions = [...bySnapshot.values()];
            setEarningsAttributions(nextAttributions);
          }
        }
      }
      if (insertedSnapshots.length) await options.onSnapshotsRecorded?.(insertedSnapshots);
      setWeeks((prev) => {
        const nextWeeks = prev.map((x) => (x.id === normalizedWeek.id ? { ...normalizedWeek, updatedAt: now } : x));
        const nextSnapshots = insertedSnapshots.length ? [...earningsSnapshots, ...insertedSnapshots] : earningsSnapshots;
        storeCache.set(user.id, { weeks: nextWeeks, settings, earningsSnapshots: nextSnapshots, operationalSnapshots, earningsAttributions: nextAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels, hasLocalData });
        return nextWeeks;
      });
      setConflictDraft(null);
      setRetryDraft(null);
      setSyncStatus("saved");
      return true;
    } catch (error) {
      console.error("[weeks.updateWeek] request failed", {
        weekId: w.id,
        userId: user.id,
        error,
      });
      setRetryDraft(normalizedWeek);
      setSyncStatus("error");
      alert("Could not save this week. Your latest edit is kept locally so you can retry.");
      return false;
    }
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, reload, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const saveEarningsAttribution = useCallback(async (
    snapshotId: string,
    intent: Omit<EarningsAttributionIntent, "dayDate" | "app" | "previousAmount" | "newAmount">,
  ): Promise<boolean> => {
    if (!user) return false;
    const snapshot = earningsSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot || Number(snapshot.delta) <= 0) return false;
    const existing = earningsAttributions.find((item) => item.snapshotId === snapshotId);
    const query = existing
      ? supabase.from("earnings_attributions").update(attributionToUpdateRow(intent)).eq("snapshot_id", snapshotId).eq("user_id", user.id)
      : supabase.from("earnings_attributions").insert(intentToAttributionRow({
          ...intent,
          dayDate: snapshot.dayDate,
          app: snapshot.app,
          previousAmount: snapshot.previousAmount,
          newAmount: snapshot.newAmount,
        }, snapshot, user.id));
    const { data, error } = await query.select("*").single();
    if (error) {
      console.error("[earningsAttributions] save failed", { snapshotId, error });
      return false;
    }
    const saved = dbToEarningsAttribution(data);
    setEarningsAttributions((previous) => {
      const next = [...previous.filter((item) => item.snapshotId !== snapshotId), saved];
      storeCache.set(user.id, { weeks, settings, earningsSnapshots, operationalSnapshots, earningsAttributions: next, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels, hasLocalData });
      return next;
    });
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const recordOperationalSnapshot = useCallback(async (draft: OperationalSnapshotDraft): Promise<boolean> => {
    if (!user) return false;
    const week = weeks.find((item) => item.entries.some((day) => day.date === draft.dayDate));
    if (!week) return false;
    const row = operationalDraftToRow(draft, user.id, week.id);
    const queueKey = `streex_operational_snapshot_queue:${user.id}`;
    const queued = (() => {
      try { return JSON.parse(localStorage.getItem(queueKey) ?? "[]") as typeof row[]; }
      catch { return [] as typeof row[]; }
    })();
    const rows = [...queued.filter((item) => item.event_key !== row.event_key), row];
    const { data, error } = await supabase
      .from("operational_snapshots")
      .upsert(rows, { onConflict: "event_key", ignoreDuplicates: true })
      .select("*");
    if (error) {
      localStorage.setItem(queueKey, JSON.stringify(rows));
      console.warn("[operationalSnapshots] queued for retry", { count: rows.length, error });
      return false;
    }
    localStorage.removeItem(queueKey);
    if (data?.length) {
      setOperationalSnapshots((previous) => {
        const byKey = new Map(previous.map((snapshot) => [snapshot.eventKey, snapshot]));
        data.map(dbToOperationalSnapshot).forEach((snapshot) => byKey.set(snapshot.eventKey, snapshot));
        const next = [...byKey.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        storeCache.set(user.id, { weeks, settings, earningsSnapshots, operationalSnapshots: next, earningsAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels, hasLocalData });
        return next;
      });
    }
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const startRideEvent = useCallback(async (draft: {
    weekId: string; dayDate: string; shiftId?: string | null; app?: string | null; startedAt: string; capture: RideCaptureResult;
  }): Promise<RideEvent | null> => {
    if (!user) return null;
    let timeZone: string | null = null;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* Time zone is optional ride context. */ }
    const { data, error } = await supabase.from("ride_events").insert({
      user_id: user.id, week_id: draft.weekId, day_date: draft.dayDate, shift_id: draft.shiftId ?? null,
      app: draft.app ?? null, started_at: draft.startedAt, lifecycle_version: 2, source: "foreground_browser", start_zone_key: draft.capture.zoneKey ?? null,
      // Never infer a time zone on the server. This is the browser's declared
      // IANA zone and enables only future aggregate local-window analysis.
      time_zone: timeZone,
      start_capture_status: draft.capture.status, start_accuracy_class: draft.capture.accuracyClass ?? null,
    }).select("*").single();
    if (error) {
      if (error.code === "23505") {
        const active = await supabase.from("ride_events").select("*").eq("user_id", user.id).eq("status", "active").maybeSingle();
        if (!active.error && active.data) {
          const existing = dbToRideEvent(active.data);
          setRideEvents((previous) => [...previous.filter((item) => item.id !== existing.id && item.status !== "active"), existing]);
          return existing;
        }
      }
      console.warn("[rideEvents] start failed", error); return null;
    }
    const event = dbToRideEvent(data);
    setRideEvents((previous) => [...previous.filter((item) => item.id !== event.id), event]);
    return event;
  }, [user]);

  const markRidePickup = useCallback(async (id: string, pickedUpAt: string, capture: RideCaptureResult): Promise<RideEvent | null> => {
    if (!user) return null;
    const { data, error } = await supabase.from("ride_events").update({
      pickup_at: pickedUpAt, pickup_zone_key: capture.zoneKey ?? null,
      pickup_capture_status: capture.status, pickup_accuracy_class: capture.accuracyClass ?? null, updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.id).eq("status", "active").select("*").single();
    if (error) { console.warn("[rideEvents] pickup failed", error); return null; }
    const event = dbToRideEvent(data);
    setRideEvents((previous) => [...previous.filter((item) => item.id !== event.id), event]);
    return event;
  }, [user]);

  const finishRideEvent = useCallback(async (id: string, endedAt: string, capture: RideCaptureResult): Promise<RideEvent | null> => {
    if (!user) return null;
    const { data, error } = await supabase.from("ride_events").update({
      status: "completed", ended_at: endedAt, end_zone_key: capture.zoneKey ?? null,
      end_capture_status: capture.status, end_accuracy_class: capture.accuracyClass ?? null, updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.id).select("*").single();
    if (error) { console.warn("[rideEvents] finish failed", error); return null; }
    const event = dbToRideEvent(data);
    setRideEvents((previous) => [...previous.filter((item) => item.id !== event.id), event]);
    return event;
  }, [user]);

  const cancelForegroundRideEvent = useCallback(async (id: string): Promise<boolean> => {
    if (!user) return false;
    const current = rideEvents.find((event) => event.id === id);
    if (!current || current.source !== "foreground_browser" || (current.status !== "active" && current.status !== "completed")) return false;
    const { data, error } = await supabase.from("ride_events").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).select("*").single();
    if (error || !data) { console.warn("[rideEvents] foreground cancellation failed", error); return false; }
    const event = dbToRideEvent(data);
    setRideEvents((previous) => previous.map((item) => item.id === id ? event : item));
    return true;
  }, [rideEvents, user]);

  const linkRideEvents = useCallback(async (draft: { app: string; earningsSnapshotId: string; operationalEventKey?: string | null; rideEventIds: string[] }): Promise<boolean> => {
    if (!user || draft.rideEventIds.length === 0) return false;
    const kind = draft.rideEventIds.length === 1 ? "single" : "batch";
    const { data: batch, error: batchError } = await supabase.from("ride_update_batches").insert({
      user_id: user.id, app: draft.app, kind, earnings_snapshot_id: draft.earningsSnapshotId,
      operational_event_key: draft.operationalEventKey ?? null,
    }).select("*").single();
    if (batchError || !batch) { console.warn("[rideEvents] batch link failed", batchError); return false; }
    const { error: linksError } = await supabase.from("ride_update_batch_events").insert(draft.rideEventIds.map((rideEventId) => ({ batch_id: batch.id, ride_event_id: rideEventId })));
    if (linksError) { console.warn("[rideEvents] batch event link failed", linksError); return false; }
    const linkedStatus = kind === "single" ? "linked_single" : "linked_batch";
    const { error: rideError } = await supabase.from("ride_events").update({ status: linkedStatus, updated_at: new Date().toISOString() }).in("id", draft.rideEventIds).eq("user_id", user.id);
    if (rideError) { console.warn("[rideEvents] status link failed", rideError); return false; }
    setRideEvents((previous) => previous.map((event) => draft.rideEventIds.includes(event.id) ? { ...event, status: linkedStatus } : event));
    setRideUpdateBatches((previous) => [...previous, dbToRideUpdateBatch(batch)]);
    setRideUpdateBatchEvents((previous) => [...previous, ...draft.rideEventIds.map((rideEventId) => ({ batchId: batch.id, rideEventId }))]);
    return true;
  }, [user]);

  const recordRidePayment = useCallback(async (draft: { rideEventId: string; earningsSnapshotId: string; kind: "manual_base" | "late_tip" | "adjustment"; observedAt: string }): Promise<boolean> => {
    if (!user) return false;
    const { data, error } = await supabase.from("ride_payments").insert({
      user_id: user.id, ride_event_id: draft.rideEventId, earnings_snapshot_id: draft.earningsSnapshotId,
      kind: draft.kind, observed_at: draft.observedAt,
    }).select("*").single();
    if (error) { console.warn("[ridePayments] save failed", error); return false; }
    if (data) setRidePayments((previous) => [...previous, dbToRidePayment(data)]);
    return true;
  }, [user]);

  const replaceSnapshotAllocations = useCallback(async (snapshotId: string, allocations: RideSnapshotAllocationDraft[]): Promise<boolean> => {
    if (!user || allocations.length === 0) return false;
    const snapshot = earningsSnapshots.find((item) => item.id === snapshotId);
    let expected = Math.max(0, Number(snapshot?.delta) || 0);
    if (expected <= 0) {
      const { data: remoteSnapshot, error: snapshotError } = await supabase
        .from("earnings_snapshots")
        .select("delta")
        .eq("id", snapshotId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (snapshotError || !remoteSnapshot) {
        console.warn("[rideSnapshotAllocations] snapshot lookup failed", snapshotError);
        return false;
      }
      expected = Math.max(0, Number(remoteSnapshot.delta) || 0);
    }
    const allocated = allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0);
    if (expected <= 0 || Math.abs(allocated - expected) > 0.005 || allocations.some((allocation) => allocation.amount <= 0)) {
      console.warn("[rideSnapshotAllocations] invalid allocation total", { snapshotId, expected, allocated });
      return false;
    }
    const allocationSetId = crypto.randomUUID();
    const { data, error } = await supabase.from("earnings_snapshot_allocations").insert(allocations.map((allocation) => ({
      user_id: user.id,
      earnings_snapshot_id: snapshotId,
      ride_event_id: allocation.rideEventId ?? null,
      allocation_set_id: allocationSetId,
      kind: allocation.kind,
      amount: allocation.amount,
      observed_at: allocation.observedAt,
      attributed_day_date: allocation.attributedDayDate ?? null,
      shift_id: allocation.shiftId ?? null,
      effective_start_at: allocation.effectiveStartAt ?? null,
      effective_end_at: allocation.effectiveEndAt ?? null,
      note: allocation.note ?? null,
    }))).select("*");
    if (error || !data) { console.warn("[rideSnapshotAllocations] save failed", error); return false; }
    const retiredAt = new Date().toISOString();
    const { error: retireError } = await supabase.from("earnings_snapshot_allocations")
      .update({ is_current: false, replaced_at: retiredAt })
      .eq("user_id", user.id)
      .eq("earnings_snapshot_id", snapshotId)
      .eq("is_current", true)
      .neq("allocation_set_id", allocationSetId);
    if (retireError) console.warn("[rideSnapshotAllocations] prior allocation retirement deferred", retireError);
    const next = [
      ...rideSnapshotAllocations.map((allocation) => allocation.earningsSnapshotId === snapshotId && allocation.isCurrent && allocation.allocationSetId !== allocationSetId
        ? { ...allocation, isCurrent: false, replacedAt: retiredAt }
        : allocation),
      ...data.map(dbToRideSnapshotAllocation),
    ];
    setRideSnapshotAllocations(next);
    storeCache.set(user.id, { weeks, settings, earningsSnapshots, operationalSnapshots, earningsAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations: next, manualRideAllocations, zoneLabels, hasLocalData });
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const replaceManualRideAllocations = useCallback(async (draft: { weekId: string; dayDate: string; app: string; sourceTotal: number }, allocations: ManualRideAllocationDraft[]): Promise<boolean> => {
    if (!user || allocations.length === 0) return false;
    const expected = Math.max(0, Number(draft.sourceTotal) || 0);
    const allocated = allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0);
    if (expected <= 0 || Math.abs(allocated - expected) > 0.005 || allocations.some((allocation) => allocation.amount <= 0)) {
      console.warn("[manualRideAllocations] invalid allocation total", { expected, allocated });
      return false;
    }
    const allocationSetId = crypto.randomUUID();
    const { data, error } = await supabase.from("manual_ride_allocations").insert(allocations.map((allocation) => ({
      user_id: user.id, week_id: draft.weekId, day_date: draft.dayDate, app: draft.app,
      ride_event_id: allocation.rideEventId ?? null, allocation_set_id: allocationSetId,
      kind: allocation.kind, amount: allocation.amount, source_total: expected, note: allocation.note ?? null,
    }))).select("*");
    if (error || !data) { console.warn("[manualRideAllocations] save failed", error); return false; }
    const retiredAt = new Date().toISOString();
    const { error: retireError } = await supabase.from("manual_ride_allocations")
      .update({ is_current: false, replaced_at: retiredAt })
      .eq("user_id", user.id).eq("week_id", draft.weekId).eq("day_date", draft.dayDate).eq("app", draft.app)
      .eq("is_current", true).neq("allocation_set_id", allocationSetId);
    if (retireError) console.warn("[manualRideAllocations] prior allocation retirement deferred", retireError);
    const next = [
      ...manualRideAllocations.map((allocation) => allocation.weekId === draft.weekId && allocation.dayDate === draft.dayDate && allocation.app === draft.app && allocation.isCurrent && allocation.allocationSetId !== allocationSetId
        ? { ...allocation, isCurrent: false, replacedAt: retiredAt }
        : allocation),
      ...data.map(dbToManualRideAllocation),
    ];
    setManualRideAllocations(next);
    storeCache.set(user.id, { weeks, settings, earningsSnapshots, operationalSnapshots, earningsAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations: next, zoneLabels, hasLocalData });
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const saveZoneLabel = useCallback(async (draft: { zoneKey: string; label: string; source?: "user" | "suggested" }): Promise<boolean> => {
    if (!user) return false;
    const label = draft.label.trim().slice(0, 80);
    if (!label) return false;
    const { data, error } = await supabase.from("user_zone_labels").upsert({
      user_id: user.id, zone_key: draft.zoneKey, label, source: draft.source ?? "user", updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,zone_key" }).select("*").single();
    if (error || !data) { console.warn("[zoneLabels] save failed", error); return false; }
    const nextLabel = dbToZoneLabel(data);
    const next = [...zoneLabels.filter((item) => item.zoneKey !== nextLabel.zoneKey), nextLabel];
    setZoneLabels(next);
    storeCache.set(user.id, { weeks, settings, earningsSnapshots, operationalSnapshots, earningsAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels: next, hasLocalData });
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, weeks, zoneLabels]);

  const resolveWeekConflict = useCallback(async (strategy: "keep-remote" | "use-local"): Promise<boolean> => {
    const draft = conflictDraft;
    if (!draft) return false;
    if (strategy === "keep-remote") {
      setConflictDraft(null);
      setSyncStatus("saved");
      return true;
    }
    const remoteWeek = storeCache.get(user?.id ?? "")?.weeks.find((week) => week.id === draft.id)
      ?? weeks.find((week) => week.id === draft.id);
    if (!remoteWeek) return false;
    setConflictDraft(null);
    return updateWeek({ ...draft, updatedAt: remoteWeek.updatedAt });
  }, [conflictDraft, updateWeek, user?.id, weeks]);

  const retryLastSave = useCallback(async (): Promise<boolean> => {
    if (!retryDraft) return false;
    const remoteWeek = storeCache.get(user?.id ?? "")?.weeks.find((week) => week.id === retryDraft.id)
      ?? weeks.find((week) => week.id === retryDraft.id);
    if (!remoteWeek) return false;
    return updateWeek({ ...retryDraft, updatedAt: remoteWeek.updatedAt });
  }, [retryDraft, updateWeek, user?.id, weeks]);

  const getWeekRevisions = useCallback(async (weekId: string): Promise<WeekRevision[]> => {
    return loadWeekRevisions(weekId);
  }, []);

  const restoreRevision = useCallback(async (weekId: string, revisionId: string): Promise<boolean> => {
    if (!user) return false;
    const currentWeek = storeCache.get(user.id)?.weeks.find((week) => week.id === weekId)
      ?? weeks.find((week) => week.id === weekId);
    if (!currentWeek) return false;
    setSyncStatus("saving");
    const result = await restoreWeekRevision(weekId, revisionId, currentWeek.updatedAt);
    if (result.status === "conflict") {
      await reload();
      setSyncStatus("saved");
      return false;
    }
    if (result.status === "failed") {
      setSyncStatus("error");
      return false;
    }
    await reload();
    setSyncStatus("saved");
    return true;
  }, [reload, user, weeks]);

  const deleteWeek = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("weeks").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      console.error("Delete failed:", error);
      alert("Error deleting week: " + error.message);
      return;
    }
    setWeeks((prev) => {
      const nextWeeks = prev.filter((w) => w.id !== id);
      const nextSnapshots = earningsSnapshots.filter((snapshot) => snapshot.weekId !== id);
      const remainingSnapshotIds = new Set(nextSnapshots.map((snapshot) => snapshot.id));
      const nextAttributions = earningsAttributions.filter((item) => remainingSnapshotIds.has(item.snapshotId));
      storeCache.set(user.id, { weeks: nextWeeks, settings, earningsSnapshots: nextSnapshots, operationalSnapshots, earningsAttributions: nextAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels, hasLocalData });
      setEarningsSnapshots(nextSnapshots);
      setEarningsAttributions(nextAttributions);
      return nextWeeks;
    });
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, settings, user, zoneLabels]);

  const updateSettings = useCallback(async (s: AppSettings): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase.from("user_settings").upsert({
      user_id: user.id,
      default_weekly_goal: s.defaultWeeklyGoal,
      default_weekly_hours_goal: s.defaultWeeklyHoursGoal ?? 0,
      currency_symbol: s.currencySymbol,
      active_apps: s.activeApps as unknown as Json,
      octopus_points: Math.max(0, Number(s.octopusPoints) || 0),
      octopus_updated_at: s.octopusUpdatedAt ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      console.error("Settings save failed:", error);
      alert("Error saving settings: " + error.message);
      return false;
    }
    storeCache.set(user.id, { weeks, settings: s, earningsSnapshots, operationalSnapshots, earningsAttributions, rideEvents, rideUpdateBatches, rideUpdateBatchEvents, ridePayments, rideSnapshotAllocations, manualRideAllocations, zoneLabels, hasLocalData });
    setSettingsState(s);
    return true;
  }, [earningsAttributions, earningsSnapshots, hasLocalData, manualRideAllocations, operationalSnapshots, rideEvents, ridePayments, rideSnapshotAllocations, rideUpdateBatchEvents, rideUpdateBatches, user, weeks, zoneLabels]);

  const importLocalData = useCallback(async () => {
    if (!user) return;
    const local = getLocalWeeks();
    if (!local.length) return;
    const existingStarts = new Set(weeks.map((w) => w.startDate));
    const toImport = local.filter((w) => !existingStarts.has(w.startDate));
    if (!toImport.length) {
      localStorage.removeItem("streex_weeks");
      setHasLocalData(false);
      return 0;
    }
    const rows = toImport.map(normalizeLegacyBonusWeek).map((w) => ({
      user_id: user.id,
      start_date: w.startDate,
      end_date: w.endDate,
      weekly_goal: w.weeklyGoal,
      weekly_hours_goal: w.weeklyHoursGoal ?? 0,
      status: w.status,
      entries: w.entries as unknown as Json,
    }));
    const { error } = await supabase.from("weeks").insert(rows);
    if (error) {
      console.error("Import failed:", error);
      alert("Error importing data: " + error.message);
      return 0;
    }
    localStorage.removeItem("streex_weeks");
    setHasLocalData(false);
    await reload();
    return toImport.length;
  }, [user, weeks, reload]);

  const openWeek = weeks.find((w) => w.status === "open") || null;

  return {
    user,
    weeks,
    openWeek,
    settings,
    earningsSnapshots,
    operationalSnapshots,
    earningsAttributions,
    rideEvents,
    rideUpdateBatches,
    rideUpdateBatchEvents,
    ridePayments,
    rideSnapshotAllocations,
    manualRideAllocations,
    zoneLabels,
    loading,
    hasLocalData,
    addWeek,
    updateWeek,
    recordOperationalSnapshot,
    startRideEvent,
    markRidePickup,
    finishRideEvent,
    cancelForegroundRideEvent,
    linkRideEvents,
    recordRidePayment,
    replaceSnapshotAllocations,
    replaceManualRideAllocations,
    saveZoneLabel,
    saveEarningsAttribution,
    deleteWeek,
    updateSettings,
    importLocalData,
    reload,
    syncStatus,
    hasPendingConflict: Boolean(conflictDraft),
    resolveWeekConflict,
    retryLastSave,
    getWeekRevisions,
    restoreRevision,
  };
}
