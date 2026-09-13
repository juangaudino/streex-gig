import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDailyOpsResponse } from "./index.ts";

Deno.test("daily summary returns a safe zero shape when the date has no entry", () => {
  assertEquals(buildDailyOpsResponse({ date: "2026-09-12", day: null }), {
    date: "2026-09-12",
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
  });
});

Deno.test("daily summary uses canonical shift metrics and current pickup allocations", () => {
  const result = buildDailyOpsResponse({
    date: "2026-09-12",
    day: {
      date: "2026-09-12",
      apps: { Uber: 100 },
      shifts: [{ startTime: "2026-09-12T10:00:00Z", endTime: "2026-09-12T12:00:00Z", miles: 30, rideCount: 2 }],
    },
    rides: [{
      id: "ride-1",
      day_date: "2026-09-12",
      app: "Uber",
      status: "completed",
      source: "foreground_browser",
      lifecycle_version: 2,
      start_zone_key: "acceptance-cell",
      pickup_zone_key: "pickup-cell",
      start_capture_status: "captured",
      pickup_capture_status: "captured",
    }],
    snapshots: [{ id: "snapshot-1", week_id: "week-1", day_date: "2026-09-12", app: "Uber", delta: 100, created_at: "2026-09-12T12:05:00Z" }],
    snapshotAllocations: [{ ride_event_id: "ride-1", earnings_snapshot_id: "snapshot-1", kind: "ride_base", amount: 100 }],
    zoneLabels: [{ zone_key: "pickup-cell", label: "Downtown SLC" }],
  });

  assertEquals(result.earnings, 100);
  assertEquals(result.operationalEarnings, 100);
  assertEquals(result.hours, 2);
  assertEquals(result.rides, 2);
  assertEquals(result.earningsPerHour, 50);
  assertEquals(result.topZones, [{ zone: "Downtown SLC", rides: 1, earnings: 100 }]);
});
