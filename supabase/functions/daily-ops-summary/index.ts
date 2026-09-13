// Deterministic, owner-scoped daily operations summary.
// This function never calls OpenAI and never uses service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  dayShiftStats,
  dayTotal,
  normalizeAppTotals,
  operationalDayTotal,
  parseEntries,
  round,
} from "../_shared/dailyOps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;

type SupabaseClient = ReturnType<typeof createClient>;

type WeekRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: "open" | "closed";
  entries: unknown[] | string;
};

type RideRow = {
  id: string;
  day_date: string;
  app: string | null;
  status: string;
  source: string;
  lifecycle_version: number;
  start_zone_key: string | null;
  pickup_zone_key: string | null;
  start_capture_status: string;
  pickup_capture_status: string;
};

type SnapshotRow = {
  id: string;
  week_id: string;
  day_date: string;
  app: string;
  delta: number;
  created_at: string;
};

type SnapshotAllocationRow = {
  ride_event_id: string | null;
  earnings_snapshot_id: string;
  kind: string;
  amount: number;
};

type ManualAllocationRow = {
  ride_event_id: string | null;
  kind: string;
  amount: number;
};

type PaymentRow = {
  ride_event_id: string;
  earnings_snapshot_id: string;
};

type BatchRow = {
  id: string;
  earnings_snapshot_id: string;
  kind: string;
};

type BatchEventRow = {
  batch_id: string;
  ride_event_id: string;
};

type ZoneLabelRow = {
  zone_key: string;
  label: string;
};

type DailyOpsDay = ReturnType<typeof summarizeDay>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function summarizeDay(day: Parameters<typeof dayTotal>[0]) {
  const stats = dayShiftStats(day);
  return {
    earnings: round(dayTotal(day)),
    operationalEarnings: round(operationalDayTotal(day)),
    hours: stats.hours,
    rides: stats.rides,
    miles: stats.miles,
    earningsPerHour: stats.hours > 0 ? round(operationalDayTotal(day) / stats.hours) : null,
    earningsPerRide: stats.rides > 0 ? round(operationalDayTotal(day) / stats.rides) : null,
    ridesPerHour: stats.hours > 0 && stats.rides > 0 ? round(stats.rides / stats.hours) : null,
    completedShifts: stats.completedShifts,
    hasActiveShift: stats.activeShifts > 0,
    apps: normalizeAppTotals(day),
  };
}

function emptySummary(date: string) {
  return {
    date,
    earnings: 0,
    operationalEarnings: 0,
    hours: 0,
    rides: 0,
    miles: 0,
    earningsPerHour: null,
    earningsPerRide: null,
    ridesPerHour: null,
    completedShifts: 0,
    hasActiveShift: false,
    apps: {},
    topZones: [],
  };
}

async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const pageSize = 500;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

function effectiveSnapshotDeltas(rows: SnapshotRow[]): Map<string, number> {
  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.week_id}|${row.day_date}|${row.app}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const effective = new Map<string, number>();
  for (const group of grouped.values()) {
    let correctionDebt = 0;
    for (const row of [...group].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      const delta = Number(row.delta) || 0;
      if (delta <= 0) {
        correctionDebt += Math.abs(delta);
        effective.set(row.id, 0);
        continue;
      }
      const recovery = Math.min(correctionDebt, delta);
      correctionDebt = round(correctionDebt - recovery);
      effective.set(row.id, round(delta - recovery));
    }
  }
  return effective;
}

function pickupZoneKey(ride: RideRow): string | null {
  if (ride.source !== "foreground_browser" || ride.status === "active" || ride.status === "cancelled") return null;
  if (ride.lifecycle_version === 2) {
    return ride.pickup_capture_status === "captured" ? ride.pickup_zone_key : null;
  }
  return ride.start_capture_status === "captured" ? ride.start_zone_key : null;
}

