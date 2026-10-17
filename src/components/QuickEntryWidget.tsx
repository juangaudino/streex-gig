import { useEffect, useRef, useState } from "react";
import { Zap, MoonStar, Lock, Clock, Route, Play, Pause, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { dayTotal, formatCurrency } from "@/lib/store";
import type { WeekRecord, DayEntry, OperationalSnapshotDraft, EarningsAttributionIntent, EarningsSnapshot, RideSnapshotAllocationDraft, ShiftSession, RideEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getDayOfWeekRecord } from "@/components/ActiveMomentum";
import { isExactTimeInsideWorkedShift } from "@/lib/earningsAttributions";
import { triggerCelebration } from "@/components/RecordCelebration";
import { createShift, endActiveShift, getActiveShift, getDayMiles, getDayRideCount, getOperationalDayShiftHours, getShiftMiles, hasActiveShift, isShiftPaused, pauseActiveShift, resumePausedShift, shiftDurationHours } from "@/lib/shiftIntelligence";
import { isRewardApp } from "@/lib/rewardIncome";
import { normalizeDecimalDraft, parseDecimalDraft } from "@/lib/decimalInput";
import { applyAccumulatedDayAppRideCount, getAppRideCount, getDayAppRideCount, getDayUnattributedRideCount } from "@/lib/rideAttribution";
import { applyAccumulatedDayMileage } from "@/lib/mileageAttribution";
import { createOperationalEventKey } from "@/lib/operationalSnapshots";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SingleFlight } from "@/lib/singleFlight";
import { getOperationalDate } from "@/lib/operationalDay";

interface QuickEntryWidgetProps {  
  openWeek: WeekRecord;
  apps: string[];
  currencySymbol: string;
  onSave: (updatedWeek: WeekRecord, attributionIntents?: EarningsAttributionIntent[], options?: { recordSnapshots?: boolean; onSnapshotsRecorded?: (snapshots: EarningsSnapshot[]) => Promise<void> | void }) => void | Promise<boolean>;
  weeks?: WeekRecord[];
  earningsSnapshots?: EarningsSnapshot[];
  /** Optional End Day handler — when provided, renders End Day next to Quick Add. */
  onEndDay?: () => void;
  onQuickUpdateSaved?: (event: {
    app: string;
    rideDelta: number;
    snapshot: OperationalSnapshotDraft;
    earningsSnapshotId?: string;
    rideEventIds?: string[];
    snapshotAllocations?: RideSnapshotAllocationDraft[];
  }) => void | Promise<void>;
  rideEvents?: RideEvent[];
  /** Header mode renders only one compact status trigger; actions remain inside the sheet. */
  compactTrigger?: boolean;
  quickActionRequest?: { id: number; app?: string | null } | null;
  /** A dashboard-only request is consumed once, so later background refreshes cannot reopen this sheet. */
  onQuickActionRequestHandled?: (id: number) => void;
}

function getTodayDayIdx(week: WeekRecord): number {
  const todayStr = getOperationalDate();
  const idx = week.entries.findIndex((d) => d.date === todayStr);
  return idx;
}

