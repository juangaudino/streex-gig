// Exercise the actual Edge Function's pure analytics without live credentials.
// The only stub is the remote Supabase client import; no network requests occur.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["supabase/functions/ask-my-data/index.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "offline-supabase",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, (args) => ({ path: args.path, namespace: "offline" }));
      buildApi.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "export const createClient = (...args) => globalThis.testCreateClient(...args);", loader: "js" }));
    },
  }],
});
const moduleState = { exports: {} };
let handler;
let clientFactory = () => ({});
vm.runInNewContext(built.outputFiles[0].text, {
  module: moduleState,
  exports: moduleState.exports,
  Deno: { env: { get: (name) => name === "OPENAI_API_KEY" ? "offline-test-key" : "offline-test" }, serve: (fn) => { handler = fn; } },
  testCreateClient: (...args) => clientFactory(...args),
  console, Intl, Date, Map, Set, Number, Math, JSON, Request, Response, Headers, URL, TextEncoder, TextDecoder,
});
const analytics = moduleState.exports;
const timingBundle = await build({ entryPoints: ["supabase/functions/_shared/shiftTiming.ts"], bundle: true, write: false, platform: "node", format: "cjs" });
const timingModule = { exports: {} };
vm.runInNewContext(timingBundle.outputFiles[0].text, { module: timingModule, exports: timingModule.exports, Date, Intl, Number, Math });
const timing = timingModule.exports;

test("local timestamps reject ambiguous, nonexistent, and invalid times", () => {
  assert.equal(timing.parseShiftTimestamp("2026-09-07T09:00:00", "America/Denver"), Date.parse("2026-09-07T15:00:00Z"));
  assert.ok(Number.isNaN(timing.parseShiftTimestamp("2026-11-01T01:30:00", "America/Denver")));
  assert.ok(Number.isNaN(timing.parseShiftTimestamp("2026-03-08T02:30:00", "America/Denver")));
  assert.ok(Number.isNaN(timing.parseShiftTimestamp("2026-02-30T09:00:00", "America/Denver")));
});

const shift = {
  id: "shift-1", startTime: "2026-09-07T09:00:00", endTime: "2026-09-07T13:00:00", rideCount: 2,
  blocks: [
    { id: "b1", startTime: "2026-09-07T09:00:00", endTime: "2026-09-07T10:00:00" },
    { id: "b2", startTime: "2026-09-07T12:00:00", endTime: "2026-09-07T13:00:00" },
  ],
};
const week = {
  id: "week-1", start_date: "2026-09-07", end_date: "2026-09-13", weekly_goal: 1000, status: "closed",
  entries: [
    { dayName: "Monday", date: "2026-09-07", apps: { Uber: 100 }, shifts: [shift], mileage: 90 },
    { dayName: "Tuesday", date: "2026-09-08", apps: { Uber: 1000 }, shifts: [] },
  ],
};
const ride = (id, end) => ({
  id, day_date: "2026-09-10", app: "Uber", status: "completed", started_at: "2026-09-10T16:00:00.000Z",
  ended_at: end, pickup_at: "2026-09-10T16:00:00.000Z", lifecycle_version: 2,
  start_zone_key: "zone", pickup_zone_key: "zone", start_capture_status: "captured", pickup_capture_status: "captured",
  source: "foreground_browser", time_zone: "America/Denver",
});
const mobility = (overrides = {}) => analytics.buildMobilityAnalysis({
  rides: [], snapshots: [], snapshotAllocations: [], manualAllocations: [], batches: [], batchEvents: [], payments: [],
  zoneLabels: [{ zone_key: "zone", label: "Test zone" }], prompt: "ganancias por hora por zona", ...overrides,
});

test("HTTP handler rejects missing credentials and invalid dates", async () => {
  const makeRequest = (body, authorization) => new Request("https://example.test", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
  });
  const missing = await handler(makeRequest({ messages: [{ role: "user", content: "hola" }] }));
  assert.equal(missing.status, 401);
  const invalid = await handler(makeRequest({ messages: [{ role: "user", content: "2026-02-30" }] }, "Bearer test"));
  assert.equal(invalid.status, 400);
  clientFactory = () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "invalid token" } }) } });
  const invalidJwt = await handler(makeRequest({ messages: [{ role: "user", content: "hola" }] }, "Bearer invalid"));
  assert.equal(invalidJwt.status, 401);
});

