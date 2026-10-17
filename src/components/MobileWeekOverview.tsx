import { dayTotal, weekTotal, formatCurrency, getLoggedDays, getActiveEnteredDays } from "@/lib/store";
import { getDayMiles, getOperationalDayShiftHours } from "@/lib/shiftIntelligence";
import type { WeekRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, StickyNote } from "lucide-react";

interface MobileWeekOverviewProps {
  week: WeekRecord;
  currencySymbol: string;
  onDayTap: (dayIdx: number) => void;
}

export default function MobileWeekOverview({
  week,
  currencySymbol,
  onDayTap,
}: MobileWeekOverviewProps) {
  const sym = currencySymbol;
  const wt = weekTotal(week);
  const loggedDays = getLoggedDays(week);
  const activeDays = getActiveEnteredDays(week);
  const goal = week.weeklyGoal;
  const pct = goal > 0 ? Math.min((wt / goal) * 100, 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total</p>
          <p className="text-lg font-bold font-mono text-primary">{formatCurrency(wt, sym)}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Logged</p>
          <p className="text-lg font-bold font-mono">{loggedDays.length}/7</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Active</p>
          <p className="text-lg font-bold font-mono">{activeDays.length}/7</p>
        </div>
      </div>

      {/* Goal progress */}
      {goal > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Goal: {formatCurrency(goal, sym)}</span>
            <span>{pct.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Day list */}
      <div className="space-y-1.5">
        {week.entries.map((day, idx) => {
          const dt = dayTotal(day);
          const isLogged = day.logged !== undefined ? day.logged : dt > 0;
          const isActive = dt > 0;
          const shiftHours = getOperationalDayShiftHours(week, day.date);
          const miles = getDayMiles(day);

          return (
            <button
              key={day.dayName}
              onClick={() => onDayTap(idx)}
              className={cn(
                "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-colors text-left",
                isLogged
                  ? "bg-card border-border"
                  : "bg-card/50 border-border/50",
                "active:scale-[0.98] active:bg-accent/50"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{day.dayName}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{day.date}</span>
                  {day.notes?.trim() && (
                    <StickyNote className="h-3.5 w-3.5 text-primary" aria-label="Daily note" />
                  )}
                </div>
                {(shiftHours > 0 || miles > 0) && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {shiftHours > 0 ? `${shiftHours.toFixed(1)}h` : "No hours"} · {miles.toFixed(1)} mi
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isLogged && (
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                    isActive
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {isActive ? "Active" : "Logged"}
                  </span>
                )}
                <span className={cn(
                  "text-sm font-bold font-mono min-w-[60px] text-right",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}>
                  {formatCurrency(dt, sym)}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
