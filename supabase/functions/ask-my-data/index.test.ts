// Pure-function tests for Ask My Data weekday-pair logic and routing.
// Run with: deno test --allow-env --allow-net supabase/functions/ask-my-data/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMobilityAnalysis,
  analysisPromptForMessages,
  directMobilityAnswer,
  consecutiveDayOffAnalysis,
  detectIntent,
  detectScope,
  directDayAnalysisAnswer,
  fourWeekComparisonAnalysis,
  isMobilityQuestion,
  isBestWeekQuestion,
  restPairMode,
  selectAiModel,
} from "./index.ts";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type DayTotal = { day: string; date: string; total: number };

function makeWeek(id: string, startDate: string, dayTotals: DayTotal[]) {
  const total = dayTotals.reduce((s, d) => s + d.total, 0);
  return {
    id,
    startDate,
    endDate: startDate,
    status: "closed" as const,
    goal: 0,
    total,
    daysWorked: dayTotals.filter((d) => d.total > 0).length,
    appTotals: {},
    dayTotals,
  };
}

// Build N weeks. For each week, every weekday gets the value from `perDay`
// (a map of weekday -> earnings). Missing entries are treated as days off.
function buildHistory(
  weeksCount: number,
  perDay: Partial<Record<typeof WEEKDAYS[number], number>>,
) {
  const weeks = [];
  for (let i = 0; i < weeksCount; i++) {
    const startDate = `2025-01-${String(6 + i * 7).padStart(2, "0")}`;
    const dayTotals: DayTotal[] = WEEKDAYS.map((day, idx) => ({
      day,
      date: `${startDate}-d${idx}`,
      total: perDay[day] ?? 0,
    }));
    weeks.push(makeWeek(`w${i}`, startDate, dayTotals));
  }
  return weeks;
}

// ---------- restPairMode routing ----------

Deno.test("selectAiModel: Luna remains the default for normal prompts", () => {
  const selected = selectAiModel("What pattern do you see in my recent weeks?", "RECENT");
  assertEquals(selected.model, "gpt-5.6-luna");
  assertEquals(selected.reasoningEffort, "low");
  assertEquals(selected.route, "luna_default");
});

Deno.test("selectAiModel: Terra is reserved for explicit cross-period comparisons", () => {
  const selected = selectAiModel("Compare my last four weeks against my best four-week period.", "ALL_TIME");
  assertEquals(selected.model, "gpt-5.6-terra");
  assertEquals(selected.reasoningEffort, "medium");
  assertEquals(selected.route, "terra_complex");
});

Deno.test("selectAiModel: Terra handles zone and shift-planner synthesis", () => {
  const selected = selectAiModel("Today Thursday I want to work 4 hours. Which zone should I test?", "ALL_TIME");
  assertEquals(selected.model, "gpt-5.6-terra");
  assertEquals(selected.reasoningEffort, "medium");
  assertEquals(selected.route, "terra_complex");
});

Deno.test("isMobilityQuestion: Spanish hourly and two-hour prompts load mobility evidence", () => {
  assertEquals(isMobilityQuestion("¿Cuál es mi mejor día por ganancias por hora de turno?"), true);
  assertEquals(isMobilityQuestion("¿Cuáles son mis mejores dos horas de la semana?"), true);
});

Deno.test("analysisPromptForMessages: carries the prior criterion into ranking follow-ups", () => {
  assertEquals(
    analysisPromptForMessages([
      { role: "user", content: "¿Cuál es mi mejor día por ganancias por hora de turno?" },
      { role: "assistant", content: "Sunday" },
      { role: "user", content: "Y el top 7 en orden? con ese mismo criterio." },
    ]),
    "¿Cuál es mi mejor día por ganancias por hora de turno?\nY el top 7 en orden? con ese mismo criterio.",
  );
});

Deno.test("buildMobilityAnalysis: ignores same-second snapshot artifacts as timing evidence", () => {
  const base = {
    week_id: "week-1",
    day_date: "2026-08-22",
    app: "Uber",
  };
  const result = buildMobilityAnalysis({
    rides: [],
    snapshots: [
      { id: "snapshot-1", ...base, delta: 10, created_at: "2026-08-22T12:00:00.000Z" },
      { id: "snapshot-2", ...base, delta: 5, created_at: "2026-08-22T12:00:05.000Z" },
    ],
    snapshotAllocations: [], manualAllocations: [], batches: [], batchEvents: [], payments: [], zoneLabels: [],
    prompt: "¿Cuál es mi mejor día por ganancias por hora de turno?",
  });
  assertEquals(result.coverage.timingEvidenceDays, 0);
  assertEquals(result.coverage.snapshotTimingEvidenceDays, 0);
});