test("HTTP handler passes caller JWT and answers a dated question from the selected week", async () => {
  let receivedAuthorization;
  let logged;
  clientFactory = (_url, _key, options) => {
    receivedAuthorization = options.global.headers.Authorization;
    const tables = { weeks: [week], earnings_snapshots: [], earnings_attributions: [], user_achievements: [] };
    return {
      auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } }, error: null }) },
      from(table) {
        const rows = tables[table] ?? [];
        const query = {
          select() { return this; }, order() { return this; }, lte() { return this; }, gte() { return this; },
          range: async (start, end) => ({ data: rows.slice(start, end + 1), error: null }),
          limit: async (count) => ({ data: rows.slice(0, count), error: null }),
          maybeSingle: async () => ({ data: { currency_symbol: "$", active_apps: ["Uber"], default_weekly_goal: 1000 }, error: null }),
          insert: async (record) => { logged = record; return { error: null }; },
        };
        return query;
      },
    };
  };
  const response = await handler(new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer fixture-jwt", "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "¿Cuánto gané el 2026-09-07?" }], timeZone: "America/Denver" }) }));
  assert.equal(response.status, 200);
  assert.equal(receivedAuthorization, "Bearer fixture-jwt");
  assert.match((await response.json()).text, /100/);
  assert.equal(logged.prompt_preview, null);
});

test("period summaries split a week at the calendar month boundary", () => {
  const context = analytics.buildContext({
    scope: "SEASONAL", scopeReason: "test", settings: null, achievements: [],
    weeks: [{ ...week, start_date: "2026-08-31", end_date: "2026-09-06", entries: [
      { date: "2026-08-31", dayName: "Monday", apps: { Uber: 100 } },
      { date: "2026-09-01", dayName: "Tuesday", apps: { Uber: 200 } },
    ] }],
  });
  assert.equal(context.periods.monthly.find((row) => row.period === "2026-08").total, 100);
  assert.equal(context.periods.monthly.find((row) => row.period === "2026-09").total, 200);
});

test("best zones in the last four weeks retain the requested date range", () => {
  const range = analytics.requestedRelativeRange("¿Cuáles son mis mejores zonas en las últimas cuatro semanas?", "2026-09-10");
  assert.equal(range.from, "2026-08-14");
  assert.equal(range.to, "2026-09-10");
});

test("Spanish best-hours questions request full history unless a period is specified", () => {
  const historical = analytics.detectScope([{ role: "user", content: "¿Cuáles son mis mejores dos horas de la semana?" }]);
  assert.equal(historical.scope, "ALL_TIME");
  const recent = analytics.requestedRelativeRange("¿Cuáles son mis mejores horas en las últimas cuatro semanas?", "2026-09-10");
  assert.equal(recent.from, "2026-08-14");
});

test("a named zone is not answered with an unrelated global time window", () => {
  const answer = analytics.directMobilityAnswer({ analysis: {
    mobility: { requestedZones: ["Park City"], pickupEarnings: { zones: [] } },
    shiftHourlyWindows: { windows: [{ weekday: "Monday", startHour: 9, endHourExclusive: 11, earnings: 30, hours: 2, days: 1, earningsPerHour: 15, confidence: "low" }] },
  } }, "$", "¿Cuáles son mis mejores dos horas en Park City?");
  assert.equal(answer, null);
});

test("hourly earnings match earnings and active hours from the same complete day", () => {
  const normalized = analytics.normalizeWeek(week);
  const result = analytics.aggregateShiftStats([normalized]);
  assert.equal(normalized.dayTotals[0].hours, 2);
  assert.equal(normalized.dayTotals[0].miles, 90);
  assert.equal(result.eligibleDays, 1);
  assert.equal(result.eligibleEarnings, 100);
  assert.equal(result.eligibleHours, 2);
  assert.equal(result.earningsPerHour, 50);
});

test("weekday efficiency excludes earnings from days without eligible hours", () => {
  const row = analytics.normalizeWeek({ ...week, entries: [week.entries[0], { ...week.entries[1], dayName: "Monday" }] });
  const result = analytics.weekdayEfficiencyAnalysis([row], "mejor dia por hora", ["2026-09-07", "2026-09-08"]);
  assert.equal(result.rows[0].earnings, 100);
  assert.equal(result.rows[0].earningsPerHour, 50);
  assert.equal(result.rows[0].days, 1);
});

test("zone ride-hour rate excludes earnings whose duration is missing", () => {
  const result = mobility({
    rides: [ride("valid", "2026-09-10T17:00:00.000Z"), ride("missing", null)],
    snapshotAllocations: [
      { ride_event_id: "valid", earnings_snapshot_id: "s1", kind: "ride_base", amount: 10, is_current: true },
      { ride_event_id: "missing", earnings_snapshot_id: "s2", kind: "ride_base", amount: 10, is_current: true },
    ],
  }).pickupEarnings.zones[0];
  assert.equal(result.earnings, 20);
  assert.equal(result.timedRides, 1);
  assert.equal(result.earningsPerRideHour, 10);
});

