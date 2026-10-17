import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { dayTotal, formatCurrency } from "@/lib/store";
import { bonusDayTotal, isRewardApp, standardDayEarnings } from "@/lib/rewardIncome";
import type { DayEntry, WeekRecord } from "@/lib/types";
import { ArrowLeft, Plus, Save, StickyNote, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { getActiveShift, getDayRideCount, getOperationalDayShiftHours, getShiftMiles, hasActiveShift, isShiftPaused, shiftBreakHours, shiftDurationHours } from "@/lib/shiftIntelligence";
import { formatRideAttribution } from "@/lib/rideAttribution";

interface MobileDayDetailProps {
  day: DayEntry;
  week?: WeekRecord;
  dayIdx: number;
  apps: string[];
  currencySymbol: string;
  onBack: () => void;
  onUpdate: (dayIdx: number, app: string, val: string) => void;
  onLoggedToggle: (dayIdx: number, checked: boolean) => void;
  onMileageUpdate?: (dayIdx: number, val: number) => void;
  onNoteUpdate?: (dayIdx: number, value: string) => void;
  onStartShift?: (dayIdx: number) => void;
  onAddHistoricalShift?: (dayIdx: number) => void;
  onEndShift?: (dayIdx: number) => void;
  onPauseResumeShift?: (dayIdx: number) => void;
  onShiftMilesUpdate?: (dayIdx: number, shiftId: string, val: string) => void;
  onShiftRideCountUpdate?: (dayIdx: number, shiftId: string, val: string) => void;
  onShiftEarningsUpdate?: (dayIdx: number, shiftId: string, val: string) => void;
  onShiftTimeUpdate?: (dayIdx: number, shiftId: string, field: "startTime" | "endTime", val: string) => void;
  onDeleteShift?: (dayIdx: number, shiftId: string) => void;
  onAddBonus?: (dayIdx: number, app: string, amount: number) => void;
  onDeleteBonus?: (dayIdx: number, bonusId: string) => void;
  onSave: () => void;
}

function timeInputValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isValidTimeInput(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function MobileDayDetail({
  day,
  week,
  dayIdx,
  apps,
  currencySymbol,
  onBack,
  onUpdate,
  onLoggedToggle,
  onMileageUpdate,
  onNoteUpdate,
  onStartShift,
  onAddHistoricalShift,
  onEndShift,
  onPauseResumeShift,
  onShiftMilesUpdate,
  onShiftRideCountUpdate,
  onShiftEarningsUpdate,
  onShiftTimeUpdate,
  onDeleteShift,
  onAddBonus,
  onDeleteBonus,
  onSave,
}: MobileDayDetailProps) {
  const dt = dayTotal(day);
  const standardTotal = standardDayEarnings(day);
  const bonusTotal = bonusDayTotal(day);
  const isLogged = day.logged !== undefined ? day.logged : dt > 0;
  const [mileage, setMileage] = useState(day.mileage?.toString() || "");
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonusApp, setBonusApp] = useState(apps[0] ?? "Uber");
  const [bonusAmount, setBonusAmount] = useState("");
  const activeShift = hasActiveShift(day);
  const openShift = getActiveShift(day);
  const activeShiftPaused = openShift ? isShiftPaused(openShift) : false;
  const shiftHours = week ? getOperationalDayShiftHours(week, day.date) : 0;
  const rideCount = getDayRideCount(day);
  const standardApps = apps.filter((app) => !isRewardApp(app));

  return (
    <div className="animate-in slide-in-from-right duration-200 space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold">{day.dayName}</h2>
          <p className="text-sm text-muted-foreground font-mono">{day.date}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold font-mono text-primary">{formatCurrency(dt, currencySymbol)}</p>
        </div>
      </div>

      {/* Logged toggle */}
      <div className="flex items-center justify-between bg-card rounded-xl border border-border p-4">
        <span className="text-sm font-medium">Day Logged</span>
        <Checkbox
          checked={isLogged}
          onCheckedChange={(checked) => onLoggedToggle(dayIdx, !!checked)}
          disabled={dt > 0}
        />
      </div>

      {/* App inputs */}
      <div className="space-y-3">
        {standardApps.map((app) => (
          <div
            key={app}
            className="flex items-center justify-between bg-card rounded-xl border border-border p-4 gap-4"
          >
            <span className="text-sm font-medium truncate">{app}</span>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {currencySymbol}
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="pl-7 text-right font-mono text-base h-10"
                value={day.apps[app] || ""}
                placeholder="0.00"
                onChange={(e) => onUpdate(dayIdx, app, e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      {onAddBonus && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Bonus</p>
              <p className="text-xs text-muted-foreground">Counts toward totals, not hourly stats.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setBonusOpen((open) => !open)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {bonusTotal > 0 && (
            <div className="rounded-lg border border-border/70 bg-background/50 p-3 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Ride earnings</span>
                <span className="font-mono">{formatCurrency(standardTotal, currencySymbol)}</span>
              </div>
              {(day.bonuses ?? []).filter((bonus) => bonus.amount > 0).map((bonus) => (
                <div key={bonus.id} className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">Bonus ({bonus.app})</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{formatCurrency(bonus.amount, currencySymbol)}</span>
                    {onDeleteBonus && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDeleteBonus(dayIdx, bonus.id)}
                        aria-label="Delete bonus"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 font-semibold">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(dt, currencySymbol)}</span>
              </div>
            </div>
          )}

          {bonusOpen && (
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                value={bonusApp}
                onChange={(e) => setBonusApp(e.target.value)}
              >
                {apps.map((app) => (
                  <option key={app} value={app}>{app}</option>
                ))}
              </select>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="h-10 text-right font-mono text-sm"
                value={bonusAmount}
                placeholder="0.00"
                onChange={(e) => setBonusAmount(e.target.value)}
              />
              <Button
                type="button"
                className="col-span-2"
                variant="secondary"
                disabled={!bonusApp || (Number.parseFloat(bonusAmount) || 0) <= 0}
                onClick={() => {
                  const amount = Math.max(0, Number.parseFloat(bonusAmount) || 0);
                  if (amount <= 0) return;
                  onAddBonus(dayIdx, bonusApp, amount);
                  setBonusAmount("");
                  setBonusOpen(false);
                }}
              >
                Add Bonus
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Mileage */}
      {onMileageUpdate && (
        <div className="flex items-center justify-between bg-card rounded-xl border border-border p-4 gap-4">
          <span className="text-sm font-medium">Business Miles</span>
          <div className="relative w-28 shrink-0">
            <Input
              type="number"
              step="0.1"
              min="0"
              className="text-right font-mono text-base h-10"
              value={mileage}
              placeholder="0.0"
              onChange={(e) => {
                setMileage(e.target.value);
                onMileageUpdate(dayIdx, parseFloat(e.target.value) || 0);
              }}
            />
          </div>
        </div>
      )}

      {onNoteUpdate && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <StickyNote className="h-4 w-4 text-primary" /> Daily Note
              </p>
              <p className="text-xs text-muted-foreground">Context only. It never changes your stats.</p>
            </div>
            {day.notes?.trim() && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => onNoteUpdate(dayIdx, "")}
              >
                Clear
              </Button>
            )}
          </div>
          <Textarea
            value={day.notes ?? ""}
            maxLength={180}
            rows={3}
            placeholder="Sick day, stopped early, unusual weather..."
            className="resize-none"
            onChange={(event) => onNoteUpdate(dayIdx, event.target.value)}
          />
          <p className="text-right text-[10px] text-muted-foreground">{day.notes?.length ?? 0}/180</p>
        </div>
      )}

      {/* Shifts */}
      {onStartShift && onEndShift && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Shift Blocks</p>
              <p className="text-xs text-muted-foreground">
                {shiftHours.toFixed(1)}h logged today{rideCount > 0 ? ` · ${rideCount} rides` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {onAddHistoricalShift && (
                <Button size="sm" variant="outline" onClick={() => onAddHistoricalShift(dayIdx)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              )}
              <Button
                size="sm"
                variant={activeShift ? "secondary" : "default"}
                onClick={() => activeShift ? onPauseResumeShift?.(dayIdx) : onStartShift(dayIdx)}
              >
                {activeShift ? activeShiftPaused ? "Resume" : "Pause" : "Start"}
              </Button>
            </div>
          </div>
          {activeShift && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => onEndShift(dayIdx)}>
              End Shift
            </Button>
          )}
          {(day.shifts ?? []).map((shift) => (
            <div
              key={shift.id}
              className={cn(
                "rounded-lg border px-3 py-2 space-y-3",
                shift.endTime ? "bg-background/60 border-border" : "bg-success/5 border-success/25",
              )}
            >
              <div className="min-w-0">
                {!shift.endTime && (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-success">Active Shift</p>
                )}
                <p className="text-sm font-semibold truncate">
                  {new Date(shift.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {shift.endTime ? ` → ${new Date(shift.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : " → active"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {shift.endTime ? `${shiftDurationHours(shift).toFixed(1)}h` : "running"}
                  {shift.endTime && shiftBreakHours(shift) > 0 ? ` · ${shiftBreakHours(shift).toFixed(1)}h break` : ""}
                </p>
                {formatRideAttribution(shift) ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRideAttribution(shift)}</p>
                ) : null}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2">
                {onShiftTimeUpdate && (
                  <>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Start</span>
                      <Input
                        key={`${shift.id}-start-${shift.startTime}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="HH:mm"
                        className="h-10 min-w-0 w-full appearance-none rounded-lg text-center font-mono text-sm"
                        defaultValue={timeInputValue(shift.startTime)}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim();
                          if (!isValidTimeInput(value)) {
                            e.currentTarget.value = timeInputValue(shift.startTime);
                            return;
                          }
                          onShiftTimeUpdate(dayIdx, shift.id, "startTime", value);
                        }}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">End</span>
                      <Input
                        key={`${shift.id}-end-${shift.endTime ?? "active"}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="HH:mm"
                        className="h-10 min-w-0 w-full appearance-none rounded-lg text-center font-mono text-sm"
                        defaultValue={timeInputValue(shift.endTime)}
                        disabled={!shift.endTime}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim();
                          if (!isValidTimeInput(value)) {
                            e.currentTarget.value = timeInputValue(shift.endTime);
                            return;
                          }
                          onShiftTimeUpdate(dayIdx, shift.id, "endTime", value);
                        }}
                      />
                    </label>
                  </>
                )}
                {onShiftMilesUpdate && (
                  <label className="min-w-0 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Miles</span>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        className="h-10 min-w-0 flex-1 text-right font-mono text-sm"
                        value={getShiftMiles(day, shift) || ""}
                        placeholder="mi"
                        onChange={(e) => onShiftMilesUpdate(dayIdx, shift.id, e.target.value)}
                      />
                      {onDeleteShift && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-10 w-10 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => onDeleteShift(dayIdx, shift.id)}
                          aria-label="Delete shift block"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </label>
                )}
                {onShiftEarningsUpdate && (
                  <label className="min-w-0 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Earnings</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-10 min-w-0 w-full text-right font-mono text-sm"
                      value={shift.earnings || ""}
                      placeholder={currencySymbol}
                      onChange={(e) => onShiftEarningsUpdate(dayIdx, shift.id, e.target.value)}
                    />
                  </label>
                )}
                {onShiftRideCountUpdate && (
                  <label className="min-w-0 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total rides</span>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      className="h-10 min-w-0 w-full text-right font-mono text-sm"
                      value={shift.rideCount || ""}
                      placeholder="0"
                      onChange={(e) => onShiftRideCountUpdate(dayIdx, shift.id, e.target.value)}
                    />
                  </label>
                )}
                {onDeleteShift && !onShiftMilesUpdate && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 justify-self-end text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDeleteShift(dayIdx, shift.id)}
                    aria-label="Delete shift block"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save */}
      <Button onClick={onSave} className="w-full" size="lg">
        <Save className="h-4 w-4 mr-2" />
        Save
      </Button>
    </div>
  );
}