export default function QuickEntryWidget({ openWeek, apps, currencySymbol, onSave, weeks, earningsSnapshots = [], onEndDay, onQuickUpdateSaved, rideEvents = [], compactTrigger = false, quickActionRequest = null, onQuickActionRequestHandled }: QuickEntryWidgetProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [quickApp, setQuickApp] = useState<string | null>(null);
  const [quickAmountDraft, setQuickAmountDraft] = useState("");
  const todayIdx = getTodayDayIdx(openWeek);
  const today = todayIdx >= 0 ? openWeek.entries[todayIdx] : null;

  const [localApps, setLocalApps] = useState<Record<string, number>>({});
  const [localLogged, setLocalLogged] = useState(false);
  const [localMileage, setLocalMileage] = useState("");
  const [localRideCount, setLocalRideCount] = useState("");
  // Store the resolved index at open time so save always targets the same day
  const [resolvedIdx, setResolvedIdx] = useState(todayIdx);
  const [attributionChoice, setAttributionChoice] = useState<"automatic" | "shift" | "exact" | "pending">("pending");
  const [attributionShiftId, setAttributionShiftId] = useState("");
  const [attributionExactAt, setAttributionExactAt] = useState("");
  const [shiftAction, setShiftAction] = useState<"starting" | "pausing" | "resuming" | "ending" | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [linkClosedRides, setLinkClosedRides] = useState(false);
  const [rideAmountDraft, setRideAmountDraft] = useState("");
  const [showAttributionOptions, setShowAttributionOptions] = useState(false);
  const shiftFlight = useRef(new SingleFlight()).current;
  const updateFlight = useRef(new SingleFlight()).current;
  const handledQuickActionRequestId = useRef<number | null>(null);

  useEffect(() => {
    if (!quickActionRequest || !today) return;
    if (handledQuickActionRequestId.current === quickActionRequest.id) return;
    handledQuickActionRequestId.current = quickActionRequest.id;
    const requestedApp = quickActionRequest.app && apps.includes(quickActionRequest.app) ? quickActionRequest.app : null;
    setOpen(true);
    setMode("quick");
    setLocalApps({ ...today.apps });
    setResolvedIdx(todayIdx);
    if (requestedApp) {
      setQuickApp(requestedApp);
      setQuickAmountDraft((Number(today.apps?.[requestedApp]) || 0) > 0 ? String(Number(today.apps?.[requestedApp]) || 0) : "");
      setLocalRideCount(getDayAppRideCount(today, requestedApp) > 0 ? String(getDayAppRideCount(today, requestedApp)) : "");
      const active = getActiveShift(today) ?? getActiveShift(openWeek.entries.find(hasActiveShift) ?? today);
      setAttributionChoice(active ? "automatic" : "pending");
      setAttributionShiftId(active?.id ?? "");
      setAttributionExactAt("");
      setLinkClosedRides(false);
      setRideAmountDraft("");
      setShowAttributionOptions(false);
    }
    onQuickActionRequestHandled?.(quickActionRequest.id);
  }, [apps, onQuickActionRequestHandled, quickActionRequest, today, todayIdx]);

  function handleOpen(isOpen: boolean) {
    if (isOpen && today) {
      const active = getActiveShift(today) ?? getActiveShift(openWeek.entries.find(hasActiveShift) ?? today);
      setLocalApps({ ...today.apps });
      setLocalLogged(today.logged !== undefined ? today.logged : dayTotal(today) > 0);
      setResolvedIdx(todayIdx);
      const accumulatedMileage = getDayMiles(today);
      setLocalMileage(accumulatedMileage > 0 ? String(accumulatedMileage) : "");
      setLocalRideCount("");
      setMode("quick");
      setQuickApp(null);
      setQuickAmountDraft("");
      setAttributionChoice(active ? "automatic" : "pending");
      setAttributionShiftId(active?.id ?? "");
      setAttributionExactAt("");
      setLinkClosedRides(false);
      setRideAmountDraft("");
      setShowAttributionOptions(false);
    }
    setOpen(isOpen);
  }

  async function persistQuickWeek(updatedWeek: WeekRecord, attributionIntents: EarningsAttributionIntent[] = [], options?: { onSnapshotsRecorded?: (snapshots: EarningsSnapshot[]) => Promise<void> | void }): Promise<boolean> {
    try {
      const result = await onSave(updatedWeek, attributionIntents, options);
      return result !== false;
    } catch (error) {
      console.error("[QuickEntryWidget] week update failed", { weekId: updatedWeek.id, error });
      return false;
    }
  }

  async function handleSave() {
    if (!today || resolvedIdx < 0) return;
    const dt = Object.values(localApps).reduce((s, v) => s + (v || 0), 0);
    const prevTotal = dayTotal(today);
    const mileage = parseFloat(localMileage);
    const entries = openWeek.entries.map((d, i) => {
      if (i !== resolvedIdx) return d;
      return { ...d, apps: { ...localApps }, logged: dt > 0 ? true : localLogged, mileage: Number.isFinite(mileage) ? mileage : d.mileage };
    });
    // Check if this save breaks a record
    if (weeks && today && dt > prevTotal) {
      const dayRec = getDayOfWeekRecord(weeks, today.dayName);
      const dayRecExcluding = getDayOfWeekRecord(weeks, today.dayName, today.date);
      if (dt > dayRecExcluding.record && dayRecExcluding.record > 0) {
        triggerCelebration({
          id: `day-record-${Date.now()}`,
          type: "weekday-record",
          title: `New ${today.dayName} Record`,
          value: formatCurrency(dt, currencySymbol),
          icon: "🏆",
          subtitle: `Previous best: ${formatCurrency(dayRec.record, currencySymbol)}`,
        });
      }
    }
    const saved = await persistQuickWeek({ ...openWeek, entries });
    if (saved) setOpen(false);
  }

  async function handleQuickSave(app: string) {
    if (!today || resolvedIdx < 0 || updateFlight.running) return;
    await updateFlight.run(async () => {
      setSavingUpdate(true);
      try {
    const appTotal = parseDecimalDraft(quickAmountDraft) ?? 0;
    const prevTotal = dayTotal(today);
    const mileage = localMileage.trim() === "" ? null : Math.max(0, parseFloat(localMileage) || 0);
    const rides = localRideCount.trim() === "" ? null : Math.max(0, Math.trunc(Number(localRideCount) || 0));
    const activeShift = getActiveShift(today) ?? getActiveShift(openWeek.entries.find(hasActiveShift) ?? today);
    const previousAmount = Number(today.apps?.[app]) || 0;
    const positiveDelta = appTotal - previousAmount;
    const rideUpdate = rides === null
      ? null
      : activeShift && today.shifts?.some((shift) => shift.id === activeShift.id)
        ? applyAccumulatedDayAppRideCount(today, activeShift.id, app, rides)
        : {
            day: {
              ...today,
              rideCount: Math.max(0, getDayRideCount(today) + rides - getDayAppRideCount(today, app)),
            },
            appRideDelta: rides - getDayAppRideCount(today, app),
          };
    const entries = openWeek.entries.map((d, i) => {
      if (i !== resolvedIdx) return d;
      const nextApps = { ...d.apps, [app]: appTotal };
      const shifts = rideUpdate?.day.shifts ?? d.shifts ?? [];
      let nextDay: DayEntry = {
        ...d,
        apps: nextApps,
        logged: Object.values(nextApps).some((value) => (Number(value) || 0) > 0) ? true : d.logged,
        shifts,
        ...(rideUpdate && !d.shifts?.some((shift) => shift.id === activeShift?.id)
          ? { rideCount: rideUpdate.day.rideCount }
          : {}),
      };
      if (mileage !== null) {
        nextDay = activeShift && today.shifts?.some((shift) => shift.id === activeShift.id)
          ? applyAccumulatedDayMileage(nextDay, activeShift.id, mileage)
          : { ...nextDay, mileage };
      }
      return nextDay;
    });
    const nextDay = entries[resolvedIdx];
    const nextTotal = nextDay ? dayTotal(nextDay) : appTotal;
    if (weeks && nextDay && nextTotal > prevTotal) {
      const dayRec = getDayOfWeekRecord(weeks, nextDay.dayName);
      const dayRecExcluding = getDayOfWeekRecord(weeks, nextDay.dayName, nextDay.date);
      if (nextTotal > dayRecExcluding.record && dayRecExcluding.record > 0) {
        triggerCelebration({
          id: `day-record-${Date.now()}`,
          type: "weekday-record",
          title: `New ${nextDay.dayName} Record`,
          value: formatCurrency(nextTotal, currencySymbol),
          icon: "🏆",
          subtitle: `Previous best: ${formatCurrency(dayRec.record, currencySymbol)}`,
        });
      }
    }
    const selectedShift = completedShiftOptions.find((option) => option.shift.id === attributionShiftId);
    const now = new Date();
    let attributionIntent: EarningsAttributionIntent | null = null;
    if (positiveDelta > 0) {
      if (attributionChoice === "automatic" && activeShift) {
        const previousSnapshot = earningsSnapshots
          .filter((snapshot) => snapshot.dayDate === today.date && snapshot.app === app && snapshot.shiftId === activeShift.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        attributionIntent = {
          dayDate: today.date,
          app,
          previousAmount,
          newAmount: appTotal,
          status: "resolved",
          mode: "update_interval",
          attributedDayDate: today.date,
          shiftId: activeShift.id,
          effectiveStartAt: previousSnapshot?.createdAt ?? activeShift.startTime,
          effectiveEndAt: now.toISOString(),
          source: "automatic",
          confidence: "estimated",
          note: "Distributed across worked time since the previous same-app update.",
        };
      } else if (attributionChoice === "shift" && selectedShift) {
        attributionIntent = {
          dayDate: today.date,
          app,
          previousAmount,
          newAmount: appTotal,
          status: "resolved",
          mode: "shift_distributed",
          attributedDayDate: selectedShift.day.date,
          shiftId: selectedShift.shift.id,
          effectiveStartAt: selectedShift.shift.startTime,
          effectiveEndAt: selectedShift.shift.endTime,
          source: "user",
          confidence: "estimated",
          note: "User assigned the delta to this shift; amount is distributed across worked blocks.",
        };
      } else if (attributionChoice === "exact" && selectedShift && attributionExactAt && isExactTimeInsideWorkedShift(selectedShift.shift, attributionExactAt)) {
        const exact = new Date(attributionExactAt);
        if (!Number.isNaN(exact.getTime())) {
          attributionIntent = {
            dayDate: today.date,
            app,
            previousAmount,
            newAmount: appTotal,
            status: "resolved",
            mode: "exact",
            attributedDayDate: selectedShift.day.date,
            shiftId: selectedShift.shift.id,
            effectiveStartAt: exact.toISOString(),
            effectiveEndAt: exact.toISOString(),
            source: "user",
            confidence: "confirmed",
            note: "User supplied the exact earning time.",
          };
        }
      }
      if (!attributionIntent) {
        attributionIntent = {
          dayDate: today.date,
          app,
          previousAmount,
          newAmount: appTotal,
          status: "pending",
          mode: "unassigned",
          source: "user",
          confidence: "unassigned",
          note: "Saved safely for later attribution review.",
        };
      }
    }
    const rideEventsToLink = linkClosedRides && positiveDelta > 0
      ? rideEvents.filter((event) => event.status === "completed" && event.dayDate === today.date && event.app === app).map((event) => event.id)
      : [];
    const linkedRideAmount = parseDecimalDraft(rideAmountDraft) ?? 0;
    const singleRideForAllocation = rideEventsToLink.length === 1 ? rideEvents.find((event) => event.id === rideEventsToLink[0]) : null;
    const snapshotAllocations: RideSnapshotAllocationDraft[] = singleRideForAllocation && linkedRideAmount > 0 && linkedRideAmount <= positiveDelta
      ? [
        {
          rideEventId: singleRideForAllocation.id,
          kind: "ride_base",
          amount: linkedRideAmount,
          observedAt: now.toISOString(),
          attributedDayDate: singleRideForAllocation.dayDate,
          shiftId: singleRideForAllocation.shiftId ?? null,
          effectiveStartAt: singleRideForAllocation.startedAt,
          effectiveEndAt: singleRideForAllocation.endedAt ?? null,
          note: "Confirmed base amount for this ride.",
        },
        ...(positiveDelta - linkedRideAmount > 0.004 ? [{
          kind: attributionChoice === "pending" ? "unassigned" as const : "update_interval" as const,
          amount: +(positiveDelta - linkedRideAmount).toFixed(2),
          observedAt: now.toISOString(),
          attributedDayDate: attributionIntent?.attributedDayDate ?? today.date,
          shiftId: attributionIntent?.shiftId ?? null,
          effectiveStartAt: attributionIntent?.effectiveStartAt ?? null,
          effectiveEndAt: attributionIntent?.effectiveEndAt ?? null,
          note: "Remaining observed amount kept separate from the confirmed ride amount.",
        }] : []),
      ]
      : [];
    let earningsSnapshotId: string | undefined;
    const saved = await persistQuickWeek({ ...openWeek, entries }, attributionIntent ? [attributionIntent] : [], {
      onSnapshotsRecorded: (snapshots) => {
        const matching = snapshots.find((snapshot) => snapshot.dayDate === today.date && snapshot.app === app && Number(snapshot.previousAmount) === previousAmount && Number(snapshot.newAmount) === appTotal);
        earningsSnapshotId = matching?.id;
      },
    });
    if (saved) {
      const savedShift = nextDay?.shifts?.find((shift) => shift.id === activeShift?.id);
      await onQuickUpdateSaved?.({
        app,
        rideDelta: rideUpdate?.appRideDelta ?? 0,
        snapshot: {
          eventKey: createOperationalEventKey(),
          dayDate: nextDay.date,
          shiftId: activeShift?.id ?? savedShift?.id ?? null,
          recordedAt: new Date().toISOString(),
          appTotals: { ...nextDay.apps },
          ridesByApp: { ...(savedShift?.ridesByApp ?? activeShift?.ridesByApp ?? {}) },
          dayMileage: getDayMiles(nextDay),
        },
        earningsSnapshotId,
        rideEventIds: earningsSnapshotId ? rideEventsToLink : [],
        snapshotAllocations: earningsSnapshotId ? snapshotAllocations : [],
      });
      setOpen(false);
    }
      } finally {
        setSavingUpdate(false);
      }
    });
  }

  function selectQuickApp(app: string) {
    setQuickApp(app);
    const currentAmount = Number(localApps[app]) || 0;
    setQuickAmountDraft(currentAmount > 0 ? String(currentAmount) : "");
    const active = today ? getActiveShift(today) : null;
    setAttributionChoice(active ? "automatic" : "pending");
    setAttributionShiftId(active?.id ?? "");
    setAttributionExactAt("");
    setLinkClosedRides(false);
    setRideAmountDraft("");
    setShowAttributionOptions(false);
    const appRidesToday = getDayAppRideCount(today, app);
    setLocalRideCount(appRidesToday > 0 ? String(appRidesToday) : "");
  }

  function openFullEntry() {
    if (quickApp) {
      const parsedDraft = parseDecimalDraft(quickAmountDraft);
      if (parsedDraft !== null) {
        setLocalApps((prev) => ({ ...prev, [quickApp]: parsedDraft }));
      }
    }
    setMode("full");
  }

  async function handleStartShift() {
    if (shiftFlight.running) return;
    const targetIdx = resolvedIdx >= 0 ? resolvedIdx : todayIdx;
    if (targetIdx < 0 || openWeek.entries.some(hasActiveShift)) return;
    const entries = openWeek.entries.map((d, i) => {
      if (i !== targetIdx) return d;
      return { ...d, shifts: [...(d.shifts ?? []), createShift(d.date)] };
    });
    await shiftFlight.run(async () => {
      setShiftAction("starting");
      try {
        const saved = await persistQuickWeek({ ...openWeek, entries });
        if (saved) toast({ title: "Shift started." });
      } finally {
        setShiftAction(null);
      }
    });
  }

  async function handleEndShift() {
    if (shiftFlight.running) return;
    const targetIdx = openWeek.entries.findIndex(hasActiveShift);
    if (targetIdx < 0) return;
    const entries = openWeek.entries.map((d, i) => i === targetIdx ? endActiveShift(d) : d);
    await shiftFlight.run(async () => {
      setShiftAction("ending");
      try {
        const saved = await persistQuickWeek({ ...openWeek, entries });
        if (saved) toast({ title: "Shift ended." });
      } finally {
        setShiftAction(null);
      }
    });
  }

  async function handlePauseResumeShift() {
    if (shiftFlight.running) return;
    const targetIdx = openWeek.entries.findIndex(hasActiveShift);
    if (targetIdx < 0) return;
    const targetDay = openWeek.entries[targetIdx];
    const openShift = getActiveShift(targetDay);
    if (!openShift) return;
    const paused = isShiftPaused(openShift);
    const entries = openWeek.entries.map((d, i) => {
      if (i !== targetIdx) return d;
      return paused ? resumePausedShift(d) : pauseActiveShift(d);
    });
    await shiftFlight.run(async () => {
      setShiftAction(paused ? "resuming" : "pausing");
      try {
        const saved = await persistQuickWeek({ ...openWeek, entries });
        if (saved) toast({ title: paused ? "Shift resumed." : "Shift paused." });
      } finally {
        setShiftAction(null);
      }
    });
  }

  if (!today || todayIdx < 0) return null;

  const todayTotal = dayTotal(today);
  const now = new Date();
  const dayLabel = new Date(`${today.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const isClosed = !!today.dayClosed;
  const weekHasActiveShift = openWeek.entries.some(hasActiveShift);
  const todayHasActiveShift = hasActiveShift(today) || weekHasActiveShift;
  const activeShiftDayIdx = openWeek.entries.findIndex(hasActiveShift);
  const activeShiftDay = activeShiftDayIdx >= 0 ? openWeek.entries[activeShiftDayIdx] : today;
  const shiftHours = getOperationalDayShiftHours(openWeek, today.date);
  const standardApps = apps.filter((app) => !isRewardApp(app));
  const preferredApps = ["Uber", "Lyft"].filter((app) => standardApps.includes(app));
  const primaryApps = [
    ...preferredApps,
    ...standardApps.filter((app) => !preferredApps.includes(app)),
  ].slice(0, 2);
  const activeShift = getActiveShift(activeShiftDay);
  const todayActiveShift = getActiveShift(today);
  const activeShiftPaused = activeShift ? isShiftPaused(activeShift) : false;
  const completedShiftOptions = (weeks ?? [openWeek]).flatMap((week) => week.entries.flatMap((day) =>
    (day.shifts ?? []).filter((shift): shift is ShiftSession & { endTime: string } => Boolean(shift.endTime)).map((shift) => ({ week, day, shift })),
  )).sort((a, b) => b.shift.endTime.localeCompare(a.shift.endTime));
  const quickDraftAmount = parseDecimalDraft(quickAmountDraft);
  const quickPositiveDelta = quickApp && quickDraftAmount !== null
    ? quickDraftAmount - (Number(today.apps?.[quickApp]) || 0)
    : 0;
  const selectedAttributionShift = completedShiftOptions.find((option) => option.shift.id === attributionShiftId);
  const exactAttributionValid = Boolean(
    selectedAttributionShift
    && attributionExactAt
    && isExactTimeInsideWorkedShift(selectedAttributionShift.shift, attributionExactAt),
  );
  const attributionReady = quickPositiveDelta <= 0
    || attributionChoice === "pending"
    || (attributionChoice === "automatic" && Boolean(todayActiveShift))
    || (attributionChoice === "shift" && Boolean(attributionShiftId))
    || (attributionChoice === "exact" && exactAttributionValid);
  const selectedAppDayRides = quickApp ? getDayAppRideCount(today, quickApp) : 0;
  const selectedAppShiftRides = quickApp && todayActiveShift ? getAppRideCount(todayActiveShift, quickApp) ?? 0 : 0;
  const dayUnattributedRides = getDayUnattributedRideCount(today);
  const rideUpdateReady = localRideCount.trim() === "" || dayUnattributedRides === 0;
  const completedRidesForQuickApp = quickApp
    ? rideEvents.filter((event) => event.status === "completed" && event.dayDate === today.date && event.app === quickApp)
    : [];
  const isBatchRideLink = linkClosedRides && completedRidesForQuickApp.length > 1;
  const linkedRideAmount = parseDecimalDraft(rideAmountDraft);
  const rideAllocationReady = !linkClosedRides || completedRidesForQuickApp.length !== 1 || linkedRideAmount === null || (linkedRideAmount >= 0 && linkedRideAmount <= quickPositiveDelta);

  return (
    <div className={compactTrigger ? "shrink-0" : "bg-card rounded-xl border border-primary/20 p-4 space-y-3"}>
      {!compactTrigger && (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today</p>
          <p className="text-sm font-semibold">{dayLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xl font-bold font-mono text-primary">
            {formatCurrency(todayTotal, currencySymbol)}
          </span>
          {isClosed && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
              <Lock className="h-3 w-3" /> Day Closed
            </span>
          )}
        </div>
      </div>
      )}
      {isClosed ? (
        !compactTrigger && <p className="text-xs text-muted-foreground/80 leading-relaxed">
          Day finalized. Edit entries from the Entry screen if needed.
        </p>
      ) : (
      <div className={cn("grid gap-2", onEndDay ? "grid-cols-[1fr_auto]" : "grid-cols-1")}>
      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetTrigger asChild>
          {compactTrigger ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "h-10 min-w-[84px] max-w-[104px] gap-1.5 rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wide",
                weekHasActiveShift && !activeShiftPaused && "border-success/35 bg-success/10 text-success hover:bg-success/15",
                weekHasActiveShift && activeShiftPaused && "border-warning/35 bg-warning/10 text-warning hover:bg-warning/15",
              )}
              aria-label="Open Quick Actions"
            >
              {shiftAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : weekHasActiveShift ? activeShiftPaused ? <Play className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-success" /> : <Play className="h-3.5 w-3.5" />}
              <span className="truncate">{shiftAction ? "Saving" : weekHasActiveShift ? activeShiftPaused ? "Paused" : "Working" : "Start"}</span>
            </Button>
          ) : (
            <Button size="sm" className="w-full gap-2">
              <Zap className="h-4 w-4" />
              Quick Actions
            </Button>
          )}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle className="text-left">
              {mode === "quick" ? "Quick Actions" : dayLabel}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 mt-4">
            {mode === "quick" ? (
              <>
                {!quickApp ? (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Current shift</p>
                          <p className="truncate text-sm font-semibold">
                            {weekHasActiveShift
                              ? `${activeShiftDay.dayName} · ${activeShiftPaused ? "Paused" : "Working"}`
                              : "No active shift"}
                          </p>
                        </div>
                        {weekHasActiveShift && (
                          <span className={cn(
                            "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                            activeShiftPaused ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
                          )}>
                            {activeShiftPaused ? "Paused" : "Live"}
                          </span>
                        )}
                      </div>
                      {weekHasActiveShift ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            className="h-12 gap-2"
                            variant={activeShiftPaused ? "default" : "secondary"}
                            disabled={Boolean(shiftAction)}
                            onClick={handlePauseResumeShift}
                          >
                            {shiftAction === "pausing" || shiftAction === "resuming" ? <Loader2 className="h-4 w-4 animate-spin" /> : activeShiftPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                            {shiftAction === "pausing" ? "Pausing…" : shiftAction === "resuming" ? "Resuming…" : activeShiftPaused ? "Resume" : "Pause"}
                          </Button>
                          <Button
                            type="button"
                            className="h-12 gap-2 border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            variant="outline"
                            disabled={Boolean(shiftAction)}
                            onClick={handleEndShift}
                          >
                            {shiftAction === "ending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                            {shiftAction === "ending" ? "Ending…" : "End Shift"}
                          </Button>
                        </div>
                      ) : (
                        <Button type="button" className="h-12 w-full gap-2" disabled={Boolean(shiftAction)} onClick={handleStartShift}>
                          {shiftAction === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {shiftAction === "starting" ? "Starting…" : "Start Shift"}
                        </Button>
                      )}
                    </div>
                    <p className="px-1 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Update earnings</p>
                    {primaryApps.map((app) => (
                      <Button
                        key={app}
                        type="button"
                        variant="outline"
                        className="h-16 w-full justify-between rounded-xl px-4"
                        onClick={() => selectQuickApp(app)}
                      >
                        <span className="text-base font-semibold">{app}</span>
                        <span className="font-mono text-lg text-primary">
                          {formatCurrency(localApps[app] || 0, currencySymbol)}
                        </span>
                      </Button>
                    ))}
                    <Button type="button" variant="secondary" className="w-full" onClick={openFullEntry}>
                      More Apps
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {quickApp} total today
                      </label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]{0,2}"
                        className="mt-2 h-16 text-right font-mono text-4xl font-bold"
                        placeholder="0.00"
                        value={quickAmountDraft}
                        onChange={(e) => {
                          const nextDraft = normalizeDecimalDraft(e.target.value);
                          if (nextDraft !== null) setQuickAmountDraft(nextDraft);
                        }}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Enter the current accumulated total, not an amount to add.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-xl border border-border bg-background/60 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Day miles</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="mt-1 h-10 text-right font-mono"
                          placeholder="optional"
                          value={localMileage}
                          onChange={(e) => setLocalMileage(e.target.value)}
                        />
                      </label>
                      <label className="rounded-xl border border-border bg-background/60 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{quickApp} rides today</span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 h-10 text-right font-mono"
                          placeholder={todayActiveShift ? "optional" : "needs shift"}
                          value={localRideCount}
                          onChange={(e) => setLocalRideCount(e.target.value)}
                          disabled={!todayActiveShift}
                        />
                      </label>
                    </div>
                    {!todayActiveShift && (
                      <p className="text-xs text-muted-foreground">
                        Rides are saved to the active shift. Start a shift to track ride count.
                      </p>
                    )}
                    {todayActiveShift && (
                      <p className="text-xs text-muted-foreground">
                        Miles and rides are today&apos;s accumulated totals. Streex assigns only the ride change to this shift.
                      </p>
                    )}
                    {todayActiveShift && (
                      <p className="text-xs text-muted-foreground">
                        Recorded: {selectedAppDayRides} {quickApp} rides today · {selectedAppShiftRides} in this shift.
                      </p>
                    )}
                    {!rideUpdateReady && (
                      <p className="text-xs text-destructive">
                        Earlier rides have no app assignment. Leave rides blank for this save so Streex does not guess or duplicate them.
                      </p>
                    )}
                    {todayActiveShift && quickApp.toLowerCase() === "uber" && (
                      <p className="text-xs text-muted-foreground">
                        Uber ride changes also update Octopus reward progress.
                      </p>
                    )}
                    {quickPositiveDelta > 0 && (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider">Earnings attribution</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(quickPositiveDelta, currencySymbol)} was observed now.</p>
                        </div>
                        {!showAttributionOptions && (
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/15 bg-background/70 px-3 py-2">
                            <p className="text-xs font-medium">{attributionChoice === "automatic" ? "Since last update in this shift" : "Review later in Data Health"}</p>
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowAttributionOptions(true)}>Change</Button>
                          </div>
                        )}
                        {showAttributionOptions && <Select value={attributionChoice} onValueChange={(value) => {
                          const next = value as typeof attributionChoice;
                          setAttributionChoice(next);
                          if (next === "automatic" && todayActiveShift) setAttributionShiftId(todayActiveShift.id);
                        }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {todayActiveShift && <SelectItem value="automatic">Since last update in this shift</SelectItem>}
                            <SelectItem value="shift">Spread across a selected shift</SelectItem>
                            {!isBatchRideLink && <SelectItem value="exact">Assign exact ride time</SelectItem>}
                            <SelectItem value="pending">Review later in Data Health</SelectItem>
                          </SelectContent>
                        </Select>}
                        {(attributionChoice === "shift" || attributionChoice === "exact") && (
                          <Select value={attributionShiftId} onValueChange={setAttributionShiftId}>
                            <SelectTrigger><SelectValue placeholder="Select day and shift" /></SelectTrigger>
                            <SelectContent>
                              {completedShiftOptions.map(({ day, shift }) => (
                                <SelectItem key={shift.id} value={shift.id}>
                                  {day.date} · {new Date(shift.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{new Date(shift.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {attributionChoice === "exact" && (
                          <div className="space-y-1.5">
                            <Input type="datetime-local" value={attributionExactAt} onChange={(event) => setAttributionExactAt(event.target.value)} />
                            {attributionExactAt && !exactAttributionValid && (
                              <p className="text-xs text-destructive">Exact time must fall inside worked time, not during a pause.</p>
                            )}
                          </div>
                        )}
                        {attributionChoice === "pending" && (
                          <p className="text-xs text-muted-foreground">The money remains in your reported total but stays out of hourly rankings until reviewed.</p>
                        )}
                      </div>
                    )}
                    {quickPositiveDelta > 0 && completedRidesForQuickApp.length > 0 && (
                      <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <label className="flex cursor-pointer items-start gap-3">
                          <Checkbox checked={linkClosedRides} onCheckedChange={(checked) => {
                            const linking = checked === true;
                            setLinkClosedRides(linking);
                            if (linking && todayActiveShift && attributionChoice === "pending") setAttributionChoice("automatic");
                            if (linking && completedRidesForQuickApp.length > 1 && attributionChoice === "exact") setAttributionChoice(todayActiveShift ? "automatic" : "pending");
                          }} />
                          <span className="space-y-0.5">
                            <span className="block text-xs font-semibold">{completedRidesForQuickApp.length === 1 ? "Link this update to the ride just closed" : `Link this update to ${completedRidesForQuickApp.length} closed rides`}</span>
                            <span className="block text-xs text-muted-foreground">This records confirmed ride and zone context. It never splits a batch automatically.</span>
                          </span>
                        </label>
                        {linkClosedRides && completedRidesForQuickApp.length === 1 && (
                          <div className="rounded-lg border border-border bg-background/70 p-2.5">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Known amount for this ride</label>
                            <Input type="text" inputMode="decimal" className="mt-1 h-10 text-right font-mono" placeholder="optional" value={rideAmountDraft} onChange={(event) => {
                              const nextDraft = normalizeDecimalDraft(event.target.value);
                              if (nextDraft !== null) setRideAmountDraft(nextDraft);
                            }} />
                            <p className="mt-1.5 text-xs text-muted-foreground">Leave blank if you only want the ride context. If known, the remainder stays separate from this ride.</p>
                            {linkedRideAmount !== null && (linkedRideAmount < 0 || linkedRideAmount > quickPositiveDelta) && <p className="mt-1.5 text-xs text-destructive">This amount must be between 0 and {formatCurrency(quickPositiveDelta, currencySymbol)}.</p>}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" onClick={() => setQuickApp(null)}>
                        Back
                      </Button>
                      <Button type="button" disabled={!attributionReady || !rideUpdateReady || !rideAllocationReady || savingUpdate} onClick={() => handleQuickSave(quickApp)}>
                        {savingUpdate ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save Update"}
                      </Button>
                    </div>
                    <Button type="button" variant="ghost" className="w-full" onClick={openFullEntry}>
                      More Apps
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                {standardApps.map((app) => (
                  <div key={app} className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium min-w-0 truncate flex-1">{app}</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28 text-right font-mono"
                      placeholder="0.00"
                      value={localApps[app] || ""}
                      onChange={(e) =>
                        setLocalApps((prev) => ({ ...prev, [app]: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between w-full gap-3 pb-2">
                    <label className="text-sm text-muted-foreground">Day miles</label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      className="w-20 text-right font-mono text-sm"
                      placeholder="0.0"
                      value={localMileage}
                      onChange={(e) => setLocalMileage(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            {mode === "full" && (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Shift Blocks
                  </p>
                  <p className="text-xs text-muted-foreground">{shiftHours.toFixed(1)}h logged today</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={todayHasActiveShift ? "secondary" : "default"}
                  disabled={Boolean(shiftAction) || (!todayHasActiveShift && weekHasActiveShift)}
                  onClick={todayHasActiveShift ? handlePauseResumeShift : handleStartShift}
                >
                  {shiftAction === "starting" ? "Starting…" : shiftAction === "pausing" ? "Pausing…" : shiftAction === "resuming" ? "Resuming…" : todayHasActiveShift ? activeShiftPaused ? "Resume" : "Pause" : "Start"}
                </Button>
              </div>
              {todayHasActiveShift && (
                <Button type="button" size="sm" variant="outline" className="w-full" disabled={Boolean(shiftAction)} onClick={handleEndShift}>
                  {shiftAction === "ending" ? "Ending…" : "End Shift"}
                </Button>
              )}
              {(today.shifts ?? []).map((shift) => (
                <div key={shift.id} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {new Date(shift.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        {shift.endTime ? ` → ${new Date(shift.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : isShiftPaused(shift) ? " → paused" : " → active"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {shift.endTime ? `${shiftDurationHours(shift).toFixed(1)}h` : isShiftPaused(shift) ? "break in progress" : "running"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Route className="h-3.5 w-3.5" />
                      {getShiftMiles(today, shift).toFixed(1)} mi
                    </span>
                  </div>
                </div>
              ))}
              {!todayHasActiveShift && weekHasActiveShift && (
                <p className="text-xs text-muted-foreground">
                  Another shift is already active. End it from Entry before starting a new one.
                </p>
              )}
            </div>
            )}
            {mode === "full" && (
            <>
            <div className="flex items-center gap-2 border-t border-border pt-2">
              <Checkbox
                id="quick-logged"
                checked={localLogged || Object.values(localApps).some((v) => v > 0)}
                onCheckedChange={(checked) => setLocalLogged(!!checked)}
                disabled={Object.values(localApps).some((v) => v > 0)}
              />
              <label htmlFor="quick-logged" className="text-sm text-muted-foreground">
                Mark as logged
              </label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Total: <span className="font-bold font-mono text-foreground">
                  {formatCurrency(Object.values(localApps).reduce((s, v) => s + (v || 0), 0), currencySymbol)}
                </span>
              </span>
              <Button onClick={handleSave}>Save Today</Button>
            </div>
            </>
            )}
          </div>
        </SheetContent>
      </Sheet>
        {onEndDay && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEndDay}
            className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold whitespace-nowrap"
          >
            <MoonStar className="h-4 w-4" />
            End Day
          </Button>
        )}
      </div>
      )}
    </div>
  );
}
