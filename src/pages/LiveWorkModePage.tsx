import { useEffect, useMemo, useState } from "react";
import { NavLink, useOutletContext } from "react-router-dom";
import { Activity, CheckCircle2, Clock3, Pause, Play, RadioTower, Route, Square, Users } from "lucide-react";
import QuickEntryWidget from "@/components/QuickEntryWidget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dayTotal, formatCurrency } from "@/lib/store";
import {
  activeShiftDurationHours,
  createShift,
  endActiveShift,
  getActiveShift,
  getDayMiles,
  getDayRideCount,
  getOperationalDayShiftHours,
  hasActiveShift,
  isShiftPaused,
  pauseActiveShift,
  resumePausedShift,
} from "@/lib/shiftIntelligence";
import { adjustOctopusPoints } from "@/lib/octopusRewards";
import type { StoreContext } from "./types";
import { getOperationalDate } from "@/lib/operationalDay";

function statusLabel(hasActive: boolean, paused: boolean) {
  if (!hasActive) return "Ready";
  return paused ? "Paused" : "Working";
}

export default function LiveWorkModePage() {
  const { openWeek, weeks, settings, updateWeek, updateSettings, syncStatus, recordOperationalSnapshot } = useOutletContext<StoreContext>();
  const [now, setNow] = useState(() => new Date());
  const todayDate = getOperationalDate(now);
  const todayIdx = openWeek?.entries.findIndex((day) => day.date === todayDate) ?? -1;
  const activeDayIdx = openWeek?.entries.findIndex(hasActiveShift) ?? -1;
  const today = openWeek && todayIdx >= 0 ? openWeek.entries[todayIdx] : null;
  const activeDay = openWeek && activeDayIdx >= 0 ? openWeek.entries[activeDayIdx] : null;
  const activeShift = activeDay ? getActiveShift(activeDay) : null;
  const paused = activeShift ? isShiftPaused(activeShift) : false;
  const hasActive = Boolean(activeShift);
  const activeToday = Boolean(activeDay && activeDay.date === todayDate);
  const sym = settings.currencySymbol;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeHours = useMemo(
    () => activeShift ? activeShiftDurationHours(activeShift, now) : 0,
    [activeShift, now],
  );

  async function saveEntries(entries: NonNullable<typeof openWeek>["entries"]) {
    if (!openWeek) return false;
    return updateWeek({ ...openWeek, entries });
  }

  async function handleStart() {
    if (!openWeek || todayIdx < 0 || hasActive || today?.dayClosed) return;
    await saveEntries(openWeek.entries.map((day, idx) => (
      idx === todayIdx
        ? { ...day, shifts: [...(day.shifts ?? []), createShift(day.date)] }
        : day
    )));
  }

  async function handlePauseResume() {
    if (!openWeek || activeDayIdx < 0 || !activeShift) return;
    await saveEntries(openWeek.entries.map((day, idx) => {
      if (idx !== activeDayIdx) return day;
      return paused ? resumePausedShift(day) : pauseActiveShift(day);
    }));
  }

  async function handleEnd() {
    if (!openWeek || activeDayIdx < 0 || !activeShift) return;
    await saveEntries(openWeek.entries.map((day, idx) => (
      idx === activeDayIdx ? endActiveShift(day) : day
    )));
  }

  async function handleQuickUpdateSaved(event: { app: string; rideDelta: number; snapshot: Parameters<typeof recordOperationalSnapshot>[0] }) {
    await recordOperationalSnapshot(event.snapshot);
    if (event.app.toLowerCase() !== "uber" || event.rideDelta === 0) return;
    await updateSettings({
      ...settings,
      octopusPoints: Math.max(0, Math.round(adjustOctopusPoints(settings.octopusPoints, event.rideDelta) * 2) / 2),
      octopusUpdatedAt: new Date().toISOString(),
    });
  }

  if (!openWeek) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5 pb-10">
        <LiveHeader />
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <RadioTower className="mx-auto h-9 w-9 text-primary" />
          <h2 className="mt-3 text-xl font-bold">Start your current week first</h2>
          <p className="mt-2 text-sm text-muted-foreground">Live Work Mode uses the same trusted week and shift data as the rest of Streex.</p>
          <Button asChild className="mt-5"><NavLink to="/entry">Go to Entry</NavLink></Button>
        </div>
      </div>
    );
  }

  if (!today) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5 pb-10">
        <LiveHeader />
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
          <h2 className="text-xl font-bold">Today is outside the open week</h2>
          <p className="mt-2 text-sm text-muted-foreground">Open the correct week from Entry before starting live work.</p>
          <Button asChild className="mt-5"><NavLink to="/entry">Review Entry</NavLink></Button>
        </div>
      </div>
    );
  }

  const todayHours = getOperationalDayShiftHours(openWeek, today.date, now);
  const todayMiles = getDayMiles(today);
  const todayRides = getDayRideCount(today);
  const todayEarnings = dayTotal(today);
  const canStart = !hasActive && !today.dayClosed;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-10">
      <LiveHeader />

      <section className={cn(
        "overflow-hidden rounded-2xl border p-5 shadow-sm",
        hasActive && !paused && "border-success/35 bg-success/5",
        paused && "border-warning/35 bg-warning/5",
        !hasActive && "border-primary/20 bg-card",
      )}>
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "h-2.5 w-2.5 rounded-full",
                hasActive && !paused ? "animate-pulse bg-success" : paused ? "bg-warning" : "bg-primary",
              )} />
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{statusLabel(hasActive, paused)}</p>
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              {hasActive ? paused ? "Shift paused" : "Shift in progress" : "Ready to work"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasActive && activeDay
                ? `${activeDay.dayName} · started ${new Date(activeShift!.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : new Date(`${today.date}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </p>
            {hasActive && !activeToday && (
              <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                The active shift belongs to {activeDay?.date}. End it before starting today.
              </p>
            )}
          </div>

          <div className="grid min-w-[260px] grid-cols-2 gap-2">
            {!hasActive ? (
              <Button size="lg" className="col-span-2 gap-2" disabled={!canStart} onClick={handleStart}>
                <Play className="h-4 w-4" /> Start Shift
              </Button>
            ) : (
              <>
                <Button size="lg" className="gap-2" variant={paused ? "default" : "secondary"} onClick={handlePauseResume}>
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? "Resume" : "Pause"}
                </Button>
                <Button size="lg" className="gap-2" variant="outline" onClick={handleEnd}>
                  <Square className="h-4 w-4" /> End Shift
                </Button>
              </>
            )}
          </div>
        </div>

        {hasActive && (
          <div className="mt-5 flex items-center justify-between border-t border-current/10 pt-4">
            <span className="text-sm text-muted-foreground">Current shift time</span>
            <span className="font-mono text-2xl font-black">{activeHours.toFixed(1)}h</span>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard icon={Activity} label="Today" value={formatCurrency(todayEarnings, sym)} />
        <MetricCard icon={Clock3} label="Hours" value={`${todayHours.toFixed(1)}h`} />
        <MetricCard icon={Route} label="Miles" value={todayMiles > 0 ? todayMiles.toFixed(1) : "—"} />
        <MetricCard icon={Users} label="Rides" value={todayRides > 0 ? String(todayRides) : "—"} />
      </section>

      <section className="rounded-2xl border border-border bg-card/70 p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Live update</p>
            <p className="text-sm font-semibold">Record the totals you have now</p>
          </div>
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
            syncStatus === "saved" ? "bg-success/10 text-success" : syncStatus === "saving" ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning",
          )}>
            <CheckCircle2 className="h-3.5 w-3.5" /> {syncStatus}
          </span>
        </div>
        <QuickEntryWidget
          openWeek={openWeek}
          apps={settings.activeApps}
          currencySymbol={sym}
          onSave={updateWeek}
          weeks={weeks}
          onQuickUpdateSaved={handleQuickUpdateSaved}
        />
      </section>

      <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
        Earnings are accumulated totals by app. Rides are app-specific. Miles are the accumulated total for the day.
      </p>
    </div>
  );
}

function LiveHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <RadioTower className="h-5 w-5 text-primary" />
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-primary">Beta</span>
      </div>
      <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Live Work Mode</h1>
      <p className="mt-1 text-sm text-muted-foreground">A focused work surface using your existing Streex data.</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 truncate font-mono text-lg font-black sm:text-xl">{value}</p>
    </div>
  );
}