function buildTopZones(args: {
  rides: RideRow[];
  snapshots: SnapshotRow[];
  snapshotAllocations: SnapshotAllocationRow[];
  manualAllocations: ManualAllocationRow[];
  payments: PaymentRow[];
  batches: BatchRow[];
  batchEvents: BatchEventRow[];
  zoneLabels: ZoneLabelRow[];
}) {
  const effective = effectiveSnapshotDeltas(args.snapshots);
  const ledgerSnapshots = new Set(args.snapshotAllocations.map((row) => row.earnings_snapshot_id));
  const earningsByRide = new Map<string, number>();
  const add = (rideId: string | null, amount: unknown) => {
    if (!rideId) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    earningsByRide.set(rideId, round((earningsByRide.get(rideId) ?? 0) + parsed));
  };

  for (const row of args.snapshotAllocations) {
    if (row.ride_event_id && ["ride_base", "late_tip", "adjustment"].includes(row.kind)) add(row.ride_event_id, row.amount);
  }
  for (const row of args.manualAllocations) {
    if (row.ride_event_id && row.kind === "ride_base") add(row.ride_event_id, row.amount);
  }
  for (const row of args.payments) {
    if (!ledgerSnapshots.has(row.earnings_snapshot_id)) add(row.ride_event_id, effective.get(row.earnings_snapshot_id) ?? 0);
  }

  const batchesById = new Map(args.batches.map((batch) => [batch.id, batch]));
  const rideIdsByBatch = new Map<string, string[]>();
  for (const link of args.batchEvents) {
    rideIdsByBatch.set(link.batch_id, [...(rideIdsByBatch.get(link.batch_id) ?? []), link.ride_event_id]);
  }
  for (const [batchId, rideIds] of rideIdsByBatch) {
    const batch = batchesById.get(batchId);
    if (!batch || batch.kind !== "single" || rideIds.length !== 1 || ledgerSnapshots.has(batch.earnings_snapshot_id)) continue;
    add(rideIds[0], effective.get(batch.earnings_snapshot_id) ?? 0);
  }

  const labels = new Map(
    args.zoneLabels
      .map((row) => [row.zone_key, row.label.trim().slice(0, 80)] as const)
      .filter(([, label]) => Boolean(label)),
  );
  const ridesById = new Map(args.rides.map((ride) => [ride.id, ride]));
  const zones = new Map<string, { rides: number; earnings: number }>();
  for (const [rideId, rideEarnings] of earningsByRide) {
    const ride = ridesById.get(rideId);
    const zoneKey = ride ? pickupZoneKey(ride) : null;
    const label = zoneKey ? labels.get(zoneKey) : null;
    if (!label) continue;
    const current = zones.get(label) ?? { rides: 0, earnings: 0 };
    current.rides += 1;
    current.earnings = round(current.earnings + rideEarnings);
    zones.set(label, current);
  }

  return [...zones.entries()]
    .map(([zone, stats]) => ({ zone, rides: stats.rides, earnings: stats.earnings }))
    .sort((a, b) => b.earnings - a.earnings || b.rides - a.rides || a.zone.localeCompare(b.zone))
    .slice(0, 12);
}

