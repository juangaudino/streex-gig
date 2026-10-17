import { useMemo, useState } from "react";
import { CheckCircle2, Navigation, Play, Square, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { captureForegroundZone } from "@/lib/movementCapture";
import type { RideEvent, WeekRecord } from "@/lib/types";
import { getActiveShift, hasActiveShift } from "@/lib/shiftIntelligence";
import { getOperationalDate } from "@/lib/operationalDay";

interface RideCaptureControlProps {
  openWeek: WeekRecord;
  apps: string[];
  rideEvents: RideEvent[];
  onStart: (draft: { weekId: string; dayDate: string; shiftId?: string | null; app?: string | null; startedAt: string; capture: Awaited<ReturnType<typeof captureForegroundZone>> }) => Promise<RideEvent | null>;
  onPickup: (id: string, pickedUpAt: string, capture: Awaited<ReturnType<typeof captureForegroundZone>>) => Promise<RideEvent | null>;
  onFinish: (id: string, endedAt: string, capture: Awaited<ReturnType<typeof captureForegroundZone>>) => Promise<RideEvent | null>;
  onCancel?: (id: string) => Promise<boolean>;
  onUpdateTotals?: (app?: string | null) => void;
  compact?: boolean;
}

export default function RideCaptureControl({ openWeek, apps, rideEvents, onStart, onPickup, onFinish, onCancel, onUpdateTotals, compact = false }: RideCaptureControlProps) {
  const today = openWeek.entries.find((day) => day.date === getOperationalDate()) ?? null;
  const activeShiftDay = openWeek.entries.find(hasActiveShift) ?? today;
  const activeShift = activeShiftDay ? getActiveShift(activeShiftDay) : undefined;
  const activeRide = useMemo(() => rideEvents.find((event) => event.status === "active") ?? null, [rideEvents]);
  const completedPending = useMemo(() => rideEvents.filter((event) => event.status === "completed" && event.dayDate === today?.date).length, [rideEvents, today?.date]);
  const latestCompleted = useMemo(() => rideEvents.filter((event) => event.status === "completed" && event.dayDate === today?.date).sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))[0] ?? null, [rideEvents, today?.date]);
  const [app, setApp] = useState(() => apps.includes("Uber") ? "Uber" : apps[0] ?? "");
  const [capturing, setCapturing] = useState<"start" | "pickup" | "finish" | null>(null);
  const [lastCaptureResult, setLastCaptureResult] = useState<string | null>(null);

  async function startRide() {
    if (!today || !activeShift || capturing) return;
    const startedAt = new Date().toISOString();
    setCapturing("start");
    const capture = await captureForegroundZone();
    const event = await onStart({ weekId: openWeek.id, dayDate: today.date, shiftId: activeShift.id, app: app || null, startedAt, capture });
    setLastCaptureResult(!event ? "Ride was not saved. Try again." : capture.status === "captured" ? "En-route zone saved · confirm pickup when the passenger enters" : capture.status === "denied" ? "Location denied — en route saved without acceptance zone" : "En route saved without acceptance zone");
    setCapturing(null);
  }

  async function markPickup() {
    if (!activeRide || capturing) return;
    const pickedUpAt = new Date().toISOString();
    setCapturing("pickup");
    const capture = await captureForegroundZone();
    const event = await onPickup(activeRide.id, pickedUpAt, capture);
    setLastCaptureResult(!event ? "Pickup was not saved. Try again." : capture.status === "captured" ? "Pickup zone saved · earnings will belong to this zone" : capture.status === "denied" ? "Location denied — pickup saved without zone" : "Pickup saved without zone");
    setCapturing(null);
  }

  async function finishRide() {
    if (!activeRide || capturing) return;
    const endedAt = new Date().toISOString();
    setCapturing("finish");
    const capture = await captureForegroundZone();
    const event = await onFinish(activeRide.id, endedAt, capture);
    setLastCaptureResult(!event ? "Ride was not saved. Try again." : capture.status === "captured" ? "End zone saved · ride completed" : capture.status === "denied" ? "Location denied — ride finished without zone" : "End zone unavailable — ride finished without zone");
    setCapturing(null);
  }

  async function cancelRide(ride: RideEvent, label: string) {
    if (!onCancel || capturing) return;
    if (!confirm(`${label}? This removes only this live ride context. It does not change your shift, miles, rides, or earnings totals.`)) return;
    setCapturing("finish");
    const cancelled = await onCancel(ride.id);
    setLastCaptureResult(cancelled ? "Ride cancelled · totals unchanged" : "Ride could not be cancelled. Try again.");
    setCapturing(null);
  }

  const minutes = activeRide ? Math.max(0, Math.floor((Date.now() - Date.parse(activeRide.startedAt)) / 60_000)) : 0;
  const hasShift = Boolean(today && activeShift);
  const isNewLifecycle = activeRide?.lifecycleVersion === 2;
  const pickupConfirmed = Boolean(activeRide?.pickupAt);

  return (
    <section className={cn("rounded-xl border border-primary/25 bg-primary/5 p-3", compact && "p-2.5")} aria-label="Movement ride capture">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-background/70">
          <Navigation className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Movement</p>
          {activeRide ? (
            <>
              <p className="mt-0.5 text-sm font-bold">{activeRide.app || "Ride"} · {isNewLifecycle && !pickupConfirmed ? "En route" : "In progress"}</p>
              <p className="text-[11px] text-muted-foreground">
                {isNewLifecycle && !pickupConfirmed
                  ? `${activeRide.startCaptureStatus === "captured" ? "Acceptance zone saved" : "Acceptance zone unavailable"} · ${minutes} min`
                  : isNewLifecycle
                    ? `${activeRide.pickupCaptureStatus === "captured" ? "Pickup zone saved" : "Pickup zone unavailable"} · ${minutes} min`
                    : `${activeRide.startCaptureStatus === "captured" ? "Pickup zone saved" : "Pickup zone unavailable"} · ${minutes} min`}
              </p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-sm font-bold">No active ride</p>
              <p className="text-[11px] text-muted-foreground">{completedPending ? `${completedPending} completed ride${completedPending === 1 ? "" : "s"} pending · ${latestCompleted?.endCaptureStatus === "captured" ? "End zone saved" : latestCompleted?.endCaptureStatus === "denied" ? "Location denied" : "End zone unavailable"}` : hasShift ? "Capture acceptance, pickup, and destination while working" : "Start a shift in Quick Actions first"}</p>
            </>
          )}
        </div>
      </div>
      {!activeRide && (
        <div className="mt-3 flex gap-2">
          <Select value={app} onValueChange={setApp}>
            <SelectTrigger className="h-10 min-w-0 flex-1 bg-background/75"><SelectValue placeholder="App" /></SelectTrigger>
            <SelectContent>{apps.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" className="h-10 shrink-0" disabled={!hasShift || Boolean(capturing)} onClick={startRide}>
            <Play className="mr-1.5 h-4 w-4" />{capturing === "start" ? "Saving…" : "En route"}
          </Button>
        </div>
      )}
      {activeRide && isNewLifecycle && !pickupConfirmed && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" className="h-10" disabled={Boolean(capturing)} onClick={markPickup}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />{capturing === "pickup" ? "Saving…" : "Pickup"}
          </Button>
          <Button type="button" variant="outline" className="h-10" disabled={Boolean(capturing)} onClick={finishRide}>
            <Square className="mr-1.5 h-4 w-4" />Finish without pickup
          </Button>
        </div>
      )}
      {activeRide && (!isNewLifecycle || pickupConfirmed) && <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><Button type="button" className="h-10" disabled={Boolean(capturing)} onClick={finishRide}><Square className="mr-1.5 h-4 w-4" />{capturing === "finish" ? "Finishing…" : "Finish ride"}</Button>{onCancel && <Button type="button" variant="outline" className="h-10" disabled={Boolean(capturing)} onClick={() => cancelRide(activeRide, "Cancel this active ride")}><XCircle className="mr-1.5 h-4 w-4" />Cancel</Button>}</div>}
      {activeRide && isNewLifecycle && !pickupConfirmed && <p className="mt-2 text-[11px] text-muted-foreground">Pickup is the only zone eligible for this ride's earnings. Finishing without it keeps the ride as coverage only.</p>}
      {lastCaptureResult && <p className="mt-2 rounded-lg border border-primary/20 bg-background/70 px-2.5 py-2 text-xs font-medium text-foreground" role="status">{lastCaptureResult}</p>}
      {!activeRide && latestCompleted && onCancel && <Button type="button" variant="ghost" className="mt-2 h-9 w-full text-xs" disabled={Boolean(capturing)} onClick={() => cancelRide(latestCompleted, "Undo the last unlinked ride")}><Undo2 className="mr-1.5 h-3.5 w-3.5" />Undo last unlinked ride</Button>}
      {!activeRide && completedPending > 0 && onUpdateTotals && <Button type="button" variant="outline" className="mt-2 h-9 w-full" onClick={() => onUpdateTotals(rideEvents.filter((event) => event.status === "completed" && event.dayDate === today?.date).at(-1)?.app)}>
        Update totals in Quick Actions
      </Button>}
    </section>
  );
}
