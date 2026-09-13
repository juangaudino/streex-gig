import {
  dayShiftStats,
  dayTotal,
  normalizeAppTotals,
  operationalDayTotal,
} from "../../supabase/functions/_shared/dailyOps";

describe("daily operations canonical calculations", () => {
  it("keeps reported earnings and operational earnings distinct", () => {
    const day = {
      date: "2026-09-12",
      apps: { Uber: 100, Octopus: 5 },
      bonuses: [{ app: "Uber", amount: 10 }],
      shifts: [{ startTime: "2026-09-12T10:00:00Z", endTime: "2026-09-12T12:30:00Z", miles: 42, rideCount: 4 }],
    };

    expect(dayTotal(day)).toBe(115);
    expect(operationalDayTotal(day)).toBe(100);
    expect(normalizeAppTotals(day)).toEqual({ uber: 110, octopus: 5 });
  });

  it("uses completed shift durations and falls back to day mileage", () => {
    expect(dayShiftStats({
      date: "2026-09-12",
      apps: {},
      mileage: 18,
      shifts: [
        { startTime: "2026-09-12T10:00:00Z", endTime: "2026-09-12T11:30:00Z", rideCount: 2 },
        { startTime: "2026-09-12T12:00:00Z", rideCount: 1 },
      ],
    })).toEqual({ hours: 1.5, rides: 3, miles: 18, completedShifts: 1, activeShifts: 1 });
  });
});
