// Ask My Data — OpenAI Beta
// Scope-aware edge function: verifies JWT, reads through caller-scoped RLS,
// builds compact analytics context (including weekend/consecutive-window and
// app-vs-app head-to-head facts), and streams OpenAI responses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  appBonusTotal,
  dayShiftStats,
  dayTotal,
  operationalDayTotal,
  parseEntries,
} from "../_shared/dailyOps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const AI_MODELS = {
  luna: {
    id: "gpt-5.6-luna",
    reasoningEffort: "low",
    inputUsdPer1M: 0.2,
    outputUsdPer1M: 1.2,
  },
  terra: {
    id: "gpt-5.6-terra",
    reasoningEffort: "medium",
    inputUsdPer1M: 2,
    outputUsdPer1M: 12,
  },
} as const;
type AiModelId = (typeof AI_MODELS)[keyof typeof AI_MODELS]["id"];
type ReasoningEffort = (typeof AI_MODELS)[keyof typeof AI_MODELS]["reasoningEffort"];
type ModelRoute = "luna_default" | "terra_complex";
type ModelPlan = {
  model: AiModelId;
  reasoningEffort: ReasoningEffort;
  route: ModelRoute;
};

// Metadata-only debug logging. Toggle via env AMD_DEBUG=1. NEVER logs prompts,
// messages, AI responses, weeks, earnings, emails, tokens, or user IDs.
const AMD_DEBUG = Deno.env.get("AMD_DEBUG") === "1";
export function amdDebug(event: string, data: Record<string, unknown> = {}) {
  if (!AMD_DEBUG) return;
  try {
    console.info(`[amd] ${event}`, JSON.stringify(data));
  } catch {
    // ignore serialization errors
  }
}

type DataScope = "RECENT" | "ALL_TIME" | "SEASONAL";
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type AskIntent =
  | "DAY"
  | "WEEK"
  | "MONTH"
  | "STREAK"
  | "HOUR"
  | "PACE"
  | "GOAL"
  | "RANKING"
  | "RIVAL"
  | "INSIGHT"
  | "PATTERN"
  | "COACHING"
  | "UNSUPPORTED"
  | "GENERAL";
type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
type SupabaseClient = ReturnType<typeof createClient>;

interface DayEntry {
  dayName: string;
  date: string;
  apps: Record<string, number>;
  bonuses?: {
    id?: string;
    app: string;
    amount: number;
    source?: string;
  }[];
  shifts?: {
    id: string;
    startTime: string;
    endTime?: string;
    miles?: number;
    rideCount?: number;
  }[];
  mileage?: number;
}

interface WeekRow {
  id: string;
  start_date: string;
  end_date: string;
  weekly_goal: number;
  status: "open" | "closed";
  entries: DayEntry[] | string;
}

// These types deliberately exclude raw coordinates, routes, addresses, and
// browser accuracy. Ask My Data receives only stored coarse zone keys, then
// immediately replaces them with owner-confirmed labels before model context.
interface MobilityRideRow {
  id: string;
  day_date: string;
  app: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  pickup_at: string | null;
  lifecycle_version: number;
  start_zone_key: string | null;
  pickup_zone_key: string | null;
  start_capture_status: string;
  pickup_capture_status: string;
  source: string;
  time_zone: string | null;
}

interface SnapshotRow {
  id: string;
  week_id: string;
  day_date: string;
  app: string;
  delta: number;
  created_at: string;
}

interface RideAllocationRow {
  ride_event_id: string | null;
  earnings_snapshot_id?: string;
  kind: string;
  amount: number;
  is_current: boolean;
}

interface RideBatchRow {
  id: string;
  earnings_snapshot_id: string;
  kind: string;
}

interface RideBatchEventRow {
  batch_id: string;
  ride_event_id: string;
}

interface RidePaymentRow {
  ride_event_id: string;
  earnings_snapshot_id: string;
}

interface ZoneLabelRow {
  zone_key: string;
  label: string;
}

interface NormalizedWeek {
  id: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
  goal: number;
  total: number;
  daysWorked: number;
  shiftStats: ShiftStats;
  appTotals: Record<string, number>;
  dayTotals: { day: string; date: string; total: number; operationalTotal: number; hours: number; rides: number; miles: number; completedShifts: number; activeShifts: number }[];
}

interface ShiftStats {
  totalHours: number;
  completedShifts: number;
  activeShifts: number;
  totalRides: number;
  totalMiles: number;
  operationalEarnings: number;
  earningsPerHour: number | null;
  earningsPerRide: number | null;
  ridesPerHour: number | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function round(value: number): number {
  return +value.toFixed(2);
}

function roundCost(value: number): number {
  return +value.toFixed(8);
}

function normalizeWeek(w: WeekRow): NormalizedWeek {
  const entries = parseEntries(w.entries);
  const dayTotals = entries.map((d) => ({
    day: d.dayName,
    date: d.date,
    total: round(dayTotal(d)),
    operationalTotal: round(operationalDayTotal(d)),
    ...dayShiftStats(d),
  }));
  const shiftStatsBase = dayTotals.reduce((acc, day) => ({
    totalHours: acc.totalHours + day.hours,
    completedShifts: acc.completedShifts + day.completedShifts,
    activeShifts: acc.activeShifts + day.activeShifts,
    totalRides: acc.totalRides + day.rides,
    totalMiles: acc.totalMiles + day.miles,
  }), { totalHours: 0, completedShifts: 0, activeShifts: 0, totalRides: 0, totalMiles: 0 });
  const appTotals: Record<string, number> = {};
  for (const d of entries) {
    for (const [app, v] of Object.entries(d.apps || {})) {
      appTotals[app] = (appTotals[app] || 0) + (Number(v) || 0) + appBonusTotal(d, app);
    }
    for (const bonus of d.bonuses ?? []) {
      if (Object.prototype.hasOwnProperty.call(d.apps ?? {}, bonus.app)) continue;
      appTotals[bonus.app] = (appTotals[bonus.app] || 0) + (Number(bonus.amount) || 0);
    }
  }
  const total = dayTotals.reduce((sum, d) => sum + d.total, 0);
  const operationalTotal = dayTotals.reduce((sum, d) => sum + d.operationalTotal, 0);
  return {
    id: w.id,
    startDate: w.start_date,
    endDate: w.end_date,
    status: w.status,
    goal: Number(w.weekly_goal),
    total: round(total),
    daysWorked: dayTotals.filter((d) => d.total > 0).length,
    shiftStats: {
      ...shiftStatsBase,
      totalHours: round(shiftStatsBase.totalHours),
      totalMiles: round(shiftStatsBase.totalMiles),
      operationalEarnings: round(operationalTotal),
      earningsPerHour: shiftStatsBase.totalHours > 0 ? round(operationalTotal / shiftStatsBase.totalHours) : null,
      earningsPerRide: shiftStatsBase.totalRides > 0 ? round(operationalTotal / shiftStatsBase.totalRides) : null,
      ridesPerHour: shiftStatsBase.totalHours > 0 && shiftStatsBase.totalRides > 0 ? round(shiftStatsBase.totalRides / shiftStatsBase.totalHours) : null,
    },
    appTotals: Object.fromEntries(
      Object.entries(appTotals).map(([k, v]) => [k, round(v)]),
    ),
    dayTotals,
  };
}

export function detectScope(messages: ChatMessage[], knownApps: string[] = []): { scope: DataScope; reason: string } {
  const latest = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const q = latest.toLowerCase();
  const intent = detectIntent(latest, knownApps);

  const seasonalTerms = [
    "season", "seasonal", "summer", "winter", "spring", "fall", "autumn",
    "holiday", "holidays", "month to month", "monthly", "quarter", "quarterly",
    "older", "long range", "long-range", "compare months", "compare periods",
  ];
  const allTimeTerms = [
    "all time", "all-time", "ever", "career", "lifetime", "record", "best week",
    "highest", "lowest", "evolved", "evolution", "history", "historical",
    "overall", "my average", "average weekly", "average week", "top", "worst",
    "bottom", "rank", "ranking", "all my",
  ];
  const recentTerms = [
    "recent", "recently", "lately", "current", "this week", "this month",
    "last few", "now",
  ];
  const explicitRecentTimeframe = recentTerms.some((term) => q.includes(term)) ||
    /\b(last|past)\s+\d+\s+(day|days|week|weeks|month|months|year|years)\b/.test(q) ||
    /\b(last|past)\s+(week|month|year|quarter)\b/.test(q) ||
    /\bytd\b|\byear to date\b/.test(q) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(q);

  if (intent === "MONTH" || seasonalTerms.some((term) => q.includes(term))) {
    return { scope: "SEASONAL", reason: "Question asks for long-range or time-period comparison." };
  }
  if (asksForFourWeekComparison(latest)) {
    return { scope: "ALL_TIME", reason: "Best four-week-period comparison requires full history." };
  }
  if (explicitRecentTimeframe) {
    return { scope: "RECENT", reason: "Question explicitly asks for a recent or bounded timeframe." };
  }
  if (intent === "STREAK" || intent === "RANKING" || intent === "INSIGHT" || intent === "PATTERN" || intent === "COACHING" ||
    allTimeTerms.some((term) => q.includes(term))) {
    return { scope: "ALL_TIME", reason: "Question asks for record, lifetime, or historical analytics." };
  }
  // App-vs-app, weekday combos, and consecutive-day windows all require full history
  // to answer truthfully. Force ALL_TIME so we don't hallucinate over a 16-week slice.
  if (isAppVsAppQuestion(latest, knownApps)) {
    return { scope: "ALL_TIME", reason: "App-vs-app comparison requires full history to be accurate." };
  }
  if (isComboOrWindowQuestion(latest)) {
    return { scope: "ALL_TIME", reason: "Grouped/consecutive-day analysis requires full history." };
  }
  return { scope: "ALL_TIME", reason: "No timeframe was specified, so defaulting to full career history." };
}

function sumAppTotals(weeks: NormalizedWeek[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const w of weeks) {
    for (const [app, amount] of Object.entries(w.appTotals)) {
      totals[app] = (totals[app] || 0) + amount;
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)]));
}