export function buildDailyOpsResponse(args: {
  date: string;
  day: Parameters<typeof dayTotal>[0] | null;
  rides?: RideRow[];
  snapshots?: SnapshotRow[];
  snapshotAllocations?: SnapshotAllocationRow[];
  manualAllocations?: ManualAllocationRow[];
  payments?: PaymentRow[];
  batches?: BatchRow[];
  batchEvents?: BatchEventRow[];
  zoneLabels?: ZoneLabelRow[];
}) {
  if (!args.day) return emptySummary(args.date);
  const summary: DailyOpsDay = summarizeDay(args.day);
  return {
    date: args.date,
    ...summary,
    topZones: buildTopZones({
      rides: args.rides ?? [],
      snapshots: args.snapshots ?? [],
      snapshotAllocations: args.snapshotAllocations ?? [],
      manualAllocations: args.manualAllocations ?? [],
      payments: args.payments ?? [],
      batches: args.batches ?? [],
      batchEvents: args.batchEvents ?? [],
      zoneLabels: args.zoneLabels ?? [],
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authHeader)) return json({ error: "Authentication required." }, 401);

  const date = new URL(req.url).searchParams.get("date")?.trim() ?? "";
  if (!isValidDate(date)) return json({ error: "date must be a valid YYYY-MM-DD value." }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user?.id) return json({ error: "Authentication issue." }, 401);
  const userId = userRes.user.id;

  const weeksRes = await supabase
    .from("weeks")
    .select("id,start_date,end_date,status,entries")
    .eq("user_id", userId)
    .lte("start_date", date)
    .gte("end_date", date)
    .limit(10);
  if (weeksRes.error) return json({ error: "Could not load the daily summary." }, 500);

  const week = (weeksRes.data as WeekRow[]).find((candidate) =>
    parseEntries(candidate.entries).some((entry) => entry && typeof entry === "object" && (entry as { date?: string }).date === date),
  );
  const day = week
    ? parseEntries<Parameters<typeof dayTotal>[0]>(week.entries).find((entry) => entry.date === date) ?? null
    : null;
  if (!day) return json(emptySummary(date));

  const [ridesRes, snapshotsRes, snapshotAllocationsRes, manualAllocationsRes, paymentsRes, batchesRes, batchEventsRes, zoneLabelsRes] = await Promise.all([
    fetchAllPages((from, to) => supabase.from("ride_events")
      .select("id,day_date,app,status,source,lifecycle_version,start_zone_key,pickup_zone_key,start_capture_status,pickup_capture_status")
      .eq("user_id", userId).eq("day_date", date).range(from, to)),
    fetchAllPages((from, to) => supabase.from("earnings_snapshots")
      .select("id,week_id,day_date,app,delta,created_at")
      .eq("user_id", userId).range(from, to)),
    fetchAllPages((from, to) => supabase.from("earnings_snapshot_allocations")
      .select("ride_event_id,earnings_snapshot_id,kind,amount")
      .eq("user_id", userId).eq("is_current", true).range(from, to)),
    fetchAllPages((from, to) => supabase.from("manual_ride_allocations")
      .select("ride_event_id,kind,amount")
      .eq("user_id", userId).eq("week_id", week?.id ?? "").eq("day_date", date).eq("is_current", true).range(from, to)),
    fetchAllPages((from, to) => supabase.from("ride_payments")
      .select("ride_event_id,earnings_snapshot_id")
      .eq("user_id", userId).range(from, to)),
    fetchAllPages((from, to) => supabase.from("ride_update_batches")
      .select("id,earnings_snapshot_id,kind")
      .eq("user_id", userId).range(from, to)),
    fetchAllPages((from, to) => supabase.from("ride_update_batch_events")
      .select("batch_id,ride_event_id").range(from, to)),
    fetchAllPages((from, to) => supabase.from("user_zone_labels")
      .select("zone_key,label").eq("user_id", userId).range(from, to)),
  ]);

  const dataResults = [ridesRes, snapshotsRes, snapshotAllocationsRes, manualAllocationsRes, paymentsRes, batchesRes, batchEventsRes, zoneLabelsRes];
  if (dataResults.some((result) => result.error)) return json({ error: "Could not load the daily summary." }, 500);

  return json(buildDailyOpsResponse({
    date,
    day,
    rides: ridesRes.data as RideRow[],
    snapshots: snapshotsRes.data as SnapshotRow[],
    snapshotAllocations: snapshotAllocationsRes.data as SnapshotAllocationRow[],
    manualAllocations: manualAllocationsRes.data as ManualAllocationRow[],
    payments: paymentsRes.data as PaymentRow[],
    batches: batchesRes.data as BatchRow[],
    batchEvents: batchEventsRes.data as BatchEventRow[],
    zoneLabels: zoneLabelsRes.data as ZoneLabelRow[],
  }));
});
