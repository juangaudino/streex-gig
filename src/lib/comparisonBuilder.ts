import { appBonusTotal, operationalDayTotal } from "./rewardIncome";
import { dayTotal, formatCurrency } from "./store";
import { buildPatternIntelligence, getDayMiles, getDayRideCount, getDayShiftHours, getOperationalDayShiftHours, shiftDurationHours } from "./shiftIntelligence";
import type { DayEntry, WeekRecord } from "./types";

export type ComparisonBlockType = "day" | "week" | "month" | "year" | "custom";

export interface ComparisonBlock {
  id: string;
  type: ComparisonBlockType;
  label?: string;
  startDate: string;
  endDate: string;
}

export interface ComparisonDayMetric {
  date: string;
  dayName: string;
  earnings: number;
}

export interface ComparisonMetrics {
  earnings: number;
  operationalEarnings: number | null;
  hours: number | null;
  earningsPerHour: number | null;
  miles: number | null;
  earningsPerMile: number | null;
  rides: number | null;
  earningsPerRide: number | null;
  activeDays: number;
  calendarDays: number;
  averagePerActiveDay: number | null;
  averagePerCalendarDay: number | null;
  bestDay: ComparisonDayMetric | null;
  lowestActiveDay: ComparisonDayMetric | null;
  earningsGoalProgress: number | null;
  hoursGoalProgress: number | null;
  /** Operational snapshot structure. These remain unavailable for app-only comparisons. */
  totalShifts: number | null;
  completedShifts: number | null;
  activeShifts: number | null;
  multiShiftDays: number | null;
  averageShiftHours: number | null;
  milesPerHour: number | null;
  /** Exact Dashboard Operations Snapshot semantics, based only on work blocks. */
  operationalHours: number | null;
  operationalMiles: number | null;
  operationalRides: number | null;
  operationalWorkDays: number | null;
  operationalEarningsPerHour: number | null;
  operationalEarningsPerMile: number | null;
  operationalEarningsPerRide: number | null;
  operationalMilesPerHour: number | null;
}

export interface ComparisonResult {
  block: ComparisonBlock;
  displayLabel: string;
  rangeLabel: string;
  appFilter: string;
  metrics: ComparisonMetrics;
}

export interface ComparisonData {
  results: ComparisonResult[];
  appOptions: string[];
  insights: string[];
  appFilterActive: boolean;
}

export type OperationsRankingScope = "day" | "week" | "month";
export type OperationsRankingMetric = "earningsPerHour" | "earningsPerMile" | "earningsPerRide" | "averagePerActiveDay" | "milesPerHour" | "earnings";

export interface OperationsLeaderboardEntry {
  result: ComparisonResult;
  rank: number;
  value: number;
}

function operationsRankingValue(metrics: ComparisonMetrics, metric: OperationsRankingMetric): number | null {
  if (metric === "earningsPerHour") return metrics.operationalEarningsPerHour;
  if (metric === "earningsPerMile") return metrics.operationalEarningsPerMile;
  if (metric === "earningsPerRide") return metrics.operationalEarningsPerRide;
  if (metric === "milesPerHour") return metrics.operationalMilesPerHour;
  return metrics[metric];
}

const DAY_MS = 86_400_000;

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatComparisonDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return formatComparisonDate(date);
}

function startOfMondayWeek(date: Date): Date {
  const copy = new Date(date);
  const weekday = copy.getDay();
  copy.setDate(copy.getDate() - (weekday === 0 ? 6 : weekday - 1));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function comparisonRangeForType(type: ComparisonBlockType, anchorDate: string): { startDate: string; endDate: string } {
  const anchor = parseDate(anchorDate);
  if (type === "day" || type === "custom") return { startDate: anchorDate, endDate: anchorDate };
  if (type === "week") {
    const start = startOfMondayWeek(anchor);
    return { startDate: formatComparisonDate(start), endDate: formatComparisonDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)) };
  }
  if (type === "month") {
    return {
      startDate: formatComparisonDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      endDate: formatComparisonDate(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    };
  }
  return {
    startDate: `${anchor.getFullYear()}-01-01`,
    endDate: `${anchor.getFullYear()}-12-31`,
  };
}

function inclusiveDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.floor((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / DAY_MS) + 1;
}