function weekdayStats(weeks: NormalizedWeek[]) {
  const byDay: Record<string, { sum: number; count: number; best: number; bestDate: string | null }> = {};
  for (const w of weeks) {
    for (const d of w.dayTotals) {
      if (d.total <= 0) continue;
      byDay[d.day] = byDay[d.day] || { sum: 0, count: 0, best: 0, bestDate: null };
      byDay[d.day].sum += d.total;
      byDay[d.day].count += 1;
      if (d.total > byDay[d.day].best) {
        byDay[d.day].best = d.total;
        byDay[d.day].bestDate = d.date;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(byDay).map(([day, v]) => [
      day,
      { average: round(v.sum / v.count), count: v.count, best: round(v.best), bestDate: v.bestDate },
    ]),
  );
}

function streakStats(weeks: NormalizedWeek[]) {
  const days = weeks
    .flatMap((w) => w.dayTotals.map((d) => ({ ...d, worked: d.total > 0 })))
    .sort((a, b) => a.date.localeCompare(b.date));
  let current = 0;
  let longest = 0;
  for (const d of days) {
    if (d.worked) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return { currentActiveDayStreak: current, longestActiveDayStreak: longest };
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function quarterKey(date: string): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  return `${year}-Q${Math.ceil(month / 3)}`;
}

function seasonKey(date: string): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  const season = month === 12 || month <= 2
    ? "Winter"
    : month <= 5
    ? "Spring"
    : month <= 8
    ? "Summer"
    : "Fall";
  return `${year} ${season}`;
}

function rollupByPeriod(weeks: NormalizedWeek[], keyOf: (date: string) => string) {
  const map = new Map<string, { total: number; weeks: number; activeDays: number }>();
  for (const w of weeks) {
    const key = keyOf(w.startDate);
    const cur = map.get(key) || { total: 0, weeks: 0, activeDays: 0 };
    cur.total += w.total;
    cur.weeks += 1;
    cur.activeDays += w.daysWorked;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([period, v]) => ({
      period,
      total: round(v.total),
      weeks: v.weeks,
      averageWeek: round(v.total / v.weeks),
      activeDays: v.activeDays,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function rollupDaysByMonth(weeks: NormalizedWeek[]) {
  const map = new Map<string, { total: number; daysTracked: number; activeDays: number }>();
  for (const w of weeks) {
    for (const day of w.dayTotals) {
      const key = monthKey(day.date);
      const cur = map.get(key) || { total: 0, daysTracked: 0, activeDays: 0 };
      cur.total += day.total;
      cur.daysTracked += 1;
      if (day.total > 0) cur.activeDays += 1;
      map.set(key, cur);
    }
  }
  return [...map.entries()]
    .map(([period, v]) => ({
      period,
      total: round(v.total),
      daysTracked: v.daysTracked,
      activeDays: v.activeDays,
      averageActiveDay: v.activeDays ? round(v.total / v.activeDays) : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function trendBuckets(weeks: NormalizedWeek[]) {
  const closed = weeks.filter((w) => w.status === "closed").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const size = Math.max(1, Math.ceil(closed.length / 4));
  const buckets = [];
  for (let i = 0; i < closed.length; i += size) {
    const group = closed.slice(i, i + size);
    const total = group.reduce((sum, w) => sum + w.total, 0);
    buckets.push({
      from: group[0]?.startDate,
      to: group[group.length - 1]?.endDate,
      weeks: group.length,
      averageWeek: round(total / group.length),
    });
  }
  return buckets;
}

type FourWeekComparable = Pick<NormalizedWeek, "startDate" | "endDate" | "status" | "total">;

function isNextCalendarWeek(previousStart: string, nextStart: string): boolean {
  const previous = Date.parse(`${previousStart}T00:00:00Z`);
  const next = Date.parse(`${nextStart}T00:00:00Z`);
  return Number.isFinite(previous) && Number.isFinite(next) && next - previous === 7 * 24 * 60 * 60 * 1000;
}

function asksForFourWeekComparison(prompt: string): boolean {
  const q = prompt.toLowerCase();
  const refersToFourWeeks = /\b(last|recent|past|best)\s+(four|4)\s*-?\s*weeks?\b|\b(four|4)\s*-?\s*week\s+(period|comparison)\b|\b(últimas?|ultimas?|mejores?)\s+(cuatro|4)\s+semanas?\b|\b(cuatro|4)\s+semanas?\b/.test(q);
  const asksToCompare = /\b(compare|comparison|versus|vs\.?|against|between|best|comparar|comparación|comparacion|contra|entre|mejor)\b/.test(q);
  return refersToFourWeeks && asksToCompare;
}

// Uses only completed, calendar-consecutive weeks. A gap in stored weeks does
// not become a fictional rolling period.
export function fourWeekComparisonAnalysis(weeks: FourWeekComparable[]) {
  const closed = weeks
    .filter((week) => week.status === "closed")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const windows: { startDate: string; endDate: string; total: number; averageWeek: number }[] = [];

  for (let index = 0; index <= closed.length - 4; index++) {
    const group = closed.slice(index, index + 4);
    if (!group.every((week, offset) => offset === 0 || isNextCalendarWeek(group[offset - 1].startDate, week.startDate))) {
      continue;
    }
    const total = round(group.reduce((sum, week) => sum + week.total, 0));
    windows.push({
      startDate: group[0].startDate,
      endDate: group[3].endDate,
      total,
      averageWeek: round(total / 4),
    });
  }

  if (!windows.length) return null;
  const latest = windows[windows.length - 1];
  const best = windows.reduce((winner, candidate) => candidate.total >= winner.total ? candidate : winner);
  return {
    weeksPerPeriod: 4,
    eligibleClosedWeeks: closed.length,
    eligiblePeriods: windows.length,
    latest,
    best,
    changeTotal: round(latest.total - best.total),
    changeAverageWeek: round(latest.averageWeek - best.averageWeek),
    latestIsBest: latest.startDate === best.startDate && latest.endDate === best.endDate,
  };
}

// ---------- Grouped / consecutive-day analytics ----------

const DAY_ALIASES: Record<string, string> = {
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
  sun: "Sunday", sunday: "Sunday",
};

const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function flattenDays(weeks: NormalizedWeek[]) {
  return weeks
    .flatMap((w) => w.dayTotals.map((d) => ({ date: d.date, day: d.day, total: d.total })))
    .filter((d) => !!d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseWeekdayMentions(prompt: string): string[] {
  const q = prompt.toLowerCase();
  const hits: string[] = [];
  const seen = new Set<string>();
  const tokens = q.match(/\b(mon|monday|mondays|tue|tues|tuesday|tuesdays|wed|weds|wednesday|wednesdays|thu|thur|thurs|thursday|thursdays|fri|friday|fridays|sat|saturday|saturdays|sun|sunday|sundays)\b/g) ?? [];
  for (const raw of tokens) {
    const token = raw.endsWith("s") && raw.length > 3 ? raw.slice(0, -1) : raw;
    const full = DAY_ALIASES[token];
    if (full && !seen.has(full)) {
      seen.add(full);
      hits.push(full);
    }
  }
  return hits;
}

function parseRequestedLimit(prompt: string, fallback: number): number {
  const m = prompt.toLowerCase().match(/\b(?:top|bottom|first|last)?\s*(\d{1,3})\b/);
  if (!m) return fallback;
  return Math.min(100, Math.max(1, Number(m[1])));
}

function isWorstDayQuestion(prompt: string): boolean {
  const q = prompt.toLowerCase();
  return /\b(worst|lowest|bottom|least|bad days|low days)\b/.test(q);
}

function isBestDayQuestion(prompt: string): boolean {
  const q = prompt.toLowerCase();
  const intent = detectIntent(prompt);
  if (intent === "HOUR" || intent === "STREAK" || intent === "MONTH") return false;
  return /\b(best|highest|top|strongest)\b/.test(q) &&
    (/\b(day|days|earning|earnings)\b/.test(q) || parseWeekdayMentions(prompt).length > 0);
}

function isWeekdayListQuestion(prompt: string): boolean {
  const q = prompt.toLowerCase();
  const weekdays = parseWeekdayMentions(prompt);
  if (weekdays.length !== 1) return false;
  return /\b(all|show|list|see|only|every|each)\b/.test(q);
}

function isDayRankingQuestion(prompt: string): boolean {
  return isWorstDayQuestion(prompt) || isBestDayQuestion(prompt);
}

function weekdayListAnalysis(weeks: NormalizedWeek[], prompt: string) {
  const [weekday] = parseWeekdayMentions(prompt);
  if (!weekday || !isWeekdayListQuestion(prompt)) return null;
  const limit = parseRequestedLimit(prompt, 60);
  const days = flattenDays(weeks)
    .filter((day) => day.day === weekday)
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    weekday,
    totalMatches: days.length,
    returned: Math.min(days.length, limit),
    limited: days.length > limit,
    days: days.slice(0, limit).map((day) => ({ ...day, total: round(day.total) })),
  };
}

function dayRankingAnalysis(weeks: NormalizedWeek[], prompt: string) {
  if (!isDayRankingQuestion(prompt)) return null;
  const q = prompt.toLowerCase();
  const singularBestDay = /\b(best|highest|top|strongest)\b/.test(q) && /\bday\b/.test(q) && !/\bdays\b/.test(q);
  const limit = parseRequestedLimit(prompt, singularBestDay ? 1 : 20);
  const weekdays = parseWeekdayMentions(prompt);
  const includeZeroDays = !/\b(worked|active|earning days|paid days)\b/.test(q);
  const sortAscending = isWorstDayQuestion(prompt);
  const days = flattenDays(weeks)
    .filter((day) => weekdays.length === 0 || weekdays.includes(day.day))
    .filter((day) => includeZeroDays || day.total > 0)
    .sort((a, b) => sortAscending ? a.total - b.total || a.date.localeCompare(b.date) : b.total - a.total || a.date.localeCompare(b.date));

  return {
    kind: sortAscending ? "worst_days" : "best_days",
    sort: sortAscending ? "ascending_total" : "descending_total",
    weekdayFilter: weekdays.length ? weekdays : null,
    includeZeroDays,
    totalCandidates: days.length,
    returned: Math.min(days.length, limit),
    limited: days.length > limit,
    days: days.slice(0, limit).map((day) => ({ ...day, total: round(day.total) })),
  };
}

export function restPairMode(prompt: string): "take_off" | "protect" | null {
  const q = prompt.toLowerCase();
  const asksForRest =
    /\b(day off|days off|off day|off days|rest|break|take off)\b/.test(q) ||
    /\b(descansar|descanso|libre|libres|dia libre|día libre|dias libres|días libres)\b/.test(q);
  const asksForTwo =
    /\b(two|2|dos)\b/.test(q) || /\bpair|pareja\b/.test(q);
  const asksForConsecutive =
    /\b(consecutive|back-to-back|together|in a row|seguidos|seguidas|consecutivos|consecutivas)\b/.test(q);
  const asksWhatToProtect =
    /\b(should not|shouldn't|dont rest|don't rest|not rest|avoid resting|no descansar|no deberia|no debería|no deberia descansar|no debería descansar)\b/.test(q);
  if (asksForRest && asksForTwo && asksWhatToProtect) return "protect";
  if (asksForRest && asksForTwo && asksForConsecutive) return "take_off";
  return null;
}

function isConsecutiveDayOffQuestion(prompt: string): boolean {
  return restPairMode(prompt) !== null;
}

// Real-life consecutive weekday pairs. Includes Sunday→Monday so
// recommendations reflect calendar reality even when the pair crosses the
// Streex Monday–Sunday week boundary.
const CONSECUTIVE_WEEKDAY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["Monday", "Tuesday"],
  ["Tuesday", "Wednesday"],
  ["Wednesday", "Thursday"],
  ["Thursday", "Friday"],
  ["Friday", "Saturday"],
  ["Saturday", "Sunday"],
  ["Sunday", "Monday"],
];
const SAMPLE_SIZE_FLOOR = 4;

export function consecutiveDayOffAnalysis(weeks: NormalizedWeek[], prompt: string) {
  const mode = restPairMode(prompt);
  if (!mode) return null;
  const stats = weekdayStats(weeks) as Record<string, { average: number; count: number; best: number; bestDate: string | null }>;
  const weekdayAverages = WEEKDAY_ORDER
    .map((day) => ({ day, average: stats[day]?.average ?? null, count: stats[day]?.count ?? 0 }))
    .filter((item) => item.average !== null);
  const rawPairs = CONSECUTIVE_WEEKDAY_PAIRS.map(([day, nextDay], naturalOrder) => {
    const first = stats[day];
    const second = stats[nextDay];
    if (!first || !second) return null;
    const minimumSampleSize = Math.min(first.count, second.count);
    return {
      days: [day, nextDay] as [string, string],
      combinedAverage: round(first.average + second.average),
      averages: [
        { day, average: first.average, count: first.count },
        { day: nextDay, average: second.average, count: second.count },
      ],
      minimumSampleSize,
      crossesWeekBoundary: day === "Sunday" && nextDay === "Monday",
      lowSample: minimumSampleSize < SAMPLE_SIZE_FLOOR,
      naturalOrder,
    };
  }).filter((pair): pair is NonNullable<typeof pair> => Boolean(pair));

  // Default presentation order: ascending combined average (lowest-impact first).
  // Deterministic tie-breaks: larger minimum sample size first, then natural
  // weekday-pair order (Mon→Tue ... Sun→Mon).
  const pairs = [...rawPairs].sort((a, b) =>
    a.combinedAverage - b.combinedAverage
    || b.minimumSampleSize - a.minimumSampleSize
    || a.naturalOrder - b.naturalOrder
  );

  let recommendation: (typeof pairs)[number] | null = null;
  if (pairs.length) {
    if (mode === "protect") {
      // Highest combined average; same tie-breakers.
      recommendation = [...rawPairs].sort((a, b) =>
        b.combinedAverage - a.combinedAverage
        || b.minimumSampleSize - a.minimumSampleSize
        || a.naturalOrder - b.naturalOrder
      )[0] ?? null;
    } else {
      recommendation = pairs[0] ?? null;
    }
  }

  const lowSampleSize = recommendation ? recommendation.minimumSampleSize < SAMPLE_SIZE_FLOOR : false;

  return {
    method: "weekday_average_consecutive_pairs_lowest_combined_impact",
    mode,
    weekdayAverages,
    pairs,
    recommendation,
    sampleSizeFloor: SAMPLE_SIZE_FLOOR,
    lowSampleSize,
    sampleSizeCaveat: lowSampleSize
      ? `Recommendation based on fewer than ${SAMPLE_SIZE_FLOOR} historical samples for one of the weekdays; treat as directional.`
      : null,
  };
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  return Math.round(ms / 86400000);
}

// Top consecutive-day windows of size N across history (calendar-consecutive).
function topConsecutiveWindows(weeks: NormalizedWeek[], size: number, topN = 3) {
  const days = flattenDays(weeks);
  const results: { startDate: string; endDate: string; total: number; days: { date: string; day: string; total: number }[] }[] = [];
  for (let i = 0; i + size <= days.length; i++) {
    const window = days.slice(i, i + size);
    if (daysBetween(window[0].date, window[size - 1].date) !== size - 1) continue;
    const total = window.reduce((s, d) => s + d.total, 0);
    if (total <= 0) continue;
    results.push({
      startDate: window[0].date,
      endDate: window[size - 1].date,
      total: round(total),
      days: window.map((d) => ({ date: d.date, day: d.day, total: round(d.total) })),
    });
  }
  results.sort((a, b) => b.total - a.total);
  return results.slice(0, topN);
}

// Top combinations within each calendar week matching a specific weekday set.
function topWeekdayCombos(weeks: NormalizedWeek[], dayNames: string[], topN = 3) {
  const wanted = new Set(dayNames);
  const results: { startDate: string; endDate: string; total: number; days: { date: string; day: string; total: number }[] }[] = [];
  for (const w of weeks) {
    const matched = w.dayTotals.filter((d) => wanted.has(d.day));
    if (matched.length !== dayNames.length) continue;
    const total = matched.reduce((s, d) => s + d.total, 0);
    if (total <= 0) continue;
    matched.sort((a, b) => a.date.localeCompare(b.date));
    results.push({
      startDate: matched[0].date,
      endDate: matched[matched.length - 1].date,
      total: round(total),
      days: matched.map((d) => ({ date: d.date, day: d.day, total: round(d.total) })),
    });
  }
  results.sort((a, b) => b.total - a.total);
  const totals = results.map((r) => r.total);
  const average = totals.length ? round(totals.reduce((s, v) => s + v, 0) / totals.length) : 0;
  return { top: results.slice(0, topN), sampleSize: results.length, average };
}

function monthRankingAnalysis(weeks: NormalizedWeek[]) {
  const months = rollupDaysByMonth(weeks).sort((a, b) => b.total - a.total || a.period.localeCompare(b.period));
  const chronological = [...months].sort((a, b) => a.period.localeCompare(b.period));
  return {
    strongest: months[0] ?? null,
    weakest: [...months].reverse().find((m) => m.total > 0) ?? null,
    monthsCompared: months.length,
    chronological,
    top: months.slice(0, 5),
  };
}

function highestEarningStreakAnalysis(weeks: NormalizedWeek[]) {
  const days = flattenDays(weeks);
  const streaks: { startDate: string; endDate: string; days: number; total: number; averageDay: number }[] = [];
  let current: { startDate: string; endDate: string; days: number; total: number } | null = null;

  for (const day of days) {
    if (day.total <= 0) {
      if (current) {
        streaks.push({ ...current, total: round(current.total), averageDay: round(current.total / current.days) });
        current = null;
      }
      continue;
    }

    if (!current || daysBetween(current.endDate, day.date) !== 1) {
      if (current) {
        streaks.push({ ...current, total: round(current.total), averageDay: round(current.total / current.days) });
      }
      current = { startDate: day.date, endDate: day.date, days: 1, total: day.total };
      continue;
    }

    current.endDate = day.date;
    current.days += 1;
    current.total += day.total;
  }

  if (current) {
    streaks.push({ ...current, total: round(current.total), averageDay: round(current.total / current.days) });
  }

  return {
    highestByTotal: [...streaks].sort((a, b) => b.total - a.total || b.days - a.days)[0] ?? null,
    longest: [...streaks].sort((a, b) => b.days - a.days || b.total - a.total)[0] ?? null,
    topByTotal: [...streaks].sort((a, b) => b.total - a.total || b.days - a.days).slice(0, 5),
    streaksCompared: streaks.length,
  };
}

function weekendTrendAnalysis(weeks: NormalizedWeek[]) {
  const sorted = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const rows = sorted.map((week) => {
    const saturday = week.dayTotals.find((day) => day.day === "Saturday")?.total ?? 0;
    const sunday = week.dayTotals.find((day) => day.day === "Sunday")?.total ?? 0;
    return { startDate: week.startDate, endDate: week.endDate, total: round(saturday + sunday), saturday, sunday };
  }).filter((row) => row.total > 0);

  const recent = rows.slice(-4);
  const prior = rows.slice(-8, -4);
  const recentAverage = recent.length ? round(recent.reduce((sum, row) => sum + row.total, 0) / recent.length) : 0;
  const priorAverage = prior.length ? round(prior.reduce((sum, row) => sum + row.total, 0) / prior.length) : 0;
  return {
    recentWeeks: recent.length,
    priorWeeks: prior.length,
    recentAverage,
    priorAverage,
    change: round(recentAverage - priorAverage),
    direction: recentAverage > priorAverage ? "stronger" : recentAverage < priorAverage ? "weaker" : "flat",
    bestWeekend: rows.sort((a, b) => b.total - a.total)[0] ?? null,
  };
}

function currentWeekSnapshot(weeks: NormalizedWeek[]) {
  const latest = [...weeks].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!latest) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const exactToday = latest.dayTotals.find((day) => day.date === todayIso);
  const latestPositive = [...latest.dayTotals].reverse().find((day) => day.total > 0);
  const focusDay = exactToday ?? latestPositive ?? latest.dayTotals[0] ?? null;
  const weekTotal = latest.total;
  const goalLeft = Math.max(0, latest.goal - weekTotal);
  const remainingDays = focusDay
    ? latest.dayTotals.filter((day) => day.date >= focusDay.date).length
    : latest.dayTotals.length;
  const allDays = flattenDays(weeks).filter((day) => day.total > 0).sort((a, b) => b.total - a.total);
  const todayRank = focusDay && focusDay.total > 0
    ? allDays.findIndex((day) => day.date === focusDay.date) + 1
    : 0;
  const bestSameWeekday = focusDay
    ? allDays.filter((day) => day.day === focusDay.day).sort((a, b) => b.total - a.total)[0] ?? null
    : null;
  const bestDayEver = allDays[0] ?? null;

  return {
    week: {
      startDate: latest.startDate,
      endDate: latest.endDate,
      status: latest.status,
      goal: latest.goal,
      total: latest.total,
      daysWorked: latest.daysWorked,
      shiftStats: latest.shiftStats,
    },
    focusDay,
    goalLeft: round(goalLeft),
    remainingDays,
    neededPerRemainingDay: remainingDays > 0 ? round(goalLeft / remainingDays) : 0,
    todayRank: todayRank > 0 ? { rank: todayRank, outOf: allDays.length } : null,
    recordChase: focusDay
      ? {
        bestDayEver,
        bestSameWeekday,
        gapToBestDayEver: bestDayEver ? round(bestDayEver.total - focusDay.total) : null,
        gapToBestSameWeekday: bestSameWeekday ? round(bestSameWeekday.total - focusDay.total) : null,
      }
      : null,
  };
}

function aggregateShiftStats(weeks: NormalizedWeek[]): ShiftStats {
  const totals = weeks.reduce((acc, week) => ({
    totalHours: acc.totalHours + week.shiftStats.totalHours,
    completedShifts: acc.completedShifts + week.shiftStats.completedShifts,
    activeShifts: acc.activeShifts + week.shiftStats.activeShifts,
    totalRides: acc.totalRides + week.shiftStats.totalRides,
    totalMiles: acc.totalMiles + week.shiftStats.totalMiles,
    totalEarnings: acc.totalEarnings + week.total,
  }), { totalHours: 0, completedShifts: 0, activeShifts: 0, totalRides: 0, totalMiles: 0, totalEarnings: 0 });
  return {
    totalHours: round(totals.totalHours),
    completedShifts: totals.completedShifts,
    activeShifts: totals.activeShifts,
    totalRides: totals.totalRides,
    totalMiles: round(totals.totalMiles),
    earningsPerHour: totals.totalHours > 0 ? round(totals.totalEarnings / totals.totalHours) : null,
    earningsPerRide: totals.totalRides > 0 ? round(totals.totalEarnings / totals.totalRides) : null,
    ridesPerHour: totals.totalHours > 0 && totals.totalRides > 0 ? round(totals.totalRides / totals.totalHours) : null,
  };
}

function parseDayCombo(prompt: string): string[] | null {
  const q = prompt.toLowerCase();
  const hits = parseWeekdayMentions(prompt);
  if (hits.length >= 2) return hits;
  if (/\bweekend\b/.test(q)) return ["Saturday", "Sunday"];
  return null;
}

function parseConsecutiveWindow(prompt: string): number | null {
  const q = prompt.toLowerCase();
  const m = q.match(/\b(\d+)\s*[- ]?\s*day\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 2 && n <= 14) return n;
  }
  if (/\bconsecutive\b/.test(q) || /\brolling\b/.test(q) || /\bstreak\b/.test(q) ||
    /\bseguidos|seguidas|consecutivos|consecutivas\b/.test(q)) {
    // Default to 3-day window if no explicit number
    return 3;
  }
  return null;
}

// ---------- App-vs-App head-to-head ----------

function normalizeAppName(raw: string, knownApps: string[]): string | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  for (const app of knownApps) {
    if (app.toLowerCase() === q) return app;
  }
  for (const app of knownApps) {
    if (app.toLowerCase().includes(q) || q.includes(app.toLowerCase())) return app;
  }
  return null;
}

function parseAppPair(prompt: string, knownApps: string[]): [string, string] | null {
  const q = prompt.toLowerCase();
  // Find any two distinct known apps mentioned
  const found: string[] = [];
  for (const app of knownApps) {
    const name = app.toLowerCase();
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(q) && !found.includes(app)) found.push(app);
    if (found.length === 2) break;
  }
  if (found.length === 2) return [found[0], found[1]];
  // Try a vs b / a beat b pattern with free tokens
  const m = q.match(/([a-z][a-z0-9 ]{1,20}?)\s+(?:vs\.?|versus|beat|beats|over|against|outearned|outperform(?:ed)?)\s+([a-z][a-z0-9 ]{1,20})/);
  if (m) {
    const a = normalizeAppName(m[1], knownApps);
    const b = normalizeAppName(m[2], knownApps);
    if (a && b && a !== b) return [a, b];
  }
  return null;
}

function appHeadToHead(weeks: NormalizedWeek[], appA: string, appB: string) {
  // Only consider weeks where at least one of the two apps has any earnings.
  const sorted = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let aWins = 0, bWins = 0, ties = 0;
  let lastAWin: { startDate: string; endDate: string; aTotal: number; bTotal: number } | null = null;
  let lastBWin: { startDate: string; endDate: string; aTotal: number; bTotal: number } | null = null;
  let bestA: { startDate: string; total: number } | null = null;
  let bestB: { startDate: string; total: number } | null = null;
  const perWeek: { startDate: string; endDate: string; a: number; b: number; winner: "A" | "B" | "tie" | "none" }[] = [];
  for (const w of sorted) {
    const a = round(w.appTotals[appA] ?? 0);
    const b = round(w.appTotals[appB] ?? 0);
    if (a === 0 && b === 0) {
      perWeek.push({ startDate: w.startDate, endDate: w.endDate, a, b, winner: "none" });
      continue;
    }
    if (!bestA || a > bestA.total) bestA = { startDate: w.startDate, total: a };
    if (!bestB || b > bestB.total) bestB = { startDate: w.startDate, total: b };
    let winner: "A" | "B" | "tie" = "tie";
    if (a > b) { aWins++; winner = "A"; lastAWin = { startDate: w.startDate, endDate: w.endDate, aTotal: a, bTotal: b }; }
    else if (b > a) { bWins++; winner = "B"; lastBWin = { startDate: w.startDate, endDate: w.endDate, aTotal: a, bTotal: b }; }
    else { ties++; }
    perWeek.push({ startDate: w.startDate, endDate: w.endDate, a, b, winner });
  }
  const decided = aWins + bWins + ties;
  // Recent vs all-time trend (last 8 weeks with comparable data)
  const decidedWeeks = perWeek.filter((p) => p.winner !== "none");
  const recent = decidedWeeks.slice(-8);
  const recentA = recent.filter((p) => p.winner === "A").length;
  const recentB = recent.filter((p) => p.winner === "B").length;
  return {
    appA, appB,
    weeksCompared: decided,
    weeksWithoutEitherApp: perWeek.length - decided,
    aWins, bWins, ties,
    bestWeekFor: { [appA]: bestA, [appB]: bestB },
    lastWeekAppABeatAppB: lastAWin,
    lastWeekAppBBeatAppA: lastBWin,
    recentTrend: {
      windowWeeks: recent.length,
      [`${appA}Wins`]: recentA,
      [`${appB}Wins`]: recentB,
    },
    allTimeWinner: aWins > bWins ? appA : bWins > aWins ? appB : "tie",
    // Keep payload compact: cap to 24 most recent compared weeks
    weeklyTimeline: decidedWeeks.slice(-24),
  };
}

// ---------- Intent detection ----------

const HISTORICAL_TERMS = [
  "history", "historical", "historically", "ever", "all time", "all-time",
  "lifetime", "career", "in my history", "of all time", "overall",
];

function isHistoricalQuestion(prompt: string): boolean {
  const q = prompt.toLowerCase();
  return HISTORICAL_TERMS.some((t) => q.includes(t));
}

export function detectIntent(prompt: string, knownApps: string[] = []): AskIntent {
  const q = prompt.toLowerCase();
  if (/\b(ride count|rides|trips|per ride|rides per hour)\b/.test(q)) return "HOUR";
  if (/\b(hour|hours|hourly|earning hour|best hour)\b/.test(q)) return "HOUR";
  if (/\b(streak|streaks|racha|racha de ganancias)\b/.test(q)) return "STREAK";
  if (/\b(month|months|monthly|mes|meses)\b/.test(q)) return "MONTH";
  if (/\b(goal|target|meta|hit my goal|need per day|per day to hit|rest of the week|restante|por día|por dia)\b/.test(q)) return "GOAL";
  if (/\b(today rank|rank today|where does today rank|closest record|record.*closest|closest.*record|ranking.*today)\b/.test(q)) return "RANKING";
  if (/\b(rival|past me|version of me|toughest rival|mi rival|yo del pasado)\b/.test(q)) return "RIVAL";
  if (/\b(surprising|surprise|unusual|weird|interesting|opportunity|story|tell me something|most unusual|biggest opportunity)\b/.test(q)) return "INSIGHT";
  if (/\b(pattern|trend|changed the most|pay attention|getting stronger|getting weaker|improving|improvement|growth|weaker|stronger)\b/.test(q)) return "PATTERN";
  if (/\b(coach|coaching|focus on|mistake|decision|schedule|healthiest|ideal work|work schedule)\b/.test(q)) return "COACHING";
  if (isAppVsAppQuestion(prompt, knownApps)) return "RANKING";
  if (/\b(week|weekly)\b/.test(q)) return "WEEK";
  if (/\b(day|days|weekday|weekdays|today|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/.test(q)) return "DAY";
  return "GENERAL";
}

function isAppVsAppQuestion(prompt: string, knownApps: string[]): boolean {
  const pair = parseAppPair(prompt, knownApps);
  if (!pair) return false;
  const q = prompt.toLowerCase();
  return /\b(vs\.?|versus|beat|beats|beaten|over|against|outearn|outperform|compare|which.*better|stronger|more than)\b/.test(q)
    || /\bwin(s|ner)?\b/.test(q);
}

function isComboOrWindowQuestion(prompt: string): boolean {
  return parseDayCombo(prompt) !== null || parseConsecutiveWindow(prompt) !== null;
}

async function fetchWeeksForScope(supabase: SupabaseClient, scope: DataScope) {
  const selectFields = "id,start_date,end_date,weekly_goal,status,entries";

  if (scope === "RECENT") {
    const result = await supabase.from("weeks")
      .select(selectFields)
      .order("start_date", { ascending: false })
      .limit(16);

    return {
      data: (result.data ?? []) as WeekRow[],
      error: result.error,
      rowsFetched: result.data?.length ?? 0,
      mode: "recent-limit-16",
    };
  }

  const pageSize = 1000;
  const allRows: WeekRow[] = [];
  for (let from = 0; from < 10000; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await supabase.from("weeks")
      .select(selectFields)
      .order("start_date", { ascending: false })
      .range(from, to);

    if (result.error) {
      return {
        data: allRows,
        error: result.error,
        rowsFetched: allRows.length,
        mode: "all-history-paginated",
      };
    }

    const rows = (result.data ?? []) as WeekRow[];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }

  return {
    data: allRows,
    error: null,
    rowsFetched: allRows.length,
    mode: "all-history-paginated",
  };
}

/** PostgREST commonly caps a single response at 1,000 rows. Mobility evidence
 * must be complete before it can drive a recommendation, so fetch every
 * caller-scoped page instead of treating the first page as full history. */
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

export function isMobilityQuestion(prompt: string): boolean {
  return /\b(zone|zones|area|areas|pickup|dropoff|destination|where should i|where to work|where do i|hourly|best hour|best two hours?|time window|window|planner|plan my shift|plan a shift|work \d+ hours?|hours? today|zona|zonas|área|area|recogida|destino|horario|ventana|planificador|planifica|trabajar \d+ horas?|dónde trabajar|donde trabajar|mejor hora|mejores? horas?|dos horas|por hora|por horas)\b/i.test(prompt);
}

function weekdayEfficiencyAnalysis(weeks: NormalizedWeek[], prompt: string, timingEvidenceDates?: string[]) {
  const q = prompt.toLowerCase();
  const asksDay = /\b(day|weekday|día|dia)\b/.test(q);
  const asksHourly = /\b(per hour|hourly|earning hours?|por horas?|por hora de trabajo|horas?)\b/.test(q);
  if (!asksDay || !asksHourly) return null;
  const evidence = timingEvidenceDates ? new Set(timingEvidenceDates) : null;
  const rows = WEEKDAY_ORDER.map((weekday) => {
    const days = weeks.flatMap((week) => week.dayTotals.filter((day) => day.day === weekday && (!evidence || evidence.has(day.date))));
    const hours = days.reduce((sum, day) => sum + day.hours, 0);
    const earnings = days.reduce((sum, day) => sum + day.operationalTotal, 0);
    const shifts = days.reduce((sum, day) => sum + day.completedShifts, 0);
    return {
      weekday,
      earnings: round(earnings),
      hours: round(hours),
      shifts,
      days: days.filter((day) => day.total > 0).length,
      earningsPerHour: hours > 0 ? round(earnings / hours) : null,
    };
  }).filter((row) => row.earningsPerHour !== null);
  rows.sort((a, b) => (b.earningsPerHour ?? 0) - (a.earningsPerHour ?? 0) || b.days - a.days);
  return {
    method: "weekday_operational_earnings_divided_by_completed_shift_hours",
    rows,
    timingEvidence: evidence ? "Only days with ride timing or positive earnings snapshots at least 30 minutes apart are included." : "All completed shift days in the loaded scope are included.",
  };
}

function requestedHours(prompt: string): number | null {
  const match = prompt.match(/\b(?:for|work|trabajar|de|por)?\s*(\d{1,2})\s*(?:hours?|hrs?|horas?)\b/i);
  if (!match) return null;
  const hours = Number(match[1]);
  return Number.isFinite(hours) && hours >= 1 && hours <= 12 ? hours : null;
}

function localRideTime(timestamp: string, timeZone: string | null): { weekday: string; hour: number } | null {
  if (!timeZone || !timestamp) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return weekday && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? { weekday, hour } : null;
  } catch {
    // An invalid IANA zone is excluded, never silently converted to UTC.
    return null;
  }
}

function pickupZoneForAnalytics(ride: MobilityRideRow): string | null {
  if (ride.source !== "foreground_browser" || ride.status === "active" || ride.status === "cancelled") return null;
  if (ride.lifecycle_version === 2) {
    return ride.pickup_capture_status === "captured" ? ride.pickup_zone_key : null;
  }
  return ride.start_capture_status === "captured" ? ride.start_zone_key : null;
}

function snapshotEffectiveDeltas(rows: SnapshotRow[]): Map<string, number> {
  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.week_id}|${row.day_date}|${row.app}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result = new Map<string, number>();
  for (const group of grouped.values()) {
    let correctionDebt = 0;
    for (const row of [...group].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      const delta = Number(row.delta) || 0;
      if (delta <= 0) {
        correctionDebt += Math.abs(delta);
        result.set(row.id, 0);
        continue;
      }
      const recovery = Math.min(correctionDebt, delta);
      correctionDebt = round(correctionDebt - recovery);
      result.set(row.id, round(delta - recovery));
    }
  }
  return result;
}

type MobilitySignal = {
  zone: string;
  weekday: string;
  hour: number | null;
  dayDate: string;
  rideId: string;
  earnings: number;
  acceptanceZone: string | null;
  acceptanceHour: number | null;
  acceptanceWeekday: string | null;
  rideHours: number | null;
};

/**
 * Builds evidence-only pickup earnings and future operating-window signals.
 * - Money stays at confirmed pickup, never acceptance or dropoff.
 * - A start-market/window signal needs lifecycle v2 + captured acceptance + a
 *   browser time zone. Legacy rides are useful for pickup earnings but are not
 *   guessed into a planner window.
 */
export function buildMobilityAnalysis(args: {
  rides: MobilityRideRow[];
  snapshots: SnapshotRow[];
  snapshotAllocations: RideAllocationRow[];
  manualAllocations: RideAllocationRow[];
  batches: RideBatchRow[];
  batchEvents: RideBatchEventRow[];
  payments: RidePaymentRow[];
  zoneLabels: ZoneLabelRow[];
  prompt: string;
}) {
  const labels = new Map(args.zoneLabels.map((row) => [row.zone_key, row.label.trim().slice(0, 80)]));
  const labelFor = (zoneKey: string) => labels.get(zoneKey) || "Unlabeled approximate pickup zone";
  const ridesById = new Map(args.rides.map((ride) => [ride.id, ride]));
  const effectiveDeltas = snapshotEffectiveDeltas(args.snapshots);
  // Two snapshots entered seconds apart are commonly an import/correction
  // artifact, not evidence that the driver worked across that day. Require a
  // meaningful spacing before a daily snapshot-only record can qualify for
  // hourly weekday comparisons.
  const MIN_SNAPSHOT_SPACING_MS = 30 * 60 * 1000;
  const snapshotTimesByDate = new Map<string, number[]>();
  for (const snapshot of args.snapshots) {
    if ((effectiveDeltas.get(snapshot.id) ?? 0) <= 0) continue;
    const timestamp = Date.parse(snapshot.created_at);
    if (!Number.isFinite(timestamp)) continue;
    snapshotTimesByDate.set(snapshot.day_date, [...(snapshotTimesByDate.get(snapshot.day_date) ?? []), timestamp]);
  }
  const snapshotTimingEvidenceDates = [...snapshotTimesByDate.entries()]
    .filter(([, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return sorted.some((time, index) => index > 0 && time - sorted[index - 1] >= MIN_SNAPSHOT_SPACING_MS);
    })
    .map(([date]) => date);
  const rideTimingDates = args.rides
    .filter((ride) => ride.lifecycle_version === 2 && ride.status === "completed" && Number.isFinite(Date.parse(ride.started_at)) && Number.isFinite(Date.parse(ride.ended_at ?? "")) && Date.parse(ride.ended_at ?? "") > Date.parse(ride.started_at))
    .map((ride) => ride.day_date);
  const timingEvidenceDates = [...new Set([
    ...rideTimingDates,
    ...snapshotTimingEvidenceDates,
  ])].sort();
  const ledgerSnapshots = new Set(args.snapshotAllocations
    .filter((row) => row.is_current && row.earnings_snapshot_id)
    .map((row) => row.earnings_snapshot_id!));
  const earningsByRide = new Map<string, number>();
  const add = (rideId: string | null, amount: unknown) => {
    if (!rideId) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    earningsByRide.set(rideId, round((earningsByRide.get(rideId) ?? 0) + parsed));
  };

  for (const row of args.snapshotAllocations) {
    if (row.is_current && row.ride_event_id && ["ride_base", "late_tip", "adjustment"].includes(row.kind)) add(row.ride_event_id, row.amount);
  }
  for (const row of args.manualAllocations) {
    if (row.is_current && row.ride_event_id && row.kind === "ride_base") add(row.ride_event_id, row.amount);
  }
  for (const row of args.payments) {
    if (!ledgerSnapshots.has(row.earnings_snapshot_id)) add(row.ride_event_id, effectiveDeltas.get(row.earnings_snapshot_id) ?? 0);
  }
  const batchById = new Map(args.batches.map((batch) => [batch.id, batch]));
  const rideIdsByBatch = new Map<string, string[]>();
  for (const link of args.batchEvents) rideIdsByBatch.set(link.batch_id, [...(rideIdsByBatch.get(link.batch_id) ?? []), link.ride_event_id]);
  for (const [batchId, rideIds] of rideIdsByBatch) {
    const batch = batchById.get(batchId);
    if (!batch || batch.kind !== "single" || rideIds.length !== 1 || ledgerSnapshots.has(batch.earnings_snapshot_id)) continue;
    add(rideIds[0], effectiveDeltas.get(batch.earnings_snapshot_id) ?? 0);
  }

  const signals: MobilitySignal[] = [];
  for (const [rideId, earnings] of earningsByRide) {
    const ride = ridesById.get(rideId);
    const pickupZone = ride ? pickupZoneForAnalytics(ride) : null;
    if (!ride || !pickupZone || earnings <= 0) continue;
    const pickupTime = localRideTime(ride.lifecycle_version === 2 ? (ride.pickup_at ?? ride.started_at) : ride.started_at, ride.time_zone);
    const acceptanceTime = ride.lifecycle_version === 2 && ride.start_capture_status === "captured" && ride.start_zone_key
      ? localRideTime(ride.started_at, ride.time_zone)
      : null;
    signals.push({
      zone: labelFor(pickupZone),
      weekday: pickupTime?.weekday ?? new Date(`${ride.day_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" }),
      hour: pickupTime?.hour ?? null,
      dayDate: ride.day_date,
      rideId,
      earnings,
      acceptanceZone: ride.lifecycle_version === 2 && ride.start_capture_status === "captured" && ride.start_zone_key ? labelFor(ride.start_zone_key) : null,
      acceptanceHour: acceptanceTime?.hour ?? null,
      acceptanceWeekday: acceptanceTime?.weekday ?? null,
      rideHours: ride.ended_at
        ? (() => {
          const start = Date.parse(ride.started_at);
          const end = Date.parse(ride.ended_at!);
          return Number.isFinite(start) && Number.isFinite(end) && end > start
            ? (end - start) / 3_600_000
            : null;
        })()
        : null,
    });
  }

  const rollup = <T extends { earnings: number; dayDate: string; rideId: string }>(items: T[]) => ({
    earnings: round(items.reduce((sum, item) => sum + item.earnings, 0)),
    rides: new Set(items.map((item) => item.rideId)).size,
    days: new Set(items.map((item) => item.dayDate)).size,
  });
  const rideTimeRollup = (items: MobilitySignal[]) => {
    const stats = rollup(items);
    const rideHours = round(items.reduce((sum, item) => sum + (item.rideHours && item.rideHours <= 24 ? item.rideHours : 0), 0));
    return { ...stats, rideHours, earningsPerRideHour: rideHours > 0 ? round(stats.earnings / rideHours) : null };
  };
  const byZone = new Map<string, MobilitySignal[]>();
  for (const signal of signals) byZone.set(signal.zone, [...(byZone.get(signal.zone) ?? []), signal]);
  const pickupZones = [...byZone.entries()].map(([zone, items]) => {
    const stats = rideTimeRollup(items);
    const confidence = stats.rides >= 8 && stats.days >= 3 ? "ready" : stats.rides >= 3 && stats.days >= 2 ? "building" : "low";
    return { zone, ...stats, averagePerRide: stats.rides ? round(stats.earnings / stats.rides) : null, confidence };
  }).sort((a, b) => b.earnings - a.earnings || b.rides - a.rides).slice(0, 12);

  const byPickupHour = new Map<string, MobilitySignal[]>();
  for (const signal of signals.filter((item) => item.hour !== null)) {
    const key = `${signal.weekday}|${signal.hour}`;
    byPickupHour.set(key, [...(byPickupHour.get(key) ?? []), signal]);
  }
  const pickupHours = [...byPickupHour.entries()].map(([key, items]) => {
    const [weekday, hour] = key.split("|");
    const stats = rideTimeRollup(items);
    return { weekday, hour: Number(hour), ...stats, averagePerRide: stats.rides ? round(stats.earnings / stats.rides) : null };
  }).sort((a, b) => Number(b.averagePerRide ?? 0) - Number(a.averagePerRide ?? 0) || b.rides - a.rides).slice(0, 18);

  const bestPickupWindows: Array<{ weekday: string; startHour: number; endHourExclusive: number; earnings: number; rides: number; days: number; rideHours: number; averagePerRide: number | null; averageWindowEarningsPerHour: number | null; earningsPerRideHour: number | null; confidence: string }> = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (let startHour = 0; startHour <= 22; startHour++) {
      const items = signals.filter((signal) => signal.weekday === weekday && signal.hour !== null && signal.hour >= startHour && signal.hour < startHour + 2);
      if (!items.length) continue;
      const stats = rideTimeRollup(items);
      bestPickupWindows.push({
        weekday,
        startHour,
        endHourExclusive: startHour + 2,
        ...stats,
        averagePerRide: stats.rides ? round(stats.earnings / stats.rides) : null,
        averageWindowEarningsPerHour: stats.days ? round(stats.earnings / stats.days / 2) : null,
        confidence: stats.rides >= 8 && stats.days >= 3 ? "ready" : stats.rides >= 3 && stats.days >= 2 ? "building" : "low",
      });
    }
  }
  bestPickupWindows.sort((a, b) => Number(b.averageWindowEarningsPerHour ?? 0) - Number(a.averageWindowEarningsPerHour ?? 0) || Number(b.earningsPerRideHour ?? 0) - Number(a.earningsPerRideHour ?? 0) || b.earnings - a.earnings || b.rides - a.rides);

  const zoneWeekdays = [...byZone.entries()].flatMap(([zone, items]) => {
    const byWeekday = new Map<string, MobilitySignal[]>();
    for (const item of items) byWeekday.set(item.weekday, [...(byWeekday.get(item.weekday) ?? []), item]);
    return [...byWeekday.entries()].map(([weekday, weekdayItems]) => {
      const stats = rideTimeRollup(weekdayItems);
      return { zone, weekday, ...stats, averagePerRide: stats.rides ? round(stats.earnings / stats.rides) : null };
    });
  }).sort((a, b) => b.earnings - a.earnings || b.rides - a.rides).slice(0, 24);

  const targetWeekday = parseWeekdayMentions(args.prompt)[0] ?? null;
  const hoursRequested = requestedHours(args.prompt);
  const acceptanceSignals = signals.filter((signal) => signal.acceptanceZone && signal.acceptanceHour !== null && signal.acceptanceWeekday);
  const candidates: Array<{ startHour: number; endHourExclusive: number; zone: string; weekday: string; earnings: number; rides: number; days: number; averagePerRide: number; confidence: "low" | "building" | "ready" }> = [];
  if (targetWeekday && hoursRequested) {
    for (let startHour = 0; startHour <= 24 - hoursRequested; startHour++) {
      const inWindow = acceptanceSignals.filter((signal) =>
        signal.acceptanceWeekday === targetWeekday &&
        signal.acceptanceHour !== null && signal.acceptanceHour >= startHour && signal.acceptanceHour < startHour + hoursRequested,
      );
      const byStartZone = new Map<string, MobilitySignal[]>();
      for (const signal of inWindow) byStartZone.set(signal.acceptanceZone!, [...(byStartZone.get(signal.acceptanceZone!) ?? []), signal]);
      for (const [zone, items] of byStartZone) {
        const stats = rollup(items);
        if (!stats.rides) continue;
        const confidence = stats.rides >= 8 && stats.days >= 3 ? "ready" : stats.rides >= 3 ? "building" : "low";
        candidates.push({
          startHour, endHourExclusive: startHour + hoursRequested, zone, weekday: targetWeekday,
          ...stats, averagePerRide: round(stats.earnings / stats.rides), confidence,
        });
      }
    }
  }
  const plannerCandidates = candidates
    .sort((a, b) => b.averagePerRide - a.averagePerRide || b.earnings - a.earnings || b.rides - a.rides)
    .slice(0, 5);

  const timeZoneRides = args.rides.filter((ride) => Boolean(ride.time_zone)).length;
  return {
    privacy: "Aggregate owner data only. No routes, addresses, raw GPS, or background location history.",
    timingEvidenceDates,
    earningsRule: "Earnings are attributed only to a confirmed pickup zone. Acceptance is an operational starting-market signal; dropoff is destination context and never receives earnings.",
    coverage: {
      ridesLoaded: args.rides.length,
      ridesWithAssignedEarnings: signals.length,
      labeledPickupZones: pickupZones.filter((zone) => zone.zone !== "Unlabeled approximate pickup zone").length,
      ridesWithRecordedTimeZone: timeZoneRides,
      timingEvidenceDays: timingEvidenceDates.length,
      snapshotTimingEvidenceDays: snapshotTimingEvidenceDates.length,
      plannerEligibleRides: acceptanceSignals.length,
      plannerMinimum: { rides: 8, days: 3 },
      timingEvidenceRule: "Ride Start-to-Finish duration or positive snapshots at least 30 minutes apart on the same day.",
    },
    pickupEarnings: {
      zones: pickupZones,
      timeOfPickup: pickupHours,
      bestTwoHourPickupWindows: bestPickupWindows.slice(0, 18),
      zoneWeekdays,
      hourRateDefinition: "earningsPerRideHour is confirmed pickup-linked earnings divided by elapsed Start-to-Finish ride time. It is ride-time efficiency, not total shift $/hour, because idle time between rides is not assigned to a zone.",
    },
    shiftPlanner: targetWeekday && hoursRequested
      ? {
        requestedWeekday: targetWeekday,
        requestedHours: hoursRequested,
        candidates: plannerCandidates,
        caveat: "Candidates summarize accepted rides and their confirmed pickup-linked earnings inside the requested clock window. They are a historical test plan, not live demand, traffic, or a guaranteed outcome.",
      }
      : null,
  };
}

function buildContext(args: {
  scope: DataScope;
  scopeReason: string;
  weeks: WeekRow[];
  settings: { default_weekly_goal: number; currency_symbol: string; active_apps: string[] } | null;
  achievements: { achievement_id: string; unlocked_at: string }[];
  mobility?: ReturnType<typeof buildMobilityAnalysis> | null;
  prompt?: string;
}) {
  const { scope, scopeReason, settings, achievements, mobility = null, prompt = "" } = args;
  const weeks = args.weeks
    .map(normalizeWeek)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const closed = weeks.filter((w) => w.status === "closed");
  const recent = weeks.slice(0, 16);
  const bestRecentWeek = recent.reduce<NormalizedWeek | null>(
    (best, w) => (!best || w.total > best.total ? w : best),
    null,
  );
  const bestWeekEver = weeks.reduce<NormalizedWeek | null>(
    (best, w) => (!best || w.total > best.total ? w : best),
    null,
  );
  const bestClosedWeek = closed.reduce<NormalizedWeek | null>(
    (best, w) => (!best || w.total > best.total ? w : best),
    null,
  );
  const averageClosedWeek = closed.length
    ? round(closed.reduce((s, w) => s + w.total, 0) / closed.length)
    : 0;
  const base = {
    scope,
    scopeReason,
    currency: settings?.currency_symbol ?? "$",
    coverage: {
      totalWeeksAvailable: weeks.length,
      earliestWeekStart: weeks.length ? weeks[weeks.length - 1].startDate : null,
      latestWeekStart: weeks.length ? weeks[0].startDate : null,
      isFullHistoryLoaded: scope !== "RECENT",
    },
    settings: settings
      ? {
        weeklyGoal: Number(settings.default_weekly_goal),
        activeApps: settings.active_apps,
      }
      : null,
  };

  // Compute on-demand analyses for grouped/consecutive/app-vs-app questions.
  // These run on whatever weeks are loaded; coverage tells the model how much that is.
  const knownApps = Array.from(
    new Set([...(settings?.active_apps ?? []), ...weeks.flatMap((w) => Object.keys(w.appTotals))]),
  );
  const intent = detectIntent(prompt, knownApps);
  const analysis: Record<string, unknown> = {};
  if (prompt) {
    analysis.intent = intent;
    const weekdayList = weekdayListAnalysis(weeks, prompt);
    if (weekdayList) {
      analysis.weekdayList = weekdayList;
    }
    const dayRanking = dayRankingAnalysis(weeks, prompt);
    if (dayRanking) {
      analysis.dayRanking = dayRanking;
    }
    const consecutiveDayOff = consecutiveDayOffAnalysis(weeks, prompt);
    if (consecutiveDayOff) {
      analysis.consecutiveDayOff = consecutiveDayOff;
    }
    const combo = parseDayCombo(prompt);
    if (combo) {
      analysis.dayCombo = { days: combo, ...topWeekdayCombos(weeks, combo, 3) };
    }
    const windowSize = parseConsecutiveWindow(prompt);
    if (windowSize) {
      analysis.consecutiveWindow = {
        sizeDays: windowSize,
        top: topConsecutiveWindows(weeks, windowSize, 3),
      };
    }
    if (asksForFourWeekComparison(prompt)) {
      analysis.fourWeekComparison = fourWeekComparisonAnalysis(weeks);
    }
    const pair = parseAppPair(prompt, knownApps);
    if (pair) {
      analysis.appHeadToHead = appHeadToHead(weeks, pair[0], pair[1]);
    }
    if (intent === "MONTH") {
      analysis.monthRanking = monthRankingAnalysis(weeks);
    }
    if (intent === "STREAK") {
      analysis.earningStreak = highestEarningStreakAnalysis(weeks);
    }
    const weekdayEfficiency = weekdayEfficiencyAnalysis(weeks, prompt, mobility?.timingEvidenceDates);
    if (weekdayEfficiency) {
      analysis.weekdayEfficiency = weekdayEfficiency;
    }
    if (mobility && isMobilityQuestion(prompt)) {
      analysis.mobility = mobility;
    }
    if (intent === "GOAL" || intent === "RANKING" || intent === "HOUR") {
      analysis.currentWeek = currentWeekSnapshot(weeks);
    }
    if ((intent === "PATTERN" || intent === "INSIGHT" || intent === "COACHING") && /\bweekend|weekends|saturday|sunday|sábado|sabado|domingo\b/i.test(prompt)) {
      analysis.weekendTrend = weekendTrendAnalysis(weeks);
    }
  }
  const analysisBlock = Object.keys(analysis).length ? { analysis } : {};

  if (scope === "ALL_TIME") {
    const lifetimeTotal = weeks.reduce((sum, w) => sum + w.total, 0);
    const lifetimeShiftStats = aggregateShiftStats(weeks);
    return {
      ...base,
      ...analysisBlock,
      lifetime: {
        weeksTracked: weeks.length,
        closedWeeks: closed.length,
        lifetimeTotal: round(lifetimeTotal),
        averageClosedWeek,
        bestWeekEver: bestWeekEver
          ? {
            startDate: bestWeekEver.startDate,
            endDate: bestWeekEver.endDate,
            status: bestWeekEver.status,
            total: bestWeekEver.total,
            daysWorked: bestWeekEver.daysWorked,
            appTotals: bestWeekEver.appTotals,
          }
          : null,
        bestClosedWeek: bestClosedWeek
          ? {
            startDate: bestClosedWeek.startDate,
            endDate: bestClosedWeek.endDate,
            total: bestClosedWeek.total,
            daysWorked: bestClosedWeek.daysWorked,
            appTotals: bestClosedWeek.appTotals,
          }
          : null,
        appTotals: sumAppTotals(weeks),
        weekdayStats: weekdayStats(weeks),
        streaks: streakStats(weeks),
        evolution: trendBuckets(weeks),
        operations: lifetimeShiftStats,
        bestWeekByHours: [...weeks].sort((a, b) => b.shiftStats.totalHours - a.shiftStats.totalHours)[0] ?? null,
        bestWeekByEfficiency: [...weeks]
          .filter((w) => w.shiftStats.earningsPerHour !== null)
          .sort((a, b) => (b.shiftStats.earningsPerHour ?? 0) - (a.shiftStats.earningsPerHour ?? 0))[0] ?? null,
      },
      recentAchievements: achievements.slice(0, 10),
    };
  }

  if (scope === "SEASONAL") {
    const recentTotal = recent.reduce((sum, w) => sum + w.total, 0);
    const older = weeks.slice(16);
    const olderTotal = older.reduce((sum, w) => sum + w.total, 0);
    return {
      ...base,
      ...analysisBlock,
      periods: {
        monthly: rollupByPeriod(weeks, monthKey),
        quarterly: rollupByPeriod(weeks, quarterKey),
        seasonal: rollupByPeriod(weeks, seasonKey),
      },
      recentVsOlder: {
        recentWeeks: recent.length,
        recentAverage: recent.length ? round(recentTotal / recent.length) : 0,
        olderWeeks: older.length,
        olderAverage: older.length ? round(olderTotal / older.length) : 0,
      },
      operations: aggregateShiftStats(weeks),
      bestClosedWeek: bestClosedWeek
        ? { startDate: bestClosedWeek.startDate, total: bestClosedWeek.total }
        : null,
      bestWeekEver: bestWeekEver
        ? { startDate: bestWeekEver.startDate, total: bestWeekEver.total }
        : null,
    };
  }

  return {
    ...base,
    ...analysisBlock,
    recent: {
      weeksTrackedInScope: recent.length,
      averageClosedWeek,
      bestWeekInScope: bestRecentWeek
        ? { startDate: bestRecentWeek.startDate, total: bestRecentWeek.total }
        : null,
      bestClosedWeekInScope: bestClosedWeek
        ? { startDate: bestClosedWeek.startDate, total: bestClosedWeek.total }
        : null,
      appTotals: sumAppTotals(recent),
      weekdayStats: weekdayStats(recent),
      streaks: streakStats(recent),
      weeks: recent.map((w) => ({
        startDate: w.startDate,
        endDate: w.endDate,
        status: w.status,
        goal: w.goal,
        total: w.total,
        daysWorked: w.daysWorked,
        shiftStats: w.shiftStats,
        dayTotals: w.dayTotals,
        appTotals: w.appTotals,
      })),
      operations: aggregateShiftStats(recent),
    },
    recentAchievements: achievements.slice(0, 10),
  };
}

function streamHeaders(contentType = "text/event-stream") {
  return {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function aiModelConfig(model: string) {
  return Object.values(AI_MODELS).find((candidate) => candidate.id === model) ?? null;
}

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const config = aiModelConfig(model);
  if (!config) return 0;
  const inputCost = (inputTokens / 1_000_000) * config.inputUsdPer1M;
  const outputCost = (outputTokens / 1_000_000) * config.outputUsdPer1M;
  return roundCost(inputCost + outputCost);
}

// Luna is the normal path. Terra is intentionally reserved for prompts that
// ask for an explicit cross-period comparison or multi-part strategic synthesis.
// Deterministic answers return before this plan is used and never call OpenAI.
export function selectAiModel(
  prompt: string,
  scope: DataScope,
  knownApps: string[] = [],
): ModelPlan {
  const q = prompt.toLowerCase();
  const intent = detectIntent(prompt, knownApps);
  const explicitComparison = /\b(compare|comparison|versus|vs\.?|against|between|trend|over time|comparar|comparación|comparacion|contra|entre|tendencia|a través del tiempo)\b/.test(q);
  const strategicSynthesis = /\b(strategy|strategic|plan|optimi[sz]e|trade-?off|why|estrategia|planificar|optimizar|compensación|compensacion|por qué|porque)\b/.test(q);
  const analysisIntent = intent === "PATTERN" || intent === "INSIGHT" || intent === "COACHING";
  // Mobility and planning synthesis is evidence-bounded but multi-dimensional
  // (pickup earnings, acceptance context, local windows, sample caveats), so it
  // always uses the existing Terra-medium path.
  const useTerra = isMobilityQuestion(prompt) || explicitComparison || (analysisIntent && strategicSynthesis && scope !== "RECENT");
  const config = useTerra ? AI_MODELS.terra : AI_MODELS.luna;
  return {
    model: config.id,
    reasoningEffort: config.reasoningEffort,
    route: useTerra ? "terra_complex" : "luna_default",
  };
}

function latestUserPrompt(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

export function analysisPromptForMessages(messages: ChatMessage[]): string {
  const latestIndex = [...messages].map((message, index) => ({ message, index })).reverse().find(({ message }) => message.role === "user")?.index;
  if (latestIndex === undefined) return "";
  const latest = messages[latestIndex]?.content ?? "";
  const isFollowUp = /\b(same criterion|same criteria|same approach|mismo criterio|en orden|in order|top\s+\d+|ranking)\b/i.test(latest);
  if (!isFollowUp) return latest;
  const previous = [...messages.slice(0, latestIndex)].reverse().find((message) => message.role === "user")?.content;
  return previous ? `${previous}\n${latest}` : latest;
}

function readUsage(value: unknown): TokenUsage {
  const usage = value as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | null;

  const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
  const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? null;
  const totalTokens = usage?.total_tokens ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);

  return { inputTokens, outputTokens, totalTokens };
}

async function logUsage(args: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  model?: string;
  scope: DataScope;
  promptPreview: string;
  status: "success" | "error";
  errorType?: string;
  usage?: TokenUsage;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  usedStreaming: boolean;
  metadata?: Record<string, unknown>;
}) {
  const inputTokens = args.usage?.inputTokens ?? null;
  const outputTokens = args.usage?.outputTokens ?? null;
  const totalTokens = args.usage?.totalTokens ?? null;
  const estimatedTotalTokens = args.estimatedInputTokens + args.estimatedOutputTokens;
  const costInput = inputTokens ?? args.estimatedInputTokens;
  const costOutput = outputTokens ?? args.estimatedOutputTokens;

  const { error } = await args.supabase.from("ai_usage_logs").insert({
    user_id: args.userId,
    model: args.model ?? "not_invoked",
    scope: args.scope,
    prompt_preview: args.promptPreview.slice(0, 300),
    status: args.status,
    error_type: args.errorType ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_input_tokens: args.estimatedInputTokens,
    estimated_output_tokens: args.estimatedOutputTokens,
    estimated_total_tokens: estimatedTotalTokens,
    estimated_cost_usd: args.estimatedCostUsd ?? estimateCost(costInput, costOutput, args.model ?? "not_invoked"),
    latency_ms: args.latencyMs,
    used_streaming: args.usedStreaming,
    metadata: args.metadata ?? {},
  });

  if (error) {
    console.error("AI usage log failed", error);
  }
}

export function isBestWeekQuestion(prompt: string): boolean {
  const q = prompt.toLowerCase();
  const asksBestWeek = /\b(best|highest|biggest|top|record)\b/.test(q) &&
    /\bweek\b/.test(q) &&
    !/\bapp\b/.test(q);
  // A mention of a best week can be evidence inside a larger comparison.
  // Do not collapse those prompts into the single-best-week shortcut.
  const asksComparison = /\b(compare|comparison|versus|vs\.?|against|between|trend|period|last\s+\d+|comparar|comparación|comparacion|contra|entre|tendencia|periodo|últimas?\s+\d+)\b/.test(q);
  return asksBestWeek && !asksComparison;
}

function directBestWeekAnswer(context: unknown, currency: string): string | null {
  const c = context as {
    lifetime?: {
      bestWeekEver?: {
        startDate: string;
        endDate?: string;
        total: number;
        status?: string;
      } | null;
    };
  };
  const best = c.lifetime?.bestWeekEver;
  if (!best) return null;

  const amount = formatCurrencyForAssistant(best.total, currency);
  const range = best.endDate ? `${best.startDate} to ${best.endDate}` : best.startDate;
  const statusNote = best.status && best.status !== "closed" ? ` It is currently marked as ${best.status}.` : "";
  return `Your best week ever was ${range}, when you earned ${amount}.${statusNote}`;
}

export function directMobilityAnswer(context: unknown, currency: string, prompt: string): string | null {
  const c = context as {
    lifetime?: {
      weekdayStats?: Record<string, { average: number; count: number; best: number; bestDate: string | null }>;
    };
    analysis?: {
      mobility?: {
        pickupEarnings?: {
          zones?: Array<{ zone: string; earnings: number; rides: number; days: number; rideHours: number; earningsPerRideHour: number | null; confidence?: string }>;
          bestTwoHourPickupWindows?: Array<{ weekday: string; startHour: number; endHourExclusive: number; earnings: number; rides: number; days: number; rideHours: number; averageWindowEarningsPerHour: number | null; earningsPerRideHour: number | null; confidence?: string }>;
          hourRateDefinition?: string;
        };
      };
      weekdayEfficiency?: { rows: Array<{ weekday: string; earnings: number; hours: number; shifts: number; days: number; earningsPerHour: number | null }>; timingEvidence?: string };
    };
  };
  const q = prompt.toLowerCase();
  const spanish = usesSpanish(prompt);
  const mobility = c.analysis?.mobility;
  const pickupEarnings = mobility?.pickupEarnings;

  const asksTwoHours = /\b(two|2|dos)\b/.test(q) && /\b(hour|hours|hora|horas)\b/.test(q) && /\b(best|top|strongest|which|mejor|mejores|cuál|cual|cuáles|cuales)\b/.test(q);
  if (asksTwoHours) {
    const windows = pickupEarnings?.bestTwoHourPickupWindows ?? [];
    if (!windows.length) {
      return spanish
        ? "Todavía no hay suficientes rides con hora local de pickup para identificar tus dos mejores horas. Los rides nuevos que cierres con GPS y zona horaria irán construyendo esta señal."
        : "There are not enough rides with a local pickup time yet to identify your best two hours. New rides closed with GPS and a time zone will build this signal.";
    }
    const top = windows.slice(0, 3);
    const lines = top.map((window, index) => {
      const rate = window.averageWindowEarningsPerHour === null ? "n/a" : `${formatCurrencyForAssistant(window.averageWindowEarningsPerHour, currency)}/clock-hour`;
      return `${index + 1}. ${window.weekday} ${String(window.startHour).padStart(2, "0")}:00–${String(window.endHourExclusive).padStart(2, "0")}:00 — ${rate}, ${window.rides} ride${window.rides === 1 ? "" : "s"} across ${window.days} day${window.days === 1 ? "" : "s"} (${window.confidence ?? "low"} confidence)`;
    });
    return spanish
      ? `Tus mejores ventanas de dos horas por ganancia promedio de la ventana son:\n\n${lines.join("\n")}\n\nLa tasa usa las ganancias confirmadas de pickup observadas en esa ventana, promediadas por día y divididas por dos horas. No es el $/hora total del turno.`
      : `Your best two-hour windows by average window earnings are:\n\n${lines.join("\n")}\n\nThe rate uses confirmed pickup earnings observed in that window, averaged per day and divided by two hours. It is not total shift $/hr.`;
  }

  const asksZoneHourly = /\b(zone|zones|pickup|zona|zonas|recogida)\b/.test(q) && /\b(per hour|hourly|por hora|hora)\b/.test(q);
  if (asksZoneHourly) {
    const rows = (pickupEarnings?.zones ?? []).filter((row) => row.earningsPerRideHour !== null);
    if (!rows.length) {
      return spanish
        ? "Todavía no puedo calcular $/hora por zona: faltan rides con duración válida de Start a Finish y ganancias asignadas al pickup. Sí puedo mostrar ganancias por ride por zona."
        : "I cannot calculate $/hr by zone yet: I need completed rides with a valid Start-to-Finish duration and pickup-linked earnings. I can still show earnings per ride by zone.";
    }
    const top = [...rows].sort((a, b) => (b.earningsPerRideHour ?? 0) - (a.earningsPerRideHour ?? 0)).slice(0, 6);
    const lines = top.map((row) => `${row.zone}: ${formatCurrencyForAssistant(row.earningsPerRideHour!, currency)}/ride-hour (${row.rides} ride${row.rides === 1 ? "" : "s"}, ${row.days} day${row.days === 1 ? "" : "s"}; ${row.confidence ?? "low"} confidence)`);
    return spanish
      ? `Eficiencia por zona de pickup (ganancia confirmada ÷ tiempo del ride):\n\n${lines.join("\n")}\n\nNo incluye tiempo idle entre rides, por eso no reemplaza el $/hora del turno.`
      : `Pickup-zone efficiency (confirmed earnings ÷ ride time):\n\n${lines.join("\n")}\n\nIdle time between rides is not included, so this does not replace shift $/hr.`;
  }

  const weekday = c.analysis?.weekdayEfficiency;
  const asksTopWeekdayRanking = /\b(top|ranking|orden|mejores?)\b/.test(q) && /\b(7|siete)\b/.test(q);
  if (asksTopWeekdayRanking && weekday && !weekday.rows.length) {
    return spanish
      ? "Todavía no hay suficientes días con evidencia horaria confiable para construir un top 7 por $/hora."
      : "There are not enough days with reliable timing evidence to build a top-seven $/hr ranking yet.";
  }
  if (asksTopWeekdayRanking && weekday?.rows?.length) {
    const lines = weekday.rows.slice(0, 7).map((row, index) => `${index + 1}. ${row.weekday}: ${formatCurrencyForAssistant(row.earningsPerHour!, currency)}/hora (${row.shifts} turnos, ${row.days} días con evidencia)`);
    return spanish
      ? `Top ${Math.min(7, weekday.rows.length)} de días por ganancias operativas por hora de turno:\n\n${lines.join("\n")}\n\nSolo se incluyen días con rides medidos o snapshots positivos separados por al menos 30 minutos; los días antiguos sin evidencia quedan fuera.`
      : `Top ${Math.min(7, weekday.rows.length)} weekdays by operational earnings per shift hour:\n\n${lines.join("\n")}\n\nOnly days with measured rides or positive snapshots at least 30 minutes apart are included; older days without evidence are excluded.`;
  }
  const asksBestWeekdayHourly = /\b(best|strongest|highest|mejor|más alto|mas alto)\b/.test(q) && /\b(day|weekday|día|dia)\b/.test(q);
  const asksTotalDay = /\b(total|totales|total earnings|ganancias totales|ganancia total|por día|por dia|per day)\b/.test(q);
  if (asksBestWeekdayHourly && asksTotalDay) {
    const totalRows = Object.entries(c.lifetime?.weekdayStats ?? {})
      .filter(([, row]) => row.count > 0)
      .sort(([, a], [, b]) => b.average - a.average);
    const totalBest = totalRows[0];
    const hourlyBest = weekday?.rows?.[0];
    const totalText = totalBest
      ? (spanish
        ? `Mejor día por ganancias totales promedio: ${totalBest[0]}, ${formatCurrencyForAssistant(totalBest[1].average, currency)}/día.`
        : `Best weekday by average total earnings: ${totalBest[0]}, ${formatCurrencyForAssistant(totalBest[1].average, currency)}/day.`)
      : (spanish ? "No hay suficientes datos para el promedio total por día." : "There is not enough data for an average total by day.");
    const hourlyText = hourlyBest
      ? (spanish
        ? `Mejor día por ganancias operativas por hora de turno: ${hourlyBest.weekday}, ${formatCurrencyForAssistant(hourlyBest.earningsPerHour!, currency)}/hora (${hourlyBest.shifts} turnos, ${hourlyBest.days} días con evidencia horaria).`
        : `Best weekday by operational earnings per shift hour: ${hourlyBest.weekday}, ${formatCurrencyForAssistant(hourlyBest.earningsPerHour!, currency)}/hr (${hourlyBest.shifts} shifts, ${hourlyBest.days} days with timing evidence).`)
      : (spanish
        ? "Todavía no hay suficientes días con evidencia horaria confiable para calcular el mejor día por $/hora de turno; los días antiguos sin esa evidencia quedan fuera."
        : "There are not enough days with reliable timing evidence to calculate the best weekday by shift $/hr; older days without that evidence are excluded.");
    return `${totalText}\n${hourlyText}`;
  }
  if (asksBestWeekdayHourly && weekday && !weekday.rows.length) {
    return spanish
        ? "Todavía no hay suficientes días con evidencia horaria confiable para comparar el mejor día por $/hora. Los días antiguos sin snapshots separados por al menos 30 minutos ni rides con Start→Finish quedan fuera de esta métrica."
        : "There are not enough days with reliable timing evidence to compare the best weekday by $/hr. Older days without snapshots at least 30 minutes apart or Start-to-Finish rides are excluded from this metric.";
  }
  if (weekday?.rows?.length && asksBestWeekdayHourly) {
    const top = weekday.rows[0];
    return spanish
      ? `Tu mejor día por ganancia operativa por hora de turno es ${top.weekday}: ${formatCurrencyForAssistant(top.earningsPerHour!, currency)}/hora, basado en ${top.shifts} turnos completados (${top.hours.toFixed(1)} h) en ${top.days} días con evidencia horaria. Los días antiguos sin esa evidencia no entran en la comparación.`
      : `Your best weekday by operational earnings per shift hour is ${top.weekday}: ${formatCurrencyForAssistant(top.earningsPerHour!, currency)}/hr, based on ${top.shifts} completed shifts (${top.hours.toFixed(1)}h) across ${top.days} days with timing evidence. Older days without that evidence are excluded.`;
  }

  return null;
}

function directIntentAnswer(context: unknown, currency: string, prompt: string): string | null {
  const c = context as {
    lifetime?: {
      averageClosedWeek?: number;
      appTotals?: Record<string, number>;
      weekdayStats?: Record<string, { average: number; count: number; best: number; bestDate: string | null }>;
      evolution?: { from: string; to: string; weeks: number; averageWeek: number }[];
      operations?: ShiftStats;
      bestWeekByHours?: NormalizedWeek | null;
      bestWeekByEfficiency?: NormalizedWeek | null;
    };
    recent?: {
      operations?: ShiftStats;
    };
    analysis?: {
      intent?: AskIntent;
      monthRanking?: ReturnType<typeof monthRankingAnalysis>;
      earningStreak?: ReturnType<typeof highestEarningStreakAnalysis>;
      currentWeek?: ReturnType<typeof currentWeekSnapshot>;
      weekendTrend?: ReturnType<typeof weekendTrendAnalysis>;
    };
  };
  const intent = c.analysis?.intent ?? detectIntent(prompt);
  const q = prompt.toLowerCase();
  const spanish = usesSpanish(prompt);

  if (intent === "HOUR") {
    const current = c.analysis?.currentWeek;
    const asksBestEarningHour = /\b(best|strongest|highest|top).*(earning )?hour\b|\b(best|strongest|highest|top) hour\b/.test(q);
    if (!asksBestEarningHour) {
      if (/\b(this week|current week|week)\b/.test(q) && current?.week.shiftStats) {
        const stats = current.week.shiftStats;
        return [
          `This week you've logged **${stats.totalHours.toFixed(1)}h** across ${stats.completedShifts} completed shift${stats.completedShifts === 1 ? "" : "s"}.`,
          stats.earningsPerHour !== null ? `Weekly efficiency: ${formatCurrencyForAssistant(stats.earningsPerHour, currency)}/hr.` : "I need completed shift duration before calculating weekly $/hr.",
          stats.totalRides > 0 ? `Rides tracked: ${stats.totalRides}.` : "Ride count is optional, so it only appears when you enter it.",
        ].join("\n");
      }
      if (/\b(lifetime|career|all time|all-time|history|historical|average per hour)\b/.test(q) && c.lifetime?.operations) {
        const stats = c.lifetime.operations;
        return [
          `Your lifetime tracked shift time is **${stats.totalHours.toFixed(1)}h** across ${stats.completedShifts} completed shift${stats.completedShifts === 1 ? "" : "s"}.`,
          stats.earningsPerHour !== null ? `Lifetime average: ${formatCurrencyForAssistant(stats.earningsPerHour, currency)}/hr.` : "I need completed shift duration before calculating lifetime $/hr.",
          stats.totalRides > 0 ? `Lifetime rides tracked: ${stats.totalRides}.` : "Ride count is optional and only appears where you have entered it.",
        ].join("\n");
      }
      const bestEfficiencyWeek = c.lifetime?.bestWeekByEfficiency;
      if (
        /\b(best hourly week|best.*hourly|best.*efficiency|highest.*per hour)\b/.test(q) &&
        bestEfficiencyWeek?.shiftStats.earningsPerHour !== null &&
        bestEfficiencyWeek?.shiftStats.earningsPerHour !== undefined
      ) {
        const week = bestEfficiencyWeek;
        return `Your best efficiency week was ${week.startDate} to ${week.endDate}: ${formatCurrencyForAssistant(week.shiftStats.earningsPerHour!, currency)}/hr across ${week.shiftStats.totalHours.toFixed(1)}h.`;
      }
    }
    return spanish
      ? "Todavía no puedo calcular tu mejor hora real de ganancias porque Streex no guarda cada ride con timestamp. Sí puedo analizar horas trabajadas, shifts, rides capturados y $/hr cuando los turnos están registrados."
      : "I can't calculate your real best earning hour yet because Streex does not store each ride with a timestamp. I can analyze worked hours, tracked shifts, ride counts, and $/hr when shifts are logged.";
  }

  if (intent === "RIVAL") {
    return spanish
      ? "Todavía no tengo una capa determinística para comparar versiones de ti como rivales. Puedo comparar periodos concretos, por ejemplo: 'compárame contra mis últimas 4 semanas' o 'compárame contra mi mejor periodo'."
      : "I don't have a deterministic rival/version-of-you comparison layer yet. I can compare specific periods, for example: 'compare me against my last 4 weeks' or 'compare me against my best period'.";
  }

  if (intent === "MONTH") {
    const ranking = c.analysis?.monthRanking;
    if (!ranking?.strongest) return null;
    if (/\b(strongest|best|highest|most|mejor|más fuerte|mas fuerte)\b/.test(q)) {
      const topLines = ranking.top
        .map((month, index) => `${index + 1}. ${month.period}: ${formatCurrencyForAssistant(month.total, currency)}`)
        .join("\n");
      return `Your strongest month was **${ranking.strongest.period}** with ${formatCurrencyForAssistant(ranking.strongest.total, currency)}.\n\nTop months:\n${topLines}`;
    }
  }

  if (intent === "STREAK") {
    const streak = c.analysis?.earningStreak?.highestByTotal;
    if (!streak) {
      return "I don't see enough consecutive active days yet to calculate an earning streak.";
    }
    return [
      `Your highest earning streak was **${streak.days} consecutive active days**, from ${formatDateForAssistant(streak.startDate)} to ${formatDateForAssistant(streak.endDate)}.`,
      "",
      `Total: ${formatCurrencyForAssistant(streak.total, currency)}`,
      `Average per active day: ${formatCurrencyForAssistant(streak.averageDay, currency)}`,
      "",
      "I’m treating an earning streak as consecutive days with tracked earnings, then ranking those streaks by total earnings.",
    ].join("\n");
  }

  if (intent === "GOAL") {
    const current = c.analysis?.currentWeek;
    if (!current) return null;
    const left = formatCurrencyForAssistant(current.goalLeft, currency);
    const needed = formatCurrencyForAssistant(current.neededPerRemainingDay, currency);
    const dayLabel = current.focusDay ? `${current.focusDay.day}, ${current.focusDay.date}` : "the current tracked day";
    return [
      `Your current week total is ${formatCurrencyForAssistant(current.week.total, currency)} against a ${formatCurrencyForAssistant(current.week.goal, currency)} goal.`,
      "",
      `You have ${left} left.`,
      `From ${dayLabel} through the end of the tracked week, that is about **${needed} per day** across ${current.remainingDays} day${current.remainingDays === 1 ? "" : "s"}.`,
    ].join("\n");
  }

  if (intent === "RANKING") {
    const current = c.analysis?.currentWeek;
    if (!current?.focusDay) return null;
    if (/\btoday rank|rank today|where does today rank|ranking.*today\b/.test(q)) {
      if (!current.todayRank) return "Today does not have tracked earnings yet, so I cannot rank it against your earning days.";
      return `${current.focusDay.day}, ${current.focusDay.date} is currently ranked **#${current.todayRank.rank} of ${current.todayRank.outOf}** earning days in your Streex history, with ${formatCurrencyForAssistant(current.focusDay.total, currency)}.`;
    }
    if (/\bclosest record|record.*closest|closest.*record\b/.test(q) && current.recordChase) {
      const same = current.recordChase.bestSameWeekday;
      const best = current.recordChase.bestDayEver;
      const sameGap = current.recordChase.gapToBestSameWeekday;
      const bestGap = current.recordChase.gapToBestDayEver;
      const options = [
        same && sameGap !== null && sameGap >= 0 ? `same-weekday record (${same.day}): ${formatCurrencyForAssistant(sameGap, currency)} away from ${formatCurrencyForAssistant(same.total, currency)}` : null,
        best && bestGap !== null && bestGap >= 0 ? `all-time daily record: ${formatCurrencyForAssistant(bestGap, currency)} away from ${formatCurrencyForAssistant(best.total, currency)}` : null,
      ].filter(Boolean);
      if (!options.length) return null;
      return `The closest visible record from today’s tracked total is:\n\n- ${options.join("\n- ")}`;
    }
  }

  if (c.analysis?.weekendTrend && /\bweekend|weekends|saturday|sunday|sábado|sabado|domingo\b/i.test(prompt)) {
    const trend = c.analysis.weekendTrend;
    return [
      `Your combined Saturday + Sunday trend is **${trend.direction}** right now.`,
      "",
      `Recent weekend average: ${formatCurrencyForAssistant(trend.recentAverage, currency)}`,
      `Prior weekend average: ${formatCurrencyForAssistant(trend.priorAverage, currency)}`,
      `Change: ${formatCurrencyForAssistant(trend.change, currency)}`,
      trend.bestWeekend ? `Best weekend: ${trend.bestWeekend.startDate} to ${trend.bestWeekend.endDate}, ${formatCurrencyForAssistant(trend.bestWeekend.total, currency)}` : "",
    ].filter(Boolean).join("\n");
  }

  if (intent === "INSIGHT" || intent === "PATTERN" || intent === "COACHING") {
    const evolution = c.lifetime?.evolution ?? [];
    const weekdayStats = c.lifetime?.weekdayStats ?? {};
    const appTotals = c.lifetime?.appTotals ?? {};
    const strongestDay = Object.entries(weekdayStats)
      .sort(([, a], [, b]) => b.average - a.average)[0];
    const weakestDay = Object.entries(weekdayStats)
      .sort(([, a], [, b]) => a.average - b.average)[0];
    const topApp = Object.entries(appTotals).sort(([, a], [, b]) => b - a)[0];
    const latestBucket = evolution[evolution.length - 1];
    const peakBucket = [...evolution].sort((a, b) => b.averageWeek - a.averageWeek)[0];
    if (!strongestDay && !topApp && !peakBucket) return null;

    if (intent === "COACHING") {
      return [
        "Insight:",
        peakBucket && latestBucket
          ? `Your best period averaged ${formatCurrencyForAssistant(peakBucket.averageWeek, currency)} per week, while your latest period averages ${formatCurrencyForAssistant(latestBucket.averageWeek, currency)}.`
          : `Your historical average week is ${formatCurrencyForAssistant(c.lifetime?.averageClosedWeek ?? 0, currency)}.`,
        "",
        "Evidence:",
        strongestDay ? `${strongestDay[0]} is your strongest weekday at ${formatCurrencyForAssistant(strongestDay[1].average, currency)} on average.` : "Your weekday mix is the clearest signal available.",
        "",
        "Opportunity:",
        strongestDay && weakestDay
          ? `Protect ${strongestDay[0]} and be more selective with ${weakestDay[0]}. That is the cleanest schedule lever in your data.`
          : "Focus on recreating the conditions from your peak earning period.",
      ].join("\n");
    }

    return [
      "Insight:",
      strongestDay && weakestDay
        ? `${strongestDay[0]} earns ${formatCurrencyForAssistant(strongestDay[1].average - weakestDay[1].average, currency)} more than ${weakestDay[0]} on an average active day.`
        : topApp
        ? `${topApp[0]} is your largest app contributor.`
        : `Your peak period averaged ${formatCurrencyForAssistant(peakBucket.averageWeek, currency)} per week.`,
      "",
      "Evidence:",
      strongestDay && weakestDay
        ? `${strongestDay[0]} averages ${formatCurrencyForAssistant(strongestDay[1].average, currency)}; ${weakestDay[0]} averages ${formatCurrencyForAssistant(weakestDay[1].average, currency)}.`
        : peakBucket
        ? `${peakBucket.from} to ${peakBucket.to} was your strongest period.`
        : "This comes from your full Streex history.",
      "",
      "Opportunity:",
      strongestDay
        ? `Build around ${strongestDay[0]} first, then use weaker days more intentionally for recovery or lighter work.`
        : "Look for what made your strongest period different and try to repeat that pattern.",
    ].join("\n");
  }

  return null;
}

function formatDateForAssistant(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function usesSpanish(prompt: string): boolean {
  return /[áéíóúñ¿¡]/i.test(prompt) ||
    /\b(si|quiero|descansar|dias|días|semana|cuáles|cuales|deberían|deberian|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|lunes)\b/i.test(prompt);
}

function localizedDay(day: string, spanish: boolean): string {
  if (!spanish) return day;
  const labels: Record<string, string> = {
    Monday: "lunes",
    Tuesday: "martes",
    Wednesday: "miércoles",
    Thursday: "jueves",
    Friday: "viernes",
    Saturday: "sábado",
    Sunday: "domingo",
  };
  return labels[day] ?? day;
}

export function directDayAnalysisAnswer(context: unknown, currency: string, prompt = ""): string | null {
  const c = context as {
    scope?: DataScope;
    coverage?: { isFullHistoryLoaded?: boolean };
    analysis?: {
      consecutiveDayOff?: {
        mode?: "take_off" | "protect";
        pairs: {
          days: string[];
          combinedAverage: number;
          averages: { day: string; average: number; count: number }[];
          minimumSampleSize: number;
        }[];
        recommendation: {
          days: string[];
          combinedAverage: number;
          averages: { day: string; average: number; count: number }[];
          minimumSampleSize: number;
        } | null;
        lowSampleSize?: boolean;
        sampleSizeFloor?: number;
      };
      weekdayList?: {
        weekday: string;
        totalMatches: number;
        returned: number;
        limited: boolean;
        days: { date: string; day: string; total: number }[];
      };
      dayRanking?: {
        kind: "worst_days" | "best_days";
        weekdayFilter: string[] | null;
        includeZeroDays: boolean;
        totalCandidates: number;
        returned: number;
        limited: boolean;
        days: { date: string; day: string; total: number }[];
      };
    };
  };
  const scopeText = c.coverage?.isFullHistoryLoaded
    ? "across your full Streex history"
    : c.scope === "RECENT"
    ? "within the requested recent scope"
    : "within the loaded scope";

  const consecutiveDayOff = c.analysis?.consecutiveDayOff;
  if (consecutiveDayOff) {
    const best = consecutiveDayOff.recommendation;
    if (!best) {
      return usesSpanish(prompt)
        ? "Todavía no tengo suficientes promedios por día para recomendar dos días consecutivos con confianza."
        : "I don't have enough weekday averages yet to recommend two consecutive days off confidently.";
    }

    const spanish = usesSpanish(prompt);
    const protectMode = consecutiveDayOff.mode === "protect";
    const pairLines = consecutiveDayOff.pairs.map((pair) => {
      const label = pair.days.map((day) => localizedDay(day, spanish)).join(spanish ? " + " : " + ");
      return `- ${label}: ${formatCurrencyForAssistant(pair.combinedAverage, currency)}`;
    });
    const bestDays = best.days.map((day) => localizedDay(day, spanish));
    const first = best.averages[0];
    const second = best.averages[1];
    const weaker = first.average <= second.average ? first : second;
    const other = first.average <= second.average ? second : first;
    const sampleSizeNote = consecutiveDayOff.lowSampleSize
      ? spanish
        ? `Nota: esta recomendación es direccional porque uno de los días tiene menos de ${consecutiveDayOff.sampleSizeFloor ?? SAMPLE_SIZE_FLOOR} muestras históricas.`
        : `Note: this recommendation is directional because one weekday has fewer than ${consecutiveDayOff.sampleSizeFloor ?? SAMPLE_SIZE_FLOOR} historical samples.`
      : null;
    if (spanish) {
      if (protectMode) {
        return [
          `Si tu objetivo es proteger tus mejores ventanas, los dos días consecutivos que **menos conviene descansar** son **${bestDays[0]} + ${bestDays[1]}**.`,
          "",
          `Esa pareja suma ${formatCurrencyForAssistant(best.combinedAverage, currency)} de promedio combinado (${localizedDay(first.day, true)} ${formatCurrencyForAssistant(first.average, currency)} + ${localizedDay(second.day, true)} ${formatCurrencyForAssistant(second.average, currency)}).`,
          "",
          "Comparé todas las parejas consecutivas válidas:",
          ...pairLines,
          "",
          "Es la combinación con mayor impacto potencial en tus ganancias si la tomaras libre.",
          ...(sampleSizeNote ? ["", sampleSizeNote] : []),
        ].join("\n");
      }

      return [
        `Para dos días seguidos de descanso, la mejor combinación por menor impacto promedio es **${bestDays[0]} + ${bestDays[1]}**.`,
        "",
        `Esa pareja suma ${formatCurrencyForAssistant(best.combinedAverage, currency)} de promedio combinado (${localizedDay(first.day, true)} ${formatCurrencyForAssistant(first.average, currency)} + ${localizedDay(second.day, true)} ${formatCurrencyForAssistant(second.average, currency)}).`,
        "",
        "Comparé todas las parejas consecutivas válidas:",
        ...pairLines,
        "",
        `${localizedDay(weaker.day, true)} es el día individual más débil dentro de esta pareja, y aunque ${localizedDay(other.day, true)} no necesariamente sea tu segundo día más débil, juntos producen el menor impacto combinado.`,
        ...(sampleSizeNote ? ["", sampleSizeNote] : []),
      ].join("\n");
    }

    if (protectMode) {
      return [
        `If your goal is to protect your strongest windows, the two consecutive days you should **avoid taking off** are **${bestDays[0]} + ${bestDays[1]}**.`,
        "",
        `That pair combines for ${formatCurrencyForAssistant(best.combinedAverage, currency)} on average (${first.day} ${formatCurrencyForAssistant(first.average, currency)} + ${second.day} ${formatCurrencyForAssistant(second.average, currency)}).`,
        "",
        "I compared every valid consecutive pair:",
        ...pairLines,
        "",
        "It is the highest combined-impact pair in your history.",
        ...(sampleSizeNote ? ["", sampleSizeNote] : []),
      ].join("\n");
    }

    return [
      `For two consecutive days off, the lowest average earnings impact is **${bestDays[0]} + ${bestDays[1]}**.`,
      "",
      `That pair combines for ${formatCurrencyForAssistant(best.combinedAverage, currency)} on average (${first.day} ${formatCurrencyForAssistant(first.average, currency)} + ${second.day} ${formatCurrencyForAssistant(second.average, currency)}).`,
      "",
      "I compared every valid consecutive pair:",
      ...pairLines,
      "",
      `${weaker.day} is the weaker individual day in this pair, and while ${other.day} may not be your second weakest day, the combination produces the lowest combined impact.`,
      ...(sampleSizeNote ? ["", sampleSizeNote] : []),
    ].join("\n");
  }

  const weekdayList = c.analysis?.weekdayList;
  if (weekdayList) {
    if (!weekdayList.days.length) return `I don't see any ${weekdayList.weekday}s in your tracked history yet.`;
    const lines = weekdayList.days.map((day) =>
      `- ${formatCurrencyForAssistant(day.total, currency)} on ${formatDateForAssistant(day.date)}`
    );
    const cap = weekdayList.limited
      ? ` Showing the most recent ${weekdayList.returned} to keep the answer readable.`
      : "";
    return `Here are your ${weekdayList.totalMatches} tracked ${weekdayList.weekday}s ${scopeText}:${cap}\n\n${lines.join("\n")}`;
  }

  const ranking = c.analysis?.dayRanking;
  if (ranking) {
    if (!ranking.days.length) return "I don't see matching tracked days for that ranking yet.";
    const label = ranking.kind === "worst_days" ? "lowest earning days" : "highest earning days";
    const filter = ranking.weekdayFilter?.length ? ` for ${ranking.weekdayFilter.join(", ")}` : "";
    const zeroNote = ranking.kind === "worst_days" && ranking.includeZeroDays
      ? " Zero-dollar tracked days are included."
      : "";
    const lines = ranking.days.map((day, index) =>
      `${index + 1}. ${formatCurrencyForAssistant(day.total, currency)} on ${formatDateForAssistant(day.date)}`
    );
    const cap = ranking.limited
      ? ` Showing ${ranking.returned} of ${ranking.totalCandidates} matching days.`
      : "";
    return `Here are your ${ranking.returned} ${label}${filter} ${scopeText}.${zeroNote}${cap}\n\n${lines.join("\n")}`;
  }

  return null;
}

function formatCurrencyForAssistant(value: number, currency: string): string {
  const raw = (currency || "$").trim().toUpperCase();
  const code = ["USD", "EUR", "GBP", "CAD", "MXN", "COP", "ARS"].includes(raw)
    ? raw
    : currency === "€"
    ? "EUR"
    : currency === "£"
    ? "GBP"
    : "USD";

  if (code === "COP" || code === "ARS") {
    return `${code} ${value.toLocaleString(code === "COP" ? "es-CO" : "es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  return new Intl.NumberFormat(
    code === "EUR" ? "de-DE" : code === "GBP" ? "en-GB" : code === "CAD" ? "en-CA" : code === "MXN" ? "es-MX" : "en-US",
    {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(value);
}

function streamWithUsageLogging(args: {
  body: ReadableStream<Uint8Array>;
  supabase: ReturnType<typeof createClient>;
  userId: string;
  model: AiModelId;
  scope: DataScope;
  promptPreview: string;
  estimatedInputTokens: number;
  startedAt: number;
  metadata: Record<string, unknown>;
}) {
  const reader = args.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let usage: TokenUsage | undefined;

  function inspectText(text: string) {
    buffer += text;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content ??
            parsed?.choices?.[0]?.message?.content ??
            parsed?.text ??
            "";
          if (typeof delta === "string") outputText += delta;
          if (parsed?.usage) usage = readUsage(parsed.usage);
        } catch {
          // Ignore malformed stream frames; the client still receives them unchanged.
        }
      }
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) inspectText("\n\n");
        const estimatedOutputTokens = estimateTokens(outputText || " ");
        await logUsage({
          supabase: args.supabase,
          userId: args.userId,
          model: args.model,
          scope: args.scope,
          promptPreview: args.promptPreview,
          status: "success",
          usage,
          estimatedInputTokens: args.estimatedInputTokens,
          estimatedOutputTokens,
          latencyMs: Date.now() - args.startedAt,
          usedStreaming: true,
          metadata: {
            ...args.metadata,
            hasActualTokenUsage: Boolean(usage?.totalTokens),
          },
        });
        controller.close();
        return;
      }

      inspectText(decoder.decode(value, { stream: true }));
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await logUsage({
        supabase: args.supabase,
        userId: args.userId,
        model: args.model,
        scope: args.scope,
        promptPreview: args.promptPreview,
        status: "error",
        errorType: "client_cancelled",
        estimatedInputTokens: args.estimatedInputTokens,
        estimatedOutputTokens: estimateTokens(outputText || " "),
        latencyMs: Date.now() - args.startedAt,
        usedStreaming: true,
        metadata: args.metadata,
      });
    },
  });
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!OPENAI_API_KEY) {
    return json({ error: "AI is not configured. Missing OPENAI_API_KEY." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Missing authentication. Please sign in again." }, 401);
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "No messages provided." }, 400);

  const safeMessages = messages.slice(-20).map((m) => ({
    role: m.role,
    content: String(m.content ?? "").slice(0, 4000),
  }));
  const promptPreview = latestUserPrompt(safeMessages);
  const analysisPrompt = analysisPromptForMessages(safeMessages);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return json({ error: "Authentication issue. Please sign in again." }, 401);
  }
  const userId = userRes.user.id;

  // Settings first so we know the user's app list for app-vs-app detection.
  const settingsRes = await supabase.from("user_settings")
    .select("default_weekly_goal,currency_symbol,active_apps")
    .maybeSingle();
  const knownApps = Array.isArray(settingsRes.data?.active_apps)
    ? (settingsRes.data!.active_apps as string[])
    : [];
  const scopeResult = detectScope(safeMessages, knownApps);
  amdDebug("scope", { scope: scopeResult.scope, reason: scopeResult.reason });
  const needsMobility = isMobilityQuestion(promptPreview) || isMobilityQuestion(analysisPrompt);

  const [weeksRes, achRes, ridesRes, snapshotsRes, snapshotAllocationsRes, manualAllocationsRes, batchesRes, batchEventsRes, paymentsRes, zoneLabelsRes] = await Promise.all([
    fetchWeeksForScope(supabase, scopeResult.scope),
    supabase.from("user_achievements")
      .select("achievement_id,unlocked_at")
      .order("unlocked_at", { ascending: false })
      .limit(scopeResult.scope === "RECENT" ? 25 : 100),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("ride_events").select("id,day_date,app,status,started_at,ended_at,pickup_at,lifecycle_version,start_zone_key,pickup_zone_key,start_capture_status,pickup_capture_status,source,time_zone").order("started_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("earnings_snapshots").select("id,week_id,day_date,app,delta,created_at").order("created_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("earnings_snapshot_allocations").select("ride_event_id,earnings_snapshot_id,kind,amount,is_current").eq("is_current", true).order("created_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("manual_ride_allocations").select("ride_event_id,kind,amount,is_current").eq("is_current", true).order("created_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("ride_update_batches").select("id,earnings_snapshot_id,kind").order("created_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("ride_update_batch_events").select("batch_id,ride_event_id").order("batch_id", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("ride_payments").select("ride_event_id,earnings_snapshot_id").order("observed_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
    needsMobility
      ? fetchAllPages((from, to) => supabase.from("user_zone_labels").select("zone_key,label").order("updated_at", { ascending: true }).range(from, to))
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (weeksRes.error) {
    await logUsage({
      supabase,
      userId,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "data_load",
      estimatedInputTokens: estimateTokens(promptPreview || " "),
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata: {
        fetchMode: weeksRes.mode,
        rowsFetched: weeksRes.rowsFetched,
      },
    });
    return json({ error: "Could not load your data." }, 500);
  }

  if (needsMobility && (ridesRes.error || snapshotsRes.error || snapshotAllocationsRes.error || manualAllocationsRes.error || batchesRes.error || batchEventsRes.error || paymentsRes.error || zoneLabelsRes.error)) {
    await logUsage({
      supabase,
      userId,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "mobility_data_load",
      estimatedInputTokens: estimateTokens(promptPreview || " "),
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata: { fetchMode: weeksRes.mode },
    });
    return json({ error: "Could not load your zone and ride evidence. Please try again." }, 500);
  }

  const weeks = weeksRes.data;
  if (!weeks.length) {
    await logUsage({
      supabase,
      userId,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "no_data",
      estimatedInputTokens: estimateTokens(promptPreview || " "),
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata: {
        fetchMode: weeksRes.mode,
        rowsFetched: weeksRes.rowsFetched,
      },
    });
    return json({
      text:
        "I don't see any tracked weeks yet. Log a few days on the Dashboard or in Entry, and I'll be able to analyze your earnings.",
    });
  }

  const mobility = needsMobility
    ? buildMobilityAnalysis({
      rides: (ridesRes.data ?? []) as MobilityRideRow[],
      snapshots: (snapshotsRes.data ?? []) as SnapshotRow[],
      snapshotAllocations: (snapshotAllocationsRes.data ?? []) as RideAllocationRow[],
      manualAllocations: (manualAllocationsRes.data ?? []) as RideAllocationRow[],
      batches: (batchesRes.data ?? []) as RideBatchRow[],
      batchEvents: (batchEventsRes.data ?? []) as RideBatchEventRow[],
      payments: (paymentsRes.data ?? []) as RidePaymentRow[],
      zoneLabels: (zoneLabelsRes.data ?? []) as ZoneLabelRow[],
      prompt: analysisPrompt,
    })
    : null;
  const context = buildContext({
    scope: scopeResult.scope,
    scopeReason: scopeResult.reason,
    weeks,
    settings: settingsRes.data ?? null,
    achievements: achRes.data ?? [],
    mobility,
    prompt: analysisPrompt,
  });
  if (AMD_DEBUG) {
    const intent = detectIntent(promptPreview, knownApps);
    const restMode = restPairMode(promptPreview);
    amdDebug("intent", { intent, restPairMode: restMode });
    if (restMode) {
      const rest = consecutiveDayOffAnalysis(
        weeks.map(normalizeWeek).sort((a, b) => b.startDate.localeCompare(a.startDate)),
        promptPreview,
      );
      if (rest) {
        amdDebug("rest_pair", {
          mode: rest.mode,
          pairCount: rest.pairs.length,
          recommended: rest.recommendation?.days ?? null,
          minSampleSize: rest.recommendation?.minimumSampleSize ?? null,
          lowSampleSize: rest.lowSampleSize,
        });
      }
    }
  }
  const modelPlan = selectAiModel(promptPreview, scopeResult.scope, knownApps);
  const modelConfig = aiModelConfig(modelPlan.model)!;
  const metadata = {
    fetchMode: weeksRes.mode,
    weeksFetched: weeks.length,
    rowsFetched: weeksRes.rowsFetched,
    achievementsFetched: achRes.data?.length ?? 0,
    mobilityLoaded: needsMobility,
    mobilityRidesLoaded: ridesRes.data?.length ?? 0,
    hasSettings: Boolean(settingsRes.data),
    provider: "openai",
    modelRoute: modelPlan.route,
    reasoningEffort: modelPlan.reasoningEffort,
    costEstimateBasis: "OpenAI token estimate; billing is authoritative in the OpenAI project.",
    estimatedInputUsdPer1M: modelConfig.inputUsdPer1M,
    estimatedOutputUsdPer1M: modelConfig.outputUsdPer1M,
  };

  if (isBestWeekQuestion(promptPreview)) {
    const text = directBestWeekAnswer(context, settingsRes.data?.currency_symbol ?? "$");
    if (text) {
      await logUsage({
        supabase,
        userId,
        model: "deterministic",
        scope: "ALL_TIME",
        promptPreview,
        status: "success",
        estimatedInputTokens: estimateTokens(promptPreview || " "),
        estimatedOutputTokens: estimateTokens(text),
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        usedStreaming: false,
        metadata: {
          ...metadata,
          directAnswer: "best_week_ever",
        },
      });
      return json({ text });
    }
  }

  if (needsMobility) {
    const text = directMobilityAnswer(context, settingsRes.data?.currency_symbol ?? "$", analysisPrompt);
    if (text) {
      await logUsage({
        supabase,
        userId,
        model: "deterministic",
        scope: scopeResult.scope,
        promptPreview,
        status: "success",
        estimatedInputTokens: estimateTokens(promptPreview || " "),
        estimatedOutputTokens: estimateTokens(text),
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        usedStreaming: false,
        metadata: {
          ...metadata,
          directAnswer: "mobility_summary",
        },
      });
      return json({ text });
    }
  }

  if (!needsMobility) {
    const text = directIntentAnswer(context, settingsRes.data?.currency_symbol ?? "$", promptPreview);
    if (text) {
      await logUsage({
        supabase,
        userId,
        model: "deterministic",
        scope: scopeResult.scope,
        promptPreview,
        status: "success",
        estimatedInputTokens: estimateTokens(promptPreview || " "),
        estimatedOutputTokens: estimateTokens(text),
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        usedStreaming: false,
        metadata: {
          ...metadata,
          directAnswer: "intent_router",
          intent: detectIntent(promptPreview, knownApps),
        },
      });
      return json({ text });
    }
  }

  if (!needsMobility) {
    const text = directDayAnalysisAnswer(context, settingsRes.data?.currency_symbol ?? "$", promptPreview);
    if (text) {
      await logUsage({
        supabase,
        userId,
        model: "deterministic",
        scope: scopeResult.scope,
        promptPreview,
        status: "success",
        estimatedInputTokens: estimateTokens(promptPreview || " "),
        estimatedOutputTokens: estimateTokens(text),
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        usedStreaming: false,
        metadata: {
          ...metadata,
          directAnswer: "day_analysis",
        },
      });
      return json({ text });
    }
  }

  const system = [
    "You are 'Ask My Data', an analytics assistant inside Streex — a gig earnings tracker.",
    "Answer ONLY using the JSON context provided. If the required fact is not in the data, say so plainly.",
    "HONESTY RULES (highest priority):",
    "1. Never use the words 'historically', 'all time', 'ever', 'in your full history', 'lifetime', or 'in your career' unless context.coverage.isFullHistoryLoaded is true.",
    "2. If context.coverage.isFullHistoryLoaded is false and the user asked an all-time / historical / ever question, reply: 'I don't have enough historical data loaded to answer that accurately yet.' Then offer what you can answer from the recent window.",
    "3. For app-vs-app questions, ONLY use context.analysis.appHeadToHead. If that block is missing, say you don't have enough data to compare those apps. Do NOT infer winners from appTotals alone, and do NOT claim one app 'never' beat another unless aWins / bWins explicitly show 0 over weeksCompared ≥ 1.",
    "4. For grouped-day questions (e.g. Fri+Sat+Sun, weekends), ONLY use context.analysis.dayCombo. For consecutive/rolling N-day windows, ONLY use context.analysis.consecutiveWindow. For two consecutive days off / rest questions, ONLY use context.analysis.consecutiveDayOff and compare combined weekday-pair averages, not individual weekday rankings. If those blocks are missing, say the calculation isn't available for that question.",
    "5. For best/highest/record week questions, use lifetime.bestWeekEver when present, never a recent-only value.",
    "6. For single-weekday lists and best/worst day rankings, ONLY use context.analysis.weekdayList or context.analysis.dayRanking. Worst/lowest days are derivable from tracked day totals; do not claim the system cannot track them when dayRanking is present.",
    "7. Use context.analysis.intent as the routing hint. Do not answer HOUR questions with day rankings, STREAK questions with top days, or MONTH questions with weekly records.",
    "8. If a capability is not supported by the context (hourly earnings, trip locations, ride types, health/biometrics), say that cleanly and offer the closest supported Streex analysis.",
    "9. If context.scope is ALL_TIME, treat the answer as full Streex history. Do not mention a hidden 16-week or 112-day limit unless context.coverage.isFullHistoryLoaded is false.",
    "10. For a last-four-weeks versus best-four-week-period question, ONLY use context.analysis.fourWeekComparison. It contains completed calendar-consecutive weeks; if it is null, explain that there are not four consecutive completed weeks available.",
    "11. For a zone, pickup-hour, or shift-planner question, ONLY use context.analysis.mobility. Treat pickupEarnings as money confirmed to the pickup zone. Treat shiftPlanner candidates as acceptance/start-market evidence, never as pickup earnings. Do not infer a zone, local hour, or time window when coverage says it is missing.",
    "12. For pickup-zone hourly questions, use pickupEarnings.zones. earningsPerRideHour is confirmed pickup-linked earnings divided by elapsed Start-to-Finish ride time; call it ride-time efficiency and distinguish it from shift $/hour, which includes all completed shift time. For best two-hour questions, use bestTwoHourPickupWindows.averageWindowEarningsPerHour (average confirmed pickup earnings per observed day divided by the two-hour window) and report its rides/days evidence and low coverage clearly.",
    "13. For best weekday by $/hour questions, use weekdayEfficiency, which aggregates operational earnings divided by completed shift hours and includes only days with ride timing or positive earnings snapshots at least 30 minutes apart when mobility context is loaded. Do not substitute total daily earnings or ride-time efficiency; disclose that older days without timing evidence are excluded.",
    "14. For a shift plan, make it a bounded historical test plan: state the suggested broad zone and clock window only when a candidate exists; give earnings/rides/days as evidence; name the confidence level; and say it is not live demand, traffic, or a guaranteed result. If confidence is low/building, recommend collecting more rides rather than a strong conclusion.",
    "15. When making a recommendation, use this compact structure: **Signal**, **Evidence**, **Confidence**, **Next action**. Do not pretend that earnings per ride means earnings per worked hour.",
    "16. Never invent numbers, dates, or apps. Never reveal raw JSON, private zone keys, or internal field names. No SQL.",
    "Style: concise, friendly, specific. Short paragraphs and small markdown lists. Format currency according to the provided currency code/symbol. Reference dates in a human way (e.g. 'week of Mar 10').",
  ].join(" ");

  const contextMessage =
    "USER DATA CONTEXT (SUMMARIZED JSON, NOT RAW DATABASE):\n" +
    JSON.stringify(context);
  const estimatedInputTokens = estimateTokens([
    system,
    contextMessage,
    ...safeMessages.map((m) => `${m.role}: ${m.content}`),
  ].join("\n"));
  const upstream = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelPlan.model,
      reasoning_effort: modelPlan.reasoningEffort,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: system },
        { role: "system", content: contextMessage },
        ...safeMessages,
      ],
    }),
  });

  if (upstream.status === 429) {
    await logUsage({
      supabase,
      userId,
      model: modelPlan.model,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "rate_limit",
      estimatedInputTokens,
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata,
    });
    return json(
      { error: "Rate limit reached. Please wait a moment and try again." },
      429,
    );
  }
  if (upstream.status === 401 || upstream.status === 403) {
    await logUsage({
      supabase,
      userId,
      model: modelPlan.model,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "provider_auth",
      estimatedInputTokens,
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata,
    });
    return json({ error: "The assistant is temporarily unavailable." }, 502);
  }
  if (!upstream.ok) {
    // Drain body to free the connection but do NOT log it — upstream errors can
    // echo the user prompt or other content. Log only metadata.
    const errText = await upstream.text().catch(() => "");
    console.error("OpenAI API error", { status: upstream.status, bodyLength: errText.length });
    await logUsage({
      supabase,
      userId,
      model: modelPlan.model,
      scope: scopeResult.scope,
      promptPreview,
      status: "error",
      errorType: "gateway",
      estimatedInputTokens,
      estimatedOutputTokens: 0,
      latencyMs: Date.now() - startedAt,
      usedStreaming: false,
      metadata: { ...metadata, upstreamStatus: upstream.status },
    });
    return json({ error: "The assistant is temporarily unavailable." }, 502);
  }

  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (upstream.body && contentType.includes("text/event-stream")) {
    return new Response(streamWithUsageLogging({
      body: upstream.body,
      supabase,
      userId,
      model: modelPlan.model,
      scope: scopeResult.scope,
      promptPreview,
      estimatedInputTokens,
      startedAt,
      metadata,
    }), {
      status: 200,
      headers: streamHeaders("text/event-stream"),
    });
  }

  const data = await upstream.json();
  const text: string =
    data?.choices?.[0]?.message?.content ??
    "I couldn't generate a response. Please try again.";
  const usage = data?.usage ? readUsage(data.usage) : undefined;
  await logUsage({
    supabase,
    userId,
    model: modelPlan.model,
    scope: scopeResult.scope,
    promptPreview,
    status: "success",
    usage,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokens(text),
    latencyMs: Date.now() - startedAt,
    usedStreaming: false,
    metadata: {
      ...metadata,
      hasActualTokenUsage: Boolean(usage?.totalTokens),
    },
  });

  return json({ text });
});