test("a single snapshot linked by batch and payment counts once", () => {
  const result = mobility({
    rides: [ride("ride", "2026-09-10T17:00:00.000Z")],
    snapshots: [{ id: "snap", week_id: "w", day_date: "2026-09-10", app: "Uber", delta: 10, created_at: "2026-09-10T17:00:00Z" }],
    batches: [{ id: "batch", earnings_snapshot_id: "snap", kind: "single" }],
    batchEvents: [{ batch_id: "batch", ride_event_id: "ride" }],
    payments: [{ ride_event_id: "ride", earnings_snapshot_id: "snap" }],
  }).pickupEarnings.zones[0];
  assert.equal(result.earnings, 10);
});

test("explicit dates and 30-week requests load their actual period", async () => {
  const calls = [];
  const query = {
    select() { return this; }, order() { return this; },
    limit(value) { calls.push(["limit", value]); return Promise.resolve({ data: [], error: null }); },
    lte(field, value) { calls.push(["lte", field, value]); return this; },
    gte(field, value) { calls.push(["gte", field, value]); return this; },
    range(from, to) { calls.push(["range", from, to]); return Promise.resolve({ data: [], error: null }); },
  };
  const db = { from() { return query; } };
  const dateQuestion = "How much did I earn on 2025-01-01?";
  await analytics.fetchWeeksForScope(db, analytics.detectScope([{ role: "user", content: dateQuestion }]).scope, dateQuestion);
  assert.deepEqual(calls, [["lte", "start_date", "2025-01-01"], ["gte", "end_date", "2025-01-01"], ["range", 0, 499]]);
  calls.length = 0;
  const weeksQuestion = "What were my earnings over the last 30 weeks?";
  await analytics.fetchWeeksForScope(db, analytics.detectScope([{ role: "user", content: weeksQuestion }]).scope, weeksQuestion);
  assert.deepEqual(calls, [["limit", 30]]);
  assert.equal(analytics.requestedRecentWeeks("mis últimas 30 semanas"), 30);
  assert.equal(analytics.requestedCalendarRange("2025-02-31"), null);
});

test("a question about one date answers that day's recorded total", () => {
  const question = "¿Cuánto gané el 2026-09-07?";
  const context = analytics.buildContext({ scope: "RECENT", scopeReason: "test", weeks: [week], settings: null, achievements: [], prompt: question });
  const answer = analytics.directCalendarDayAnswer(context, "$", question);
  assert.match(answer, /2026-09-07/);
  assert.match(answer, /100\.00/);
  assert.doesNotMatch(answer, /1,100/);
});

test("a dated question asking for advice is not reduced to a canned total", () => {
  const question = "¿Cuánto gané el 2026-09-07 y qué me recomiendas?";
  const context = analytics.buildContext({ scope: "RECENT", scopeReason: "test", weeks: [week], settings: null, achievements: [], prompt: question });
  assert.equal(analytics.directCalendarDayAnswer(context, "$", question), null);
});

test("pending earnings stay in reported totals but are excluded from hourly rankings", () => {
  const snapshots = [
    { id: "s1", userId: "caller", weekId: "week-1", dayDate: "2026-09-07", app: "Uber", previousAmount: 0, newAmount: 50, delta: 50, shiftId: "shift-1", createdAt: "2026-09-07T16:00:00Z" },
    { id: "s2", userId: "caller", weekId: "week-1", dayDate: "2026-09-07", app: "Uber", previousAmount: 50, newAmount: 100, delta: 50, shiftId: "shift-1", createdAt: "2026-09-07T19:00:00Z" },
  ];
  const evidence = analytics.buildEarningsEvidence({
    weeks: [{ entries: week.entries }], snapshots,
    attributions: [{ snapshotId: "s2", status: "pending", mode: "unassigned" }], timeZone: "America/Denver",
  });
  const monday = evidence.byDay.get("2026-09-07");
  assert.equal(monday.reportedOperationalEarnings, 100);
  assert.equal(monday.earnings, 50);
  assert.equal(monday.excludedFromEfficiency, 50);
  const normalized = analytics.normalizeWeek(week, evidence.byDay, "America/Denver");
  assert.equal(normalized.dayTotals[0].total, 100);
  assert.equal(normalized.shiftStats.earningsPerHour, null);
});