function defaultBlockLabel(block: ComparisonBlock): string {
  if (block.label?.trim()) return block.label.trim();
  const start = parseDate(block.startDate);
  if (block.type === "day") return start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (block.type === "month") return start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (block.type === "year") return String(start.getFullYear());
  if (block.type === "week") return `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return "Custom period";
}

function rangeLabel(block: ComparisonBlock): string {
  return block.startDate === block.endDate ? block.startDate : `${block.startDate} → ${block.endDate}`;
}

function allAppNames(weeks: WeekRecord[]): string[] {
  return Array.from(new Set(weeks.flatMap((week) => week.entries.flatMap((day) => [
    ...Object.keys(day.apps ?? {}),
    ...(day.bonuses ?? []).map((bonus) => bonus.app),
  ])))).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function normalizedDayIndex(weeks: WeekRecord[]): Map<string, DayEntry> {
  const index = new Map<string, DayEntry>();
  const orderedWeeks = [...weeks].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const week of orderedWeeks) {
    for (const day of week.entries) index.set(day.date, day);
  }
  return index;
}

function appEarnings(day: DayEntry, app: string): number {
  return money(day.apps?.[app]) + appBonusTotal(day, app);
}

function matchingTrackedWeek(weeks: WeekRecord[], block: ComparisonBlock): WeekRecord | null {
  if (block.type !== "week") return null;
  return weeks.find((week) => (
    week.startDate === block.startDate
    && block.endDate >= week.startDate
    && block.endDate <= week.endDate
  )) ?? null;
}

export function buildComparisonResult(args: {
  block: ComparisonBlock;
  weeks: WeekRecord[];
  appFilter?: string;
  includeOperations?: boolean;
}): ComparisonResult {
  const { block, weeks } = args;
  const selectedApp = args.appFilter && args.appFilter !== "all" ? args.appFilter : null;
  const dayIndex = normalizedDayIndex(weeks);
  const days = [...dayIndex.values()]
    .filter((day) => day.date >= block.startDate && day.date <= block.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const dayRows = days.map((day) => {
    const earnings = selectedApp ? appEarnings(day, selectedApp) : dayTotal(day);
    const sourceWeek = weeks.find((week) => week.entries.some((entry) => entry.date === day.date));
    const hours = selectedApp ? null : sourceWeek ? getOperationalDayShiftHours(sourceWeek, day.date) : getDayShiftHours(day);
    const miles = selectedApp ? null : getDayMiles(day);
    const rides = selectedApp ? null : getDayRideCount(day);
    const operationalEarnings = selectedApp ? null : operationalDayTotal(day);
    const active = selectedApp
      ? earnings > 0
      : earnings > 0 || (hours ?? 0) > 0 || (rides ?? 0) > 0;
    return { day, earnings, hours, miles, rides, operationalEarnings, active };
  });

  const activeRows = dayRows.filter((row) => row.active);
  const earnings = money(dayRows.reduce((sum, row) => sum + row.earnings, 0));
  const operationalEarnings = selectedApp ? null : money(dayRows.reduce((sum, row) => sum + (row.operationalEarnings ?? 0), 0));
  const hours = selectedApp ? null : money(dayRows.reduce((sum, row) => sum + (row.hours ?? 0), 0));
  const miles = selectedApp ? null : money(dayRows.reduce((sum, row) => sum + (row.miles ?? 0), 0));
  const rides = selectedApp ? null : dayRows.reduce((sum, row) => sum + (row.rides ?? 0), 0);
  const calendarDays = inclusiveDays(block.startDate, block.endDate);
  const trackedWeek = selectedApp ? null : matchingTrackedWeek(weeks, block);
  const shifts = selectedApp ? [] : days.flatMap((day) => day.shifts ?? []);
  const completedShifts = selectedApp ? null : shifts.filter((shift) => Boolean(shift.endTime));
  const completedShiftHours = completedShifts === null
    ? null
    : completedShifts.reduce((sum, shift) => sum + shiftDurationHours(shift), 0);
  const totalShifts = selectedApp ? null : shifts.length;
  const activeShifts = selectedApp ? null : shifts.filter((shift) => !shift.endTime).length;
  const multiShiftDays = selectedApp ? null : days.filter((day) => (day.shifts?.length ?? 0) > 1).length;
  const operationSummary = selectedApp || args.includeOperations === false ? null : buildPatternIntelligence([{
    id: `comparison-${block.id}`,
    startDate: block.startDate,
    endDate: block.endDate,
    weeklyGoal: 0,
    status: "closed",
    entries: days,
    createdAt: `${block.startDate}T00:00:00.000Z`,
    updatedAt: `${block.endDate}T23:59:59.999Z`,
  }]).summary;
  const bestRow = activeRows.length ? [...activeRows].sort((a, b) => b.earnings - a.earnings || a.day.date.localeCompare(b.day.date))[0] : null;
  const lowRow = activeRows.length ? [...activeRows].sort((a, b) => a.earnings - b.earnings || a.day.date.localeCompare(b.day.date))[0] : null;

  const toDayMetric = (row: typeof bestRow): ComparisonDayMetric | null => row ? {
    date: row.day.date,
    dayName: row.day.dayName,
    earnings: money(row.earnings),
  } : null;

  return {
    block,
    displayLabel: defaultBlockLabel(block),
    rangeLabel: rangeLabel(block),
    appFilter: selectedApp ?? "all",
    metrics: {
      earnings,
      operationalEarnings,
      hours,
      earningsPerHour: operationalEarnings !== null && hours !== null && hours > 0 ? money(operationalEarnings / hours) : null,
      miles,
      earningsPerMile: operationalEarnings !== null && miles !== null && miles > 0 ? money(operationalEarnings / miles) : null,
      rides,
      earningsPerRide: operationalEarnings !== null && rides !== null && rides > 0 ? money(operationalEarnings / rides) : null,
      activeDays: activeRows.length,
      calendarDays,
      averagePerActiveDay: activeRows.length > 0 ? money(earnings / activeRows.length) : null,
      averagePerCalendarDay: calendarDays > 0 ? money(earnings / calendarDays) : null,
      bestDay: toDayMetric(bestRow),
      lowestActiveDay: toDayMetric(lowRow),
      earningsGoalProgress: trackedWeek && trackedWeek.weeklyGoal > 0 ? money((earnings / trackedWeek.weeklyGoal) * 100) : null,
      hoursGoalProgress: trackedWeek && (trackedWeek.weeklyHoursGoal ?? 0) > 0 && hours !== null ? money((hours / (trackedWeek.weeklyHoursGoal ?? 0)) * 100) : null,
      totalShifts,
      completedShifts: completedShifts?.length ?? null,
      activeShifts,
      multiShiftDays,
      averageShiftHours: completedShifts !== null && completedShifts.length > 0 && completedShiftHours !== null
        ? money(completedShiftHours / completedShifts.length)
        : null,
      milesPerHour: miles !== null && hours !== null && hours > 0 ? money(miles / hours) : null,
      operationalHours: operationSummary?.totalHours ?? null,
      operationalMiles: operationSummary?.totalMiles ?? null,
      operationalRides: operationSummary?.totalRides ?? null,
      operationalWorkDays: operationSummary?.workDays ?? null,
      operationalEarningsPerHour: operationSummary?.earningsPerHour ?? null,
      operationalEarningsPerMile: operationSummary?.earningsPerMile ?? null,
      operationalEarningsPerRide: operationSummary?.earningsPerRide ?? null,
      operationalMilesPerHour: operationSummary?.milesPerHour ?? null,
    },
  };
}

function strongest<T>(results: ComparisonResult[], read: (result: ComparisonResult) => number | null): ComparisonResult | null {
  let best: ComparisonResult | null = null;
  let bestValue = -Infinity;
  for (const result of results) {
    const value = read(result);
    if (value === null || !Number.isFinite(value) || value <= bestValue) continue;
    best = result;
    bestValue = value;
  }
  return best;
}

function buildComparisonInsights(results: ComparisonResult[], currencySymbol: string, appFilterActive: boolean): string[] {
  if (results.length < 2) return [];
  const insights: string[] = [];
  const earningsLeader = strongest(results, (result) => result.metrics.earnings);
  const efficiencyLeader = strongest(results, (result) => result.metrics.earningsPerHour);
  const activeDayLeader = strongest(results, (result) => result.metrics.activeDays);

  if (earningsLeader) {
    insights.push(`${earningsLeader.displayLabel} earned the most at ${formatCurrency(earningsLeader.metrics.earnings, currencySymbol)}.`);
  }
  if (!appFilterActive && efficiencyLeader) {
    const distinctLeader = efficiencyLeader.block.id !== earningsLeader?.block.id;
    insights.push(`${efficiencyLeader.displayLabel} had the strongest measured hourly efficiency at ${formatCurrency(efficiencyLeader.metrics.earningsPerHour ?? 0, currencySymbol)}/hr${distinctLeader ? ", even though it did not earn the most overall" : ""}.`);
  }
  if (activeDayLeader && activeDayLeader.metrics.activeDays > 0) {
    insights.push(`${activeDayLeader.displayLabel} contains the most active days in this comparison (${activeDayLeader.metrics.activeDays}).`);
  }
  if (appFilterActive) {
    insights.push("App-filtered comparisons show earnings patterns only; hours, miles, rides, and efficiency stay hidden because Streex cannot attribute them to one app reliably.");
  }
  return insights.slice(0, 4);
}

export function buildComparisonData(args: {
  blocks: ComparisonBlock[];
  weeks: WeekRecord[];
  appFilter?: string;
  currencySymbol?: string;
  includeOperations?: boolean;
}): ComparisonData {
  const appFilter = args.appFilter ?? "all";
  const results = args.blocks.slice(0, 4).map((block) => buildComparisonResult({ block, weeks: args.weeks, appFilter, includeOperations: args.includeOperations }));
  return {
    results,
    appOptions: allAppNames(args.weeks),
    appFilterActive: appFilter !== "all",
    insights: buildComparisonInsights(results, args.currencySymbol ?? "$", appFilter !== "all"),
  };
}

function operationRankingBlocks(weeks: WeekRecord[], scope: OperationsRankingScope, now: Date): ComparisonBlock[] {
  const today = formatComparisonDate(now);
  if (scope === "week") {
    return weeks
      .filter((week) => week.status === "closed" && week.endDate < today)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((week) => ({ id: `operation-week-${week.id}`, type: "week" as const, startDate: week.startDate, endDate: week.endDate }));
  }

  const days = [...normalizedDayIndex(weeks).values()];
  if (scope === "day") {
    return days
      .filter((day) => day.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({ id: `operation-day-${day.date}`, type: "day" as const, startDate: day.date, endDate: day.date }));
  }

  const months = new Set(days.map((day) => day.date.slice(0, 7)).filter((month) => month < today.slice(0, 7)));
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const range = comparisonRangeForType("month", `${month}-01`);
      return { id: `operation-month-${month}`, type: "month" as const, ...range };
    });
}

/**
 * A ranked historical view of the same operational metrics shown in the
 * Dashboard snapshot. Only completed historical periods participate so a
 * building day/week/month is never presented as an apples-to-apples rank.
 */
export function buildOperationsLeaderboard(args: {
  weeks: WeekRecord[];
  scope: OperationsRankingScope;
  metric: OperationsRankingMetric;
  now?: Date;
  limit?: number;
}): OperationsLeaderboardEntry[] {
  const blocks = operationRankingBlocks(args.weeks, args.scope, args.now ?? new Date());
  const entries = blocks
    .map((block) => buildComparisonResult({ block, weeks: args.weeks }))
    .map((result) => ({ result, value: operationsRankingValue(result.metrics, args.metric) }))
    .filter((entry): entry is { result: ComparisonResult; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value || a.result.block.startDate.localeCompare(b.result.block.startDate));

  return entries.slice(0, args.limit ?? 5).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildDefaultComparisonBlocks(weeks: WeekRecord[], now = new Date()): ComparisonBlock[] {
  const today = formatComparisonDate(now);
  const current = weeks.find((week) => week.status === "open") ?? [...weeks].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!current) return [];
  const currentEnd = today < current.startDate ? current.startDate : today > current.endDate ? current.endDate : today;
  const elapsedDays = Math.max(1, inclusiveDays(current.startDate, currentEnd));
  const previous = [...weeks]
    .filter((week) => week.id !== current.id && week.startDate < current.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

  const blocks: ComparisonBlock[] = [{
    id: "current-week",
    type: "custom",
    label: "Current week",
    startDate: current.startDate,
    endDate: currentEnd,
  }];
  if (previous) {
    blocks.push({
      id: "previous-same-point",
      type: "custom",
      label: "Previous week · same point",
      startDate: previous.startDate,
      endDate: addDays(previous.startDate, Math.min(elapsedDays - 1, inclusiveDays(previous.startDate, previous.endDate) - 1)),
    });
  }
  return blocks;
}
