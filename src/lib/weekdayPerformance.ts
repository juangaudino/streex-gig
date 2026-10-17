import { buildAttributedHourAmounts, resolveDayPerformanceEarnings, type AttributedHourAmount } from "./earningsAttributions";
import { getOperationalDayShiftHours } from "./shiftIntelligence";
import { dayTotal } from "./store";
import type { DayEntry, EarningsAttribution, EarningsSnapshot, WeekRecord } from "./types";

const round = (value: number): number => Number(value.toFixed(2));

export interface WeekdayEfficiencyBenchmark {
  earningsPerHour: number | null;
  representedEarnings: number;
  representedHours: number;
  dayCount: number;
  earningDayCount: number;
}

export interface DayPerformanceComparison {
  currentEarningsPerHour: number | null;
  historicalEarningsPerHour: number | null;
  difference: number | null;
  percentDifference: number | null;
  representedHistoricalDays: number;
  historicalEarningDays: number;
  currentPerformanceEarnings: number;
  currentHours: number;
  excludedFromEfficiency: number;
  signal: "strong-output-efficient" | "short-efficient" | "high-output-longer" | "below-typical" | "building";
}

function completedDayHours(week: WeekRecord, day: DayEntry): number {
  return getOperationalDayShiftHours(week, day.date);
}

export function getWeekdayEfficiencyBenchmark(args: {
  weeks: WeekRecord[];
  dayName: string;
  excludeDate?: string;
  snapshots?: EarningsSnapshot[];
  attributions?: EarningsAttribution[];
  attributedSegments?: AttributedHourAmount[];
}): WeekdayEfficiencyBenchmark {
  let representedEarnings = 0;
  let representedHours = 0;
  let dayCount = 0;
  let earningDayCount = 0;
  for (const week of args.weeks) {
    for (const day of week.entries) {
      if (day.dayName !== args.dayName || (args.excludeDate && day.date === args.excludeDate)) continue;
      if (dayTotal(day) > 0) earningDayCount += 1;
      const hours = completedDayHours(week, day);
      if (hours <= 0) continue;
      const performance = resolveDayPerformanceEarnings({
        day,
        weeks: args.weeks,
        snapshots: args.snapshots,
        attributions: args.attributions,
        attributedSegments: args.attributedSegments,
      });
      representedEarnings += performance.earnings;
      representedHours += hours;
      dayCount += 1;
    }
  }
  return {
    earningsPerHour: representedHours > 0 ? round(representedEarnings / representedHours) : null,
    representedEarnings: round(representedEarnings),
    representedHours: round(representedHours),
    dayCount,
    earningDayCount,
  };
}

export function buildDayPerformanceComparison(args: {
  day: DayEntry;
  weeks: WeekRecord[];
  snapshots?: EarningsSnapshot[];
  attributions?: EarningsAttribution[];
  historicalAverageTotal: number;
  now?: Date;
}): DayPerformanceComparison {
  const snapshots = args.snapshots ?? [];
  const attributions = args.attributions ?? [];
  const attributedSegments = buildAttributedHourAmounts({ weeks: args.weeks, snapshots, attributions });
  const benchmark = getWeekdayEfficiencyBenchmark({
    weeks: args.weeks,
    dayName: args.day.dayName,
    excludeDate: args.day.date,
    snapshots,
    attributions,
    attributedSegments,
  });
  const performance = resolveDayPerformanceEarnings({
    day: args.day,
    weeks: args.weeks,
    snapshots,
    attributions,
    attributedSegments,
  });
  const currentWeek = args.weeks.find((week) => week.entries.some((day) => day.date === args.day.date));
  const currentHours = currentWeek ? getOperationalDayShiftHours(currentWeek, args.day.date, args.now) : 0;
  const currentEarningsPerHour = currentHours > 0 ? round(performance.earnings / currentHours) : null;
  const historicalEarningsPerHour = benchmark.earningsPerHour;
  const difference = currentEarningsPerHour !== null && historicalEarningsPerHour !== null
    ? round(currentEarningsPerHour - historicalEarningsPerHour)
    : null;
  const percentDifference = difference !== null && historicalEarningsPerHour && historicalEarningsPerHour > 0
    ? round((difference / historicalEarningsPerHour) * 100)
    : null;
  const outputAbove = args.historicalAverageTotal > 0 && dayTotal(args.day) >= args.historicalAverageTotal;
  const efficiencyAbove = difference !== null && difference >= 0;
  const signal = difference === null || args.historicalAverageTotal <= 0
    ? "building"
    : outputAbove && efficiencyAbove
      ? "strong-output-efficient"
      : !outputAbove && efficiencyAbove
        ? "short-efficient"
        : outputAbove
          ? "high-output-longer"
          : "below-typical";
  return {
    currentEarningsPerHour,
    historicalEarningsPerHour,
    difference,
    percentDifference,
    representedHistoricalDays: benchmark.dayCount,
    historicalEarningDays: benchmark.earningDayCount,
    currentPerformanceEarnings: performance.earnings,
    currentHours,
    excludedFromEfficiency: performance.excludedFromEfficiency,
    signal,
  };
}

export function dayPerformanceSignalLabel(signal: DayPerformanceComparison["signal"]): string {
  if (signal === "strong-output-efficient") return "Strong output and efficiency";
  if (signal === "short-efficient") return "Short day, strong efficiency";
  if (signal === "high-output-longer") return "High output, longer day";
  if (signal === "below-typical") return "Below typical pace";
  return "Building your efficiency benchmark";
}
