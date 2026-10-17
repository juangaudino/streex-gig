import { describe, expect, it } from "vitest";
import { buildPatternIntelligence, classifyWeeklyGoalOutcome, createHistoricalShift, createShift, endActiveShift, getDayRideCount, getDayMiles, getDayShiftHours, getOperationalDayShiftHours, getWeekMiles, getWeekRideCount, isShiftPaused, pauseActiveShift, resolveShiftRate, resumePausedShift, shiftBreakHours, shiftDurationHours, updateShiftBoundaryTime } from "./shiftIntelligence";
import type { DayEntry, EarningsAttribution, EarningsSnapshot, WeekRecord } from "./types";
import { DAY_NAMES } from "./types";

function day(index: number, total: number, shifts: DayEntry["shifts"] = [], mileage?: number): DayEntry {
  return {
    dayName: DAY_NAMES[index],
    date: `2026-05-${String(4 + index).padStart(2, "0")}`,
    logged: total > 0,
    apps: { Uber: total * 0.6, "Spark Driver": total * 0.4 },
    shifts,
    mileage,
  };
}

function week(entries: DayEntry[]): WeekRecord {
  return {
    id: "w1",
    startDate: "2026-05-04",
    endDate: "2026-05-10",
    weeklyGoal: 1000,
    status: "open",
    entries,
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  };
}

