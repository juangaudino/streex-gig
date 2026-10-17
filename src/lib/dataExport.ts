import type { User } from "@supabase/supabase-js";
import { CURRENT_VERSION } from "@/lib/changelog";
import { buildJourneyEvents } from "@/lib/journey";
import { listMonthsWithData, getMonthSummary } from "@/lib/monthly";
import { dayTotal, weekTotal } from "@/lib/store";
import { appBonusTotal } from "@/lib/rewardIncome";
import { syncStoredLetters } from "@/lib/letterStore";
import type { AppSettings, DayEntry, WeekRecord } from "@/lib/types";
import { getDayRideCount, getOperationalDayShiftHours } from "@/lib/shiftIntelligence";

export const EXPORT_VERSION = "5.3B.2";

type AchievementExportRow = {
  id?: string;
  user_id?: string;
  achievement_id: string;
  unlocked_at: string;
};

interface BuildBackupParams {
  user: User;
  weeks: WeekRecord[];
  settings: AppSettings;
  achievements: AchievementExportRow[];
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function decimal(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function csvCell(value: string | number | boolean): string {
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function downloadTextFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function appValue(day: DayEntry, labels: string[]): number {
  return labels.reduce((sum, label) => sum + safeNumber(day.apps?.[label]) + appBonusTotal(day, label), 0);
}

function buildRecords(weeks: WeekRecord[]) {
  const weeklyRecord = weeks.reduce(
    (best, week) => {
      const total = weekTotal(week);
      return total > best.total
        ? { weekId: week.id, startDate: week.startDate, endDate: week.endDate, total }
        : best;
    },
    { weekId: null as string | null, startDate: null as string | null, endDate: null as string | null, total: 0 },
  );

  const dailyRecord = weeks
    .flatMap((week) => week.entries.map((day) => ({ weekId: week.id, day, total: dayTotal(day) })))
    .reduce(
      (best, current) =>
        current.total > best.total
          ? {
              weekId: current.weekId,
              date: current.day.date,
              dayName: current.day.dayName,
              total: current.total,
            }
          : best,
      { weekId: null as string | null, date: null as string | null, dayName: null as string | null, total: 0 },
    );

  const appRecords = new Map<string, { date: string; weekId: string; total: number }>();
  for (const week of weeks) {
    for (const day of week.entries) {
      for (const [app, amount] of Object.entries(day.apps || {})) {
        const total = safeNumber(amount) + appBonusTotal(day, app);
        const current = appRecords.get(app);
        if (!current || total > current.total) {
          appRecords.set(app, { date: day.date, weekId: week.id, total });
        }
      }
      for (const bonus of day.bonuses ?? []) {
        const current = appRecords.get(bonus.app);
        if (!current || bonus.amount > current.total) {
          appRecords.set(bonus.app, { date: day.date, weekId: week.id, total: bonus.amount });
        }
      }
    }
  }

  return {
    weeklyRecord,
    dailyRecord,
    appRecords: Object.fromEntries(appRecords),
  };
}

function buildStreaks(weeks: WeekRecord[]) {
  const today = todayStamp();
  const days = [...weeks]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .flatMap((week) => week.entries)
    .filter((day) => day.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  let current = 0;
  let longest = 0;

  for (const day of days) {
    if (dayTotal(day) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return {
    currentActiveDayStreak: current,
    longestActiveDayStreak: longest,
  };
}

export function jsonBackupFilename(): string {
  return `streex-backup-${todayStamp()}.json`;
}

export function csvExportFilename(): string {
  return `streex-earnings-${todayStamp()}.csv`;
}

export function buildJsonBackup({
  user,
  weeks,
  settings,
  achievements,
}: BuildBackupParams) {
  const monthlyRecaps = listMonthsWithData(weeks).map((key) => {
    const [year, month] = key.split("-").map(Number);
    return getMonthSummary(weeks, year, month - 1);
  });

  const weeklyLetters = syncStoredLetters(weeks, settings.currencySymbol);

  return {
    metadata: {
      exportVersion: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: CURRENT_VERSION,
      userId: user.id,
    },
    profile: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
    },
    data: {
      settings,
      weeks,
      achievements,
      weeklyLetters,
      records: buildRecords(weeks),
      streaks: buildStreaks(weeks),
      journeyEvents: buildJourneyEvents(weeks, [], settings.currencySymbol),
      monthlyRecaps,
    },
  };
}

export function buildEarningsCsv(weeks: WeekRecord[]): string {
  const appColumns = [
    { header: "Uber", labels: ["Uber"] },
    { header: "Lyft", labels: ["Lyft"] },
    { header: "Spark", labels: ["Spark", "Spark Driver"] },
    { header: "DoorDash", labels: ["DoorDash"] },
    { header: "AmazonFlex", labels: ["AmazonFlex", "Amazon Flex"] },
    { header: "Instacart", labels: ["Instacart"] },
    { header: "Shipt", labels: ["Shipt"] },
  ];
  const covered = new Set(appColumns.flatMap((column) => column.labels));
  const customApps = Array.from(
    new Set(
      weeks.flatMap((week) =>
        week.entries.flatMap((day) => [
          ...Object.keys(day.apps || {}),
          ...(day.bonuses ?? []).map((bonus) => bonus.app),
        ]),
      ),
    ),
  )
    .filter((app) => !covered.has(app))
    .sort();

  const headers = [
    "date",
    "weekStartDate",
    "dayName",
    "totalEarnings",
    ...appColumns.map((column) => column.header),
    ...customApps,
    "businessMiles",
    "workedHours",
    "dailyRides",
    "isClosed",
    "notes",
  ];

  const rows = [...weeks]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .flatMap((week) =>
      week.entries.map((day) => {
        const notes = typeof day.notes === "string" ? day.notes : "";
        return [
          day.date,
          week.startDate,
          day.dayName,
          decimal(dayTotal(day)),
          ...appColumns.map((column) => decimal(appValue(day, column.labels))),
          ...customApps.map((app) => decimal(safeNumber(day.apps?.[app]) + appBonusTotal(day, app))),
          decimal(safeNumber(day.mileage)),
          decimal(getOperationalDayShiftHours(week, day.date)),
          String(getDayRideCount(day)),
          Boolean(day.dayClosed),
          notes,
        ];
      }),
    );

  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

export function downloadJsonBackup(backup: ReturnType<typeof buildJsonBackup>) {
  downloadTextFile(
    jsonBackupFilename(),
    JSON.stringify(backup, null, 2),
    "application/json",
  );
}

export function downloadEarningsCsv(weeks: WeekRecord[]) {
  downloadTextFile(csvExportFilename(), buildEarningsCsv(weeks), "text/csv");
}