test("an unresolved update after a shift is not assigned to worked hours from its shift id alone", () => {
  const snapshot = { id: "late", userId: "caller", weekId: "week-1", dayDate: "2026-09-07", app: "Uber", previousAmount: 0, newAmount: 100, delta: 100, shiftId: "shift-1", createdAt: "2026-09-08T02:00:00Z" };
  const evidence = analytics.buildEarningsEvidence({ weeks: [{ entries: [week.entries[0]] }], snapshots: [snapshot], attributions: [], timeZone: "America/Denver" });
  assert.equal(evidence.byDay.get("2026-09-07").reportedOperationalEarnings, 100);
  assert.equal(evidence.byDay.get("2026-09-07").excludedFromEfficiency, 100);
  assert.equal(evidence.hourly.length, 0);
});

test("snapshot anomalies larger than the reported day do not inflate hourly rankings", () => {
  const snapshot = { id: "large", userId: "caller", weekId: "week-1", dayDate: "2026-09-07", app: "Uber", previousAmount: 0, newAmount: 10000, delta: 10000, shiftId: "shift-1", createdAt: "2026-09-07T16:00:00Z" };
  const evidence = analytics.buildEarningsEvidence({ weeks: [{ entries: [week.entries[0]] }], snapshots: [snapshot], attributions: [], timeZone: "America/Denver" });
  const normalized = analytics.normalizeWeek({ ...week, entries: [week.entries[0]] }, evidence.byDay, "America/Denver");
  assert.equal(normalized.dayTotals[0].total, 100);
  assert.equal(normalized.dayTotals[0].hourlyEligible, false);
  assert.equal(normalized.shiftStats.earningsPerHour, null);
});

test("two-hour windows include worked days with zero earnings and label snapshots as estimated", () => {
  const run = (id, date, amount) => ({
    id, start_date: date, end_date: date, weekly_goal: 0, status: "closed",
    entries: [{ dayName: "Monday", date, apps: { Uber: amount }, shifts: [{ id: `shift-${id}`, startTime: `${date}T09:00:00`, endTime: `${date}T11:00:00`, blocks: [{ id: `block-${id}`, startTime: `${date}T09:00:00`, endTime: `${date}T11:00:00` }] }] }],
  });
  const first = run("one", "2026-09-07", 40);
  const second = run("two", "2026-09-14", 0);
  const snapshots = [
    { id: "s1", userId: "caller", weekId: "one", dayDate: "2026-09-07", app: "Uber", previousAmount: 0, newAmount: 20, delta: 20, shiftId: "shift-one", createdAt: "2026-09-07T16:00:00Z" },
    { id: "s2", userId: "caller", weekId: "one", dayDate: "2026-09-07", app: "Uber", previousAmount: 20, newAmount: 40, delta: 20, shiftId: "shift-one", createdAt: "2026-09-07T17:00:00Z" },
  ];
  const evidence = analytics.buildEarningsEvidence({ weeks: [first, second], snapshots, attributions: [], timeZone: "America/Denver" });
  assert.equal(evidence.byDay.get("2026-09-07").earnings, 40);
  const result = analytics.buildShiftHourlyWindows({ weeks: [first, second], evidence, timeZone: "America/Denver" });
  const window = result.windows.find((item) => item.weekday === "Monday" && item.startHour === 9);
  assert.equal(window.days, 2);
  assert.equal(window.hours, 4);
  assert.equal(window.earnings, 40);
  assert.equal(window.earningsPerHour, 10);
});

test("relative periods respect the driver's 4 a.m. local day and contain the requested days", () => {
  const today = analytics.currentOperationalDate(new Date("2026-09-12T07:00:00Z"), "America/Denver");
  assert.equal(today, "2026-09-11");
  const range = analytics.requestedRelativeRange("mis últimas 30 semanas", today);
  assert.equal(range.to, "2026-09-11");
  assert.equal((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1, 210);
  assert.equal(analytics.isMobilityQuestion("¿Qué día me recomiendas ir a Park City?"), true);
  assert.equal(analytics.requestedRelativeRange("Hoy solo quiero trabajar 4 horas, ¿qué zona recomiendas?", today), null);
});

test("lifecycle-v2 rides with a missing pickup time do not borrow the acceptance time", () => {
  const result = mobility({
    rides: [{ ...ride("ride", "2026-09-10T17:00:00.000Z"), pickup_at: null }],
    snapshotAllocations: [{ ride_event_id: "ride", earnings_snapshot_id: "s", kind: "ride_base", amount: 10, is_current: true }],
  });
  assert.equal(result.pickupEarnings.zones[0].earnings, 10);
  assert.equal(result.pickupEarnings.bestTwoHourPickupWindows.length, 0);
});