Deno.test("buildMobilityAnalysis: accepts snapshots spaced at least 30 minutes apart", () => {
  const base = {
    week_id: "week-1",
    day_date: "2026-08-22",
    app: "Uber",
  };
  const result = buildMobilityAnalysis({
    rides: [],
    snapshots: [
      { id: "snapshot-1", ...base, delta: 10, created_at: "2026-08-22T12:00:00.000Z" },
      { id: "snapshot-2", ...base, delta: 5, created_at: "2026-08-22T12:30:00.000Z" },
    ],
    snapshotAllocations: [], manualAllocations: [], batches: [], batchEvents: [], payments: [], zoneLabels: [],
    prompt: "¿Cuál es mi mejor día por ganancias por hora de turno?",
  });
  assertEquals(result.coverage.timingEvidenceDays, 1);
  assertEquals(result.coverage.snapshotTimingEvidenceDays, 1);
});

Deno.test("directMobilityAnswer: combined total and hourly weekday question returns both metrics", () => {
  const text = directMobilityAnswer({
    lifetime: {
      weekdayStats: {
        Friday: { average: 200, count: 4, best: 250, bestDate: "2026-09-04" },
        Sunday: { average: 150, count: 4, best: 180, bestDate: "2026-09-06" },
      },
    },
    analysis: {
      weekdayEfficiency: {
        rows: [{ weekday: "Sunday", earnings: 600, hours: 20, shifts: 4, days: 4, earningsPerHour: 30 }],
      },
    },
  }, "$", "¿Cuál es mi mejor día por ganancias totales y cuál por ganancias por hora?");
  assert(text?.includes("ganancias totales promedio"));
  assert(text?.includes("ganancias operativas por hora"));
  assert(text?.includes("viernes"));
  assert(text?.includes("domingo"));
});

Deno.test("buildMobilityAnalysis: preserves pickup earnings while planner uses acceptance context", () => {
  const result = buildMobilityAnalysis({
    rides: [{
      id: "ride-1", day_date: "2026-01-08", app: "Uber", status: "completed",
      started_at: "2026-01-08T16:00:00.000Z", ended_at: "2026-01-08T17:20:00.000Z", pickup_at: "2026-01-08T16:20:00.000Z",
      lifecycle_version: 2, start_zone_key: "start-zone", pickup_zone_key: "pickup-zone",
      start_capture_status: "captured", pickup_capture_status: "captured",
      source: "foreground_browser", time_zone: "America/Denver",
    }],
    snapshots: [],
    snapshotAllocations: [{ ride_event_id: "ride-1", earnings_snapshot_id: "ledger-1", kind: "ride_base", amount: 20, is_current: true }],
    manualAllocations: [], batches: [], batchEvents: [], payments: [],
    zoneLabels: [{ zone_key: "start-zone", label: "North Salt Lake" }, { zone_key: "pickup-zone", label: "Murray" }],
    prompt: "Today Thursday I want to work 4 hours. Which zone should I test?",
  });
  assertEquals(result.pickupEarnings.zones[0]?.zone, "Murray");
  assertEquals(result.pickupEarnings.zones[0]?.earnings, 20);
  assertEquals(result.pickupEarnings.zones[0]?.rideHours, 1.33);
  assertEquals(result.pickupEarnings.zones[0]?.earningsPerRideHour, 15);
  assertEquals(result.pickupEarnings.bestTwoHourPickupWindows[0]?.weekday, "Thursday");
  assertEquals(result.pickupEarnings.bestTwoHourPickupWindows[0]?.averageWindowEarningsPerHour, 10);
  assertEquals(result.shiftPlanner?.candidates[0]?.zone, "North Salt Lake");
  assertEquals(result.shiftPlanner?.candidates[0]?.earnings, 20);
  assertEquals(result.shiftPlanner?.candidates[0]?.confidence, "low");
});

