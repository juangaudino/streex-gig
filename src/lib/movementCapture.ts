import type { Database } from "@/integrations/supabase/types";
import type { RideCaptureResult, RideEvent } from "./types";

type RideEventRow = Database["public"]["Tables"]["ride_events"]["Row"];

export function dbToRideEvent(row: RideEventRow): RideEvent {
  return {
    id: row.id, userId: row.user_id, weekId: row.week_id, dayDate: row.day_date,
    shiftId: row.shift_id, app: row.app, status: row.status as RideEvent["status"],
    startedAt: row.started_at, endedAt: row.ended_at, lifecycleVersion: row.lifecycle_version as 1 | 2,
    startZoneKey: row.start_zone_key, pickupAt: row.pickup_at, pickupZoneKey: row.pickup_zone_key,
    endZoneKey: row.end_zone_key, startCaptureStatus: row.start_capture_status as RideEvent["startCaptureStatus"],
    endCaptureStatus: row.end_capture_status as RideEvent["endCaptureStatus"],
    pickupCaptureStatus: row.pickup_capture_status as RideEvent["pickupCaptureStatus"],
    startAccuracyClass: row.start_accuracy_class as RideEvent["startAccuracyClass"],
    endAccuracyClass: row.end_accuracy_class as RideEvent["endAccuracyClass"],
    pickupAccuracyClass: row.pickup_accuracy_class as RideEvent["pickupAccuracyClass"],
    timeZone: row.time_zone,
    source: row.source as RideEvent["source"],
  };
}

/** Captures one foreground position and immediately reduces it to a coarse ~5 km zone. */
export async function captureForegroundZone(): Promise<RideCaptureResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { status: "unavailable" };
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ status: "unavailable" }), 13_000);
    const finish = (result: RideCaptureResult) => { clearTimeout(timeout); resolve(result); };
    try { navigator.geolocation.getCurrentPosition(
    (position) => {
      if (position.timestamp < Date.now() - 120_000) return finish({ status: "stale" });
      const accuracy = Number(position.coords.accuracy);
      if (!Number.isFinite(accuracy) || accuracy > 250) return finish({ status: "imprecise" });
      const latCell = Math.floor((position.coords.latitude + 90) / 0.05);
      const lonCell = Math.floor((position.coords.longitude + 180) / 0.05);
      finish({ zoneKey: `zone-v1:${latCell}:${lonCell}`, status: "captured", accuracyClass: accuracy <= 50 ? "high" : "usable" });
    },
    (error) => finish({ status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
    { enableHighAccuracy: false, maximumAge: 30_000, timeout: 12_000 },
    ); } catch { finish({ status: "unavailable" }); }
  });
}

/** Load all owner-visible rides without losing recent records at the API row limit. */
export async function loadRideEventPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 500): Promise<{ data: T[] | null; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) return { data: null, error: page.error };
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) return { data: rows, error: null };
  }
}