describe("shift intelligence", () => {
  it("creates closed historical shifts with editable boundaries", () => {
    const shift = createHistoricalShift("2026-05-04");

    expect(shift.startTime).toBe("2026-05-04T09:00:00");
    expect(shift.endTime).toBe("2026-05-04T17:00:00");
    expect(shiftDurationHours(shift)).toBe(8);
    expect(shift.blocks).toHaveLength(1);
    expect(shift.blocks?.[0]).toMatchObject({
      startTime: "2026-05-04T09:00:00",
      endTime: "2026-05-04T17:00:00",
    });
  });

  it("calculates shift duration and mileage from manual shifts", () => {
    const shift = {
      id: "s1",
      startTime: "2026-05-04T08:00:00",
      endTime: "2026-05-04T11:30:00",
      miles: 42,
      rideCount: 9,
    };
    const d = day(0, 220, [shift]);

    expect(shiftDurationHours(shift)).toBe(3.5);
    expect(getDayMiles(d)).toBe(42);
    expect(getWeekMiles(week([d]))).toBe(42);
    expect(getDayRideCount(d)).toBe(9);
    expect(getWeekRideCount(week([d]))).toBe(9);
  });

  it("calculates active work time from work blocks and excludes pauses", () => {
    const shift = {
      id: "s1",
      startTime: "2026-05-04T08:00:00",
      endTime: "2026-05-04T18:00:00",
      blocks: [
        { id: "b1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T12:00:00" },
        { id: "b2", startTime: "2026-05-04T12:45:00", endTime: "2026-05-04T18:00:00" },
      ],
    };

    expect(shiftDurationHours(shift)).toBe(9.25);
    expect(shiftBreakHours(shift)).toBe(0.75);
  });

  it("keeps the real local date when a shift ends after midnight", () => {
    const shift = createShift("2026-09-11", new Date(2026, 8, 11, 17, 48, 0));
    const shiftDay = day(0, 0, [shift]);
    const ended = endActiveShift(shiftDay, new Date(2026, 8, 12, 1, 3, 0)).shifts?.[0];

    expect(ended?.startTime).toBe("2026-09-11T17:48:00");
    expect(ended?.endTime).toBe("2026-09-12T01:03:00");
    expect(shiftDurationHours(ended!)).toBe(7.25);
    expect(getDayShiftHours({ ...shiftDay, shifts: [ended!] })).toBe(7.25);
  });

  it("reads a previously saved same-date overnight boundary as next-day without rewriting it", () => {
    const legacyShift = {
      id: "legacy-overnight",
      startTime: "2026-09-11T17:48:00",
      endTime: "2026-09-11T01:03:00",
      blocks: [{ id: "legacy-block", startTime: "2026-09-11T17:48:00", endTime: "2026-09-11T01:03:00" }],
    };

    expect(shiftDurationHours(legacyShift)).toBe(7.25);
    expect(legacyShift.endTime).toBe("2026-09-11T01:03:00");
  });

  it("splits cross-boundary work hours across operational days without ending the shift", () => {
    const shift = {
      id: "overnight",
      startTime: "2026-09-11T23:00:00",
      endTime: "2026-09-12T05:00:00",
      blocks: [{ id: "overnight_block", startTime: "2026-09-11T23:00:00", endTime: "2026-09-12T05:00:00" }],
    };
    const entries = [
      { ...day(0, 0), date: "2026-09-11", shifts: [shift] },
      { ...day(1, 0), date: "2026-09-12", shifts: [] },
    ];
    const sourceWeek = week(entries);

    expect(getOperationalDayShiftHours(sourceWeek, "2026-09-11")).toBe(5);
    expect(getOperationalDayShiftHours(sourceWeek, "2026-09-12")).toBe(1);
    expect(shiftDurationHours(shift)).toBe(6);
  });

  it("treats edited shift boundaries as authoritative over stale work blocks", () => {
    const staleShift = {
      id: "s1",
      startTime: "2026-07-03T08:23:00",
      endTime: "2026-07-03T10:40:00",
      blocks: [
        { id: "b1", startTime: "2026-07-03T08:23:00", endTime: "2026-07-03T11:58:00" },
      ],
    };

    expect(shiftDurationHours(staleShift)).toBe(2.28);
  });

  it("synchronizes edited boundaries while preserving internal pauses", () => {
    const shift = {
      id: "s1",
      startTime: "2026-05-04T08:00:00",
      endTime: "2026-05-04T18:00:00",
      blocks: [
        { id: "b1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T12:00:00" },
        { id: "b2", startTime: "2026-05-04T12:45:00", endTime: "2026-05-04T18:00:00" },
      ],
    };
    const updated = updateShiftBoundaryTime(shift, "endTime", "2026-05-04T16:00:00");

    expect(updated?.blocks?.[1].endTime).toBe("2026-05-04T16:00:00");
    expect(shiftDurationHours(updated!)).toBe(7.25);
    expect(shiftBreakHours(updated!)).toBe(0.75);
  });

  it("does not count time after a paused block when the shift is ended while paused", () => {
    const pausedThenEnded = {
      id: "s1",
      startTime: "2026-05-04T08:00:00",
      endTime: "2026-05-04T12:30:00",
      blocks: [
        { id: "b1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T12:00:00" },
      ],
    };

    expect(shiftDurationHours(pausedThenEnded)).toBe(4);
  });

  it("pauses and resumes a shift as multiple work blocks", () => {
    const d = day(0, 100, [{ id: "s1", startTime: "2026-05-04T08:00:00", blocks: [{ id: "b1", startTime: "2026-05-04T08:00:00" }] }]);
    const paused = pauseActiveShift(d, new Date("2026-05-04T12:00:00"));
    const pausedShift = paused.shifts![0];

    expect(isShiftPaused(pausedShift)).toBe(true);
    expect(pausedShift.blocks?.[0].endTime).toBe("2026-05-04T12:00:00");

    const resumed = resumePausedShift(paused, new Date("2026-05-04T12:45:00"));
    const resumedShift = resumed.shifts![0];

    expect(isShiftPaused(resumedShift)).toBe(false);
    expect(resumedShift.blocks).toHaveLength(2);
    expect(resumedShift.blocks?.[1].startTime).toBe("2026-05-04T12:45:00");
  });

  it("resolves shift rates from manual earnings on multi-shift days", () => {
    const firstShift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", earnings: 80 };
    const secondShift = { id: "s2", startTime: "2026-05-04T12:00:00", endTime: "2026-05-04T14:00:00", earnings: 120 };
    const d = day(0, 200, [firstShift, secondShift]);

    expect(resolveShiftRate(d, firstShift).rate).toBe(40);
    expect(resolveShiftRate(d, secondShift).rate).toBe(60);
  });

  it("does not add a late attribution twice after manual shift earnings already match the reported day", () => {
    const shift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", earnings: 100 };
    const d = day(0, 100, [shift]);
    const late = { ...snapshot("late", d.date, "Uber", 20, `${d.date}T20:00:00`), previousAmount: 80, newAmount: 100 };
    const attribution: EarningsAttribution = {
      id: "a1", userId: "u1", snapshotId: late.id, amount: 20, status: "resolved", mode: "shift_distributed",
      attributedDayDate: d.date, shiftId: shift.id, effectiveStartAt: shift.startTime, effectiveEndAt: shift.endTime,
      source: "user", confidence: "estimated", createdAt: `${d.date}T20:01:00`, updatedAt: `${d.date}T20:01:00`,
    };

    expect(resolveShiftRate(d, shift, [late], [attribution], [week([d])])).toMatchObject({ earnings: 100, rate: 50 });
  });

  it("resolves shift rates from same-shift earnings snapshots", () => {
    const firstShift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00" };
    const secondShift = { id: "s2", startTime: "2026-05-04T12:00:00", endTime: "2026-05-04T14:00:00" };
    const d = day(0, 200, [firstShift, secondShift]);
    const snapshots: EarningsSnapshot[] = [
      { ...snapshot("snap1", "2026-05-04", "Uber", 50, "2026-05-04T08:30:00"), shiftId: "s1" },
      { ...snapshot("snap2", "2026-05-04", "Uber", 30, "2026-05-04T09:15:00"), shiftId: "s1" },
      { ...snapshot("snap3", "2026-05-04", "Uber", 120, "2026-05-04T12:30:00"), shiftId: "s2" },
    ];

    expect(resolveShiftRate(d, firstShift, snapshots)).toMatchObject({ rate: 40, earnings: 80, source: "snapshot" });
    expect(resolveShiftRate(d, secondShift, snapshots)).toMatchObject({ rate: 60, earnings: 120, source: "snapshot" });
  });

  it("keeps multi-shift rates unavailable when no shift earnings can be assigned", () => {
    const firstShift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00" };
    const secondShift = { id: "s2", startTime: "2026-05-04T12:00:00", endTime: "2026-05-04T14:00:00" };
    const d = day(0, 200, [firstShift, secondShift]);

    expect(resolveShiftRate(d, firstShift).rate).toBeNull();
    expect(resolveShiftRate(d, secondShift).rate).toBeNull();
  });

  it("falls back to day operational earnings for a single completed shift", () => {
    const shift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00" };
    const d = { ...day(0, 0, [shift]), apps: { Uber: 100, Octopus: 25 } };

    expect(resolveShiftRate(d, shift)).toMatchObject({ rate: 50, earnings: 100, source: "single-shift-day" });
  });

  it("reconciles a corrected accumulated total before resolving a single-shift rate", () => {
    const shift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00" };
    const d = { ...day(0, 160, [shift]), apps: { Uber: 160 } };
    const base = { userId: "u1", weekId: "w1", dayDate: d.date, app: "Uber", shiftId: shift.id };
    const snapshots: EarningsSnapshot[] = [
      { ...base, id: "first", previousAmount: 0, newAmount: 100, delta: 100, createdAt: "2026-05-04T08:30:00" },
      { ...base, id: "mistake", previousAmount: 100, newAmount: 35, delta: -65, createdAt: "2026-05-04T09:00:00" },
      { ...base, id: "recovery", previousAmount: 35, newAmount: 135, delta: 100, createdAt: "2026-05-04T09:01:00" },
      { ...base, id: "new-income", previousAmount: 135, newAmount: 160, delta: 25, createdAt: "2026-05-04T09:30:00" },
    ];

    expect(resolveShiftRate(d, shift, snapshots, [], [week([d])])).toMatchObject({
      earnings: 160,
      rate: 80,
      source: "snapshot",
    });
  });

  it("keeps the operations headline tied to the final weekly operational total after corrections", () => {
    const shift = { id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00" };
    const d = { ...day(0, 160, [shift]), apps: { Uber: 160 } };
    const base = { userId: "u1", weekId: "w1", dayDate: d.date, app: "Uber", shiftId: shift.id };
    const snapshots: EarningsSnapshot[] = [
      { ...base, id: "first", previousAmount: 0, newAmount: 100, delta: 100, createdAt: "2026-05-04T08:30:00" },
      { ...base, id: "mistake", previousAmount: 100, newAmount: 0, delta: -100, createdAt: "2026-05-04T09:00:00" },
      { ...base, id: "recovery", previousAmount: 0, newAmount: 160, delta: 160, createdAt: "2026-05-04T09:30:00" },
    ];

    const intelligence = buildPatternIntelligence([week([d])], snapshots);

    expect(intelligence.summary.earningsPerHour).toBe(80);
    expect(intelligence.summary.earningsPerMile).toBeNull();
  });

  it("builds pattern intelligence from completed shifts", () => {
    const weeks = [
      week([
        day(0, 240, [{ id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", miles: 24 }]),
        day(1, 180, [{ id: "s2", startTime: "2026-05-05T18:00:00", endTime: "2026-05-05T20:00:00", miles: 18, rideCount: 6 }]),
        day(2, 260, [{ id: "s3", startTime: "2026-05-06T08:00:00", endTime: "2026-05-06T10:00:00", miles: 22, rideCount: 8 }]),
        day(3, 0),
        day(4, 0),
        day(5, 0),
        day(6, 0),
      ]),
    ];

    const result = buildPatternIntelligence(weeks);

    expect(result.hasEnoughShiftData).toBe(true);
    expect(result.summary.totalHours).toBe(6);
    expect(result.summary.totalShifts).toBe(3);
    expect(result.summary.completedShifts).toBe(3);
    expect(result.summary.workDays).toBe(3);
    expect(result.summary.averageShiftHours).toBe(2);
    expect(result.summary.totalMiles).toBe(64);
    expect(result.summary.totalRides).toBe(14);
    expect(result.summary.earningsPerHour).toBeCloseTo(113.33);
    expect(result.summary.earningsPerRide).toBeCloseTo(48.57);
    expect(result.summary.ridesPerHour).toBeCloseTo(2.33);
    expect(result.summary.milesPerHour).toBeCloseTo(10.67);
    expect(result.strongestHours.length).toBeGreaterThan(0);
    expect(result.bestAppsByHour.length).toBeGreaterThan(0);
    expect(result.timingSource).toBe("estimated");
    expect(result.timingCopy).toContain("spreading operational earnings");
  });

  it("classifies money, discipline, complete, and elite weeks separately", () => {
    expect(classifyWeeklyGoalOutcome({ earnings: 1000, earningsGoal: 1000, hours: 32, hoursGoal: 50 }).outcome).toBe("money-victory");
    expect(classifyWeeklyGoalOutcome({ earnings: 850, earningsGoal: 1000, hours: 50, hoursGoal: 50 }).outcome).toBe("discipline-victory");
    expect(classifyWeeklyGoalOutcome({ earnings: 1000, earningsGoal: 1000, hours: 50, hoursGoal: 50 }).outcome).toBe("complete-victory");
    expect(classifyWeeklyGoalOutcome({ earnings: 1250, earningsGoal: 1000, hours: 56, hoursGoal: 50 }).outcome).toBe("elite-week");
  });

  it("uses shift-safe update intervals instead of treating save time as earned time", () => {
    const weeks = [
      week([
        day(0, 240, [{ id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", miles: 24 }]),
        day(1, 180, [{ id: "s2", startTime: "2026-05-05T18:00:00", endTime: "2026-05-05T20:00:00", miles: 18 }]),
        day(2, 260, [{ id: "s3", startTime: "2026-05-06T08:00:00", endTime: "2026-05-06T10:00:00", miles: 22 }]),
        day(3, 0),
        day(4, 0),
        day(5, 0),
        day(6, 0),
      ]),
    ];
    const snapshots: EarningsSnapshot[] = [
      { ...snapshot("snap1", "2026-05-04", "Uber", 50, "2026-05-04T08:30:00"), shiftId: "s1" },
      { ...snapshot("snap2", "2026-05-04", "Uber", 20, "2026-05-04T09:15:00"), previousAmount: 50, newAmount: 70, shiftId: "s1" },
      { ...snapshot("snap3", "2026-05-05", "Spark Driver", 15, "2026-05-05T18:15:00"), shiftId: "s2" },
    ];

    const result = buildPatternIntelligence(weeks, snapshots);

    expect(result.timingSource).toBe("snapshot");
    expect(result.timingSourceLabel).toBe("Attributed earnings timing");
    expect(result.hourlyHeatmap.find((item) => item.hour === 20)?.earnings).toBe(0);
    expect(result.hourlyHeatmap.find((item) => item.hour === 8)?.observations).toBe(2);
    expect(result.bestAppsByHour[0].app).toBe("Uber");
  });

  it("updates operations metrics while an attributed shift remains open", () => {
    const active = { id: "live", startTime: "2026-05-04T08:00:00", blocks: [{ id: "live-block", startTime: "2026-05-04T08:00:00" }] };
    const liveDay = day(0, 110, [active]);
    const liveWeek = week([liveDay]);
    const liveSnapshot = { ...snapshot("live-snapshot", liveDay.date, "Uber", 110, "2026-05-04T11:00:00"), shiftId: active.id };
    const liveAttribution: EarningsAttribution = {
      id: "live-attribution", userId: "u1", snapshotId: liveSnapshot.id, amount: 110, status: "resolved", mode: "update_interval",
      attributedDayDate: liveDay.date, shiftId: active.id, effectiveStartAt: active.startTime, effectiveEndAt: liveSnapshot.createdAt,
      source: "automatic", confidence: "estimated", createdAt: liveSnapshot.createdAt, updatedAt: liveSnapshot.createdAt,
    };

    const result = buildPatternIntelligence([liveWeek], [liveSnapshot], [liveAttribution], new Date("2026-05-04T11:00:00"));

    expect(result.summary.activeShifts).toBe(1);
    expect(result.summary.completedShifts).toBe(0);
    expect(result.summary.totalHours).toBe(3);
    expect(result.summary.earningsPerHour).toBeCloseTo(36.67);
    expect(result.hourlyHeatmap.find((item) => item.hour === 10)?.earnings).toBeGreaterThan(0);
  });

  it("deduplicates repeated earning snapshot transitions in observed timing", () => {
    const weeks = [
      week([
        day(0, 240, [{ id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", miles: 24 }]),
        day(1, 180, [{ id: "s2", startTime: "2026-05-05T18:00:00", endTime: "2026-05-05T20:00:00", miles: 18 }]),
        day(2, 260, [{ id: "s3", startTime: "2026-05-06T08:00:00", endTime: "2026-05-06T10:00:00", miles: 22 }]),
        day(3, 0),
        day(4, 0),
        day(5, 0),
        day(6, 0),
      ]),
    ];
    const snapshots: EarningsSnapshot[] = [
      { ...snapshot("snap1", "2026-05-04", "Uber", 29.93, "2026-05-04T08:05:00"), previousAmount: 0, newAmount: 29.93, shiftId: "s1" },
      { ...snapshot("snap2", "2026-05-04", "Uber", 29.93, "2026-05-04T08:05:01"), previousAmount: 0, newAmount: 29.93, shiftId: "s1" },
      { ...snapshot("snap3", "2026-05-04", "Uber", 20, "2026-05-04T08:45:00"), previousAmount: 29.93, newAmount: 49.93, shiftId: "s1" },
      { ...snapshot("snap4", "2026-05-05", "Spark Driver", 15, "2026-05-05T18:15:00"), shiftId: "s2" },
    ];

    const result = buildPatternIntelligence(weeks, snapshots);

    expect(result.timingSource).toBe("snapshot");
    expect(result.hourlyHeatmap.find((item) => item.hour === 8)?.observations).toBe(2);
  });

  it("keeps late earning adjustments out of observed timing while the headline uses the final operational total", () => {
    const weeks = [
      week([
        day(0, 240, [{ id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", miles: 24 }]),
        day(1, 180, [{ id: "s2", startTime: "2026-05-05T18:00:00", endTime: "2026-05-05T20:00:00", miles: 18 }]),
        day(2, 260, [{ id: "s3", startTime: "2026-05-06T08:00:00", endTime: "2026-05-06T10:00:00", miles: 22 }]),
        day(3, 0),
        day(4, 0),
        day(5, 0),
        day(6, 0),
      ]),
    ];
    const snapshots: EarningsSnapshot[] = [
      snapshot("late1", "2026-05-04", "Uber", 30, "2026-05-20T21:00:00"),
      snapshot("late2", "2026-05-05", "Uber", 25, "2026-05-20T21:15:00"),
      snapshot("late3", "2026-05-06", "Spark Driver", 20, "2026-05-20T21:30:00"),
    ];

    const result = buildPatternIntelligence(weeks, snapshots);

    expect(result.timingSource).toBe("estimated");
    expect(result.timingCopy).toContain("spreading operational earnings");
    expect(result.summary.earningsPerHour).toBeCloseTo(113.33);
  });

  it("excludes Octopus reward income from operational shift efficiency", () => {
    const weeks = [
      week([
        {
          ...day(0, 0, [{ id: "s1", startTime: "2026-05-04T08:00:00", endTime: "2026-05-04T10:00:00", miles: 24 }]),
          logged: true,
          apps: { Uber: 100, Octopus: 25 },
        },
        day(1, 0),
        day(2, 0),
        day(3, 0),
        day(4, 0),
        day(5, 0),
        day(6, 0),
      ]),
    ];
    const snapshots: EarningsSnapshot[] = [
      snapshot("snap1", "2026-05-04", "Octopus", 25, "2026-05-04T08:05:00"),
      { ...snapshot("snap2", "2026-05-04", "Uber", 40, "2026-05-04T08:15:00"), previousAmount: 0, newAmount: 40, shiftId: "s1" },
      { ...snapshot("snap3", "2026-05-04", "Uber", 30, "2026-05-04T08:45:00"), previousAmount: 40, newAmount: 70, shiftId: "s1" },
      { ...snapshot("snap4", "2026-05-04", "Uber", 30, "2026-05-04T09:00:00"), previousAmount: 70, newAmount: 100, shiftId: "s1" },
    ];

    const result = buildPatternIntelligence(weeks, snapshots);

    expect(result.summary.earningsPerHour).toBe(50);
    expect(result.summary.earningsPerMile).toBeCloseTo(4.17);
    expect(result.timingSource).toBe("snapshot");
    expect(result.hourlyHeatmap.find((item) => item.hour === 8)?.earnings).toBe(100);
    expect(result.bestAppsByHour[0].app).toBe("Uber");
  });
});

function snapshot(
  id: string,
  dayDate: string,
  app: string,
  delta: number,
  createdAt: string,
): EarningsSnapshot {
  return {
    id,
    userId: "u1",
    weekId: "w1",
    dayDate,
    app,
    previousAmount: 0,
    newAmount: delta,
    delta,
    shiftId: null,
    createdAt,
  };
}