Deno.test("isBestWeekQuestion: does not steal a comparison that cites the best period", () => {
  assertEquals(isBestWeekQuestion("What was my best week?"), true);
  assertEquals(
    isBestWeekQuestion("Compare my last four weeks against my best four-week period."),
    false,
  );
});

Deno.test("fourWeekComparisonAnalysis: compares the latest completed calendar period to the best one", () => {
  const weeks = [
    ["2025-01-06", "2025-01-12", 500],
    ["2025-01-13", "2025-01-19", 500],
    ["2025-01-20", "2025-01-26", 500],
    ["2025-01-27", "2025-02-02", 500],
    ["2025-02-03", "2025-02-09", 100],
  ].map(([startDate, endDate, total]) => ({
    startDate: startDate as string,
    endDate: endDate as string,
    total: total as number,
    status: "closed" as const,
  }));

  const result = fourWeekComparisonAnalysis(weeks)!;
  assert(result, "four completed consecutive weeks should produce a comparison");
  assertEquals(result.latest.total, 1600);
  assertEquals(result.best.total, 2000);
  assertEquals(result.changeTotal, -400);
  assertEquals(result.changeAverageWeek, -100);
  assertEquals(result.eligiblePeriods, 2);
});

Deno.test("fourWeekComparisonAnalysis: ignores periods with a missing calendar week", () => {
  const weeks = [
    ["2025-01-06", "2025-01-12", 100],
    ["2025-01-13", "2025-01-19", 100],
    ["2025-01-20", "2025-01-26", 100],
    ["2025-02-03", "2025-02-09", 100],
  ].map(([startDate, endDate, total]) => ({
    startDate: startDate as string,
    endDate: endDate as string,
    total: total as number,
    status: "closed" as const,
  }));

  assertEquals(fourWeekComparisonAnalysis(weeks), null);
});

Deno.test("detectScope: best four-week comparisons use full history despite a recent-window phrase", () => {
  const result = detectScope([
    { role: "user", content: "Compare my last four weeks against my best four-week period." },
  ]);
  assertEquals(result.scope, "ALL_TIME");
});

Deno.test("restPairMode: English take_off phrasing", () => {
  assertEquals(
    restPairMode("If I wanted to take two days off in a row, which should they be?"),
    "take_off",
  );
  assertEquals(restPairMode("two back-to-back days off"), "take_off");
  assertEquals(restPairMode("two consecutive days off"), "take_off");
});

Deno.test("restPairMode: English protect phrasing", () => {
  assertEquals(
    restPairMode("Which two days should I not rest?"),
    "protect",
  );
  assertEquals(
    restPairMode("which two days shouldn't I rest"),
    "protect",
  );
});

Deno.test("restPairMode: Spanish take_off phrasing", () => {
  assertEquals(
    restPairMode("Si quisiera descansar dos días seguidos, cuáles deberían ser?"),
    "take_off",
  );
  assertEquals(restPairMode("dos días libres seguidos"), "take_off");
});

Deno.test("restPairMode: Spanish protect phrasing", () => {
  assertEquals(
    restPairMode("Y los dos días que no debería descansar?"),
    "protect",
  );
});

Deno.test("restPairMode: negative routing (best-day questions)", () => {
  assertEquals(restPairMode("What was my best day ever?"), null);
  assertEquals(restPairMode("What is my best weekday?"), null);
  assertEquals(restPairMode("Which weekday makes me the most money?"), null);
  assertEquals(restPairMode("What was my strongest month?"), null);
});

// ---------- consecutiveDayOffAnalysis ----------

Deno.test("consecutiveDayOffAnalysis: returns null when not a rest-pair prompt", () => {
  const weeks = buildHistory(4, { Monday: 100, Tuesday: 200 });
  assertEquals(
    consecutiveDayOffAnalysis(weeks, "What was my best day ever?"),
    null,
  );
});

Deno.test("consecutiveDayOffAnalysis: all 7 consecutive pairs including Sunday→Monday", () => {
  // Distinct values per weekday so every pair gets a unique combined average.
  const weeks = buildHistory(4, {
    Monday: 100,
    Tuesday: 110,
    Wednesday: 120,
    Thursday: 130,
    Friday: 140,
    Saturday: 200,
    Sunday: 180,
  });
  const result = consecutiveDayOffAnalysis(
    weeks,
    "Si quisiera descansar dos días seguidos, cuáles deberían ser?",
  )!;
  assert(result, "result should be present");
  assertEquals(result.pairs.length, 7);
  const days = result.pairs.map((p) => p.days.join("-")).sort();
  assertEquals(days, [
    "Friday-Saturday",
    "Monday-Tuesday",
    "Saturday-Sunday",
    "Sunday-Monday",
    "Thursday-Friday",
    "Tuesday-Wednesday",
    "Wednesday-Thursday",
  ]);
  const sunMon = result.pairs.find((p) => p.days[0] === "Sunday" && p.days[1] === "Monday");
  assert(sunMon, "Sunday→Monday pair must exist");
  assertEquals(sunMon!.crossesWeekBoundary, true);
});

Deno.test("consecutiveDayOffAnalysis: take_off recommends lowest combined pair", () => {
  const weeks = buildHistory(5, {
    Monday: 50, // weakest weekday
    Tuesday: 60, // next weakest
    Wednesday: 200,
    Thursday: 210,
    Friday: 220,
    Saturday: 300,
    Sunday: 290,
  });
  const result = consecutiveDayOffAnalysis(
    weeks,
    "If I wanted to take two days off in a row, which should they be?",
  )!;
  assertEquals(result.mode, "take_off");
  assertEquals(result.recommendation?.days, ["Monday", "Tuesday"]);
  // Pairs are sorted ascending — first is lowest.
  assertEquals(result.pairs[0].days, ["Monday", "Tuesday"]);
});

Deno.test("consecutiveDayOffAnalysis: protect recommends highest combined pair", () => {
  const weeks = buildHistory(5, {
    Monday: 50,
    Tuesday: 60,
    Wednesday: 200,
    Thursday: 210,
    Friday: 220,
    Saturday: 300, // strongest
    Sunday: 290, // strongest
  });
  const result = consecutiveDayOffAnalysis(
    weeks,
    "Which two days should I not rest?",
  )!;
  assertEquals(result.mode, "protect");
  assertEquals(result.recommendation?.days, ["Saturday", "Sunday"]);
});

Deno.test("consecutiveDayOffAnalysis: deterministic tie-breaks (sample size, then natural order)", () => {
  // Two pairs with identical combined averages but different sample sizes:
  // Build a custom history per weekday count.
  const days = (n: number, v: number) =>
    Array.from({ length: n }, () => v);

  // We want Monday=Tuesday=100 with n=2 (so Mon-Tue avg=100+100=200, minSample=2)
  // and Friday=Saturday=100 with n=6 (so Fri-Sat avg=200, minSample=6).
  // Mon-Tue and Fri-Sat tie on combinedAverage; Fri-Sat should sort first
  // because it has the larger minimum sample size.
  const weeks: ReturnType<typeof makeWeek>[] = [];
  let id = 0;
  const push = (perDay: Partial<Record<typeof WEEKDAYS[number], number>>) => {
    id += 1;
    const startDate = `2025-02-${String(id).padStart(2, "0")}`;
    weeks.push(
      makeWeek(
        `w${id}`,
        startDate,
        WEEKDAYS.map((d, i) => ({
          day: d,
          date: `${startDate}-${i}`,
          total: perDay[d] ?? 0,
        })),
      ),
    );
  };

  for (const _ of days(2, 0)) push({ Monday: 100, Tuesday: 100 });
  for (const _ of days(6, 0)) push({ Friday: 100, Saturday: 100 });

  const result = consecutiveDayOffAnalysis(
    weeks,
    "If I wanted to take two days off in a row, which should they be?",
  )!;
  // Only Mon-Tue and Fri-Sat have data for both halves.
  const tiedPairs = result.pairs.filter((p) => p.combinedAverage === 200);
  assertEquals(tiedPairs.length, 2);
  assertEquals(tiedPairs[0].days, ["Friday", "Saturday"]); // larger min sample
  assertEquals(tiedPairs[1].days, ["Monday", "Tuesday"]);
  assertEquals(result.recommendation?.days, ["Friday", "Saturday"]);
});

Deno.test("consecutiveDayOffAnalysis: deterministic tie-breaks (natural order when all tied)", () => {
  // All weekdays equal → every pair ties on average and sample size → natural
  // order wins (Monday-Tuesday recommended for take_off).
  const weeks = buildHistory(4, {
    Monday: 100,
    Tuesday: 100,
    Wednesday: 100,
    Thursday: 100,
    Friday: 100,
    Saturday: 100,
    Sunday: 100,
  });
  const result = consecutiveDayOffAnalysis(weeks, "two consecutive days off")!;
  assertEquals(result.pairs.length, 7);
  assertEquals(result.pairs[0].days, ["Monday", "Tuesday"]);
  assertEquals(result.recommendation?.days, ["Monday", "Tuesday"]);
});

Deno.test("consecutiveDayOffAnalysis: insufficient data — no pairs when only one weekday tracked", () => {
  const weeks = buildHistory(4, { Monday: 100 });
  const result = consecutiveDayOffAnalysis(weeks, "two consecutive days off")!;
  assertEquals(result.pairs.length, 0);
  assertEquals(result.recommendation, null);
});

Deno.test("consecutiveDayOffAnalysis: asymmetric and small samples surface lowSampleSize caveat", () => {
  // Only 1 sample each for Monday & Tuesday, plenty everywhere else.
  const weeks: ReturnType<typeof makeWeek>[] = [];
  let id = 0;
  const push = (perDay: Partial<Record<typeof WEEKDAYS[number], number>>) => {
    id += 1;
    const startDate = `2025-03-${String(id).padStart(2, "0")}`;
    weeks.push(
      makeWeek(
        `w${id}`,
        startDate,
        WEEKDAYS.map((d, i) => ({
          day: d,
          date: `${startDate}-${i}`,
          total: perDay[d] ?? 0,
        })),
      ),
    );
  };

  // 1 week with Mon+Tue weak, 8 weeks with strong everywhere else.
  push({ Monday: 10, Tuesday: 10 });
  for (let i = 0; i < 8; i++) {
    push({
      Wednesday: 200,
      Thursday: 200,
      Friday: 200,
      Saturday: 200,
      Sunday: 200,
    });
  }

  const result = consecutiveDayOffAnalysis(
    weeks,
    "If I wanted to take two days off in a row, which should they be?",
  )!;
  // Mon-Tue is lowest by far (avg 20) so it wins.
  assertEquals(result.recommendation?.days, ["Monday", "Tuesday"]);
  assertEquals(result.recommendation?.minimumSampleSize, 1);
  assertEquals(result.lowSampleSize, true);
  assert(result.sampleSizeCaveat, "expected a sample-size caveat string");
});

// ---------- visible deterministic answer ----------

Deno.test("directDayAnalysisAnswer: surfaces small-sample caveat to the user", () => {
  const weeks = buildHistory(1, {
    Monday: 10,
    Tuesday: 10,
    Wednesday: 200,
    Thursday: 200,
    Friday: 200,
    Saturday: 200,
    Sunday: 200,
  });
  const analysis = consecutiveDayOffAnalysis(
    weeks,
    "If I wanted to take two days off in a row, which should they be?",
  );
  const answer = directDayAnalysisAnswer(
    { scope: "ALL_TIME", coverage: { isFullHistoryLoaded: true }, analysis: { consecutiveDayOff: analysis } },
    "$",
    "If I wanted to take two days off in a row, which should they be?",
  );
  assert(answer?.includes("recommendation is directional"));
  assert(answer?.includes("fewer than 4 historical samples"));
});

// ---------- intent + scope ----------

Deno.test("detectIntent: weekday questions route to DAY", () => {
  assertEquals(detectIntent("What was my best Saturday?"), "DAY");
  assertEquals(detectIntent("Which weekday makes me the most money?"), "DAY");
});

Deno.test("detectScope: rest-pair questions force ALL_TIME", () => {
  const result = detectScope([
    {
      role: "user",
      content: "Si quisiera descansar dos días seguidos, cuáles deberían ser?",
    },
  ]);
  assertEquals(result.scope, "ALL_TIME");
});

Deno.test("detectScope: unspecified-timeframe questions default to ALL_TIME", () => {
  const result = detectScope([
    { role: "user", content: "What is my best weekday?" },
  ]);
  assertEquals(result.scope, "ALL_TIME");
});
