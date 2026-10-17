import { describe, expect, it } from "vitest";
import { dayTotal, weekTotal } from "./store";
import { buildEarningsCsv } from "./dataExport";
import { getWeekMiles, getWeekRideCount, getWeekShiftHours } from "./shiftIntelligence";
import { representativeAuditWeek } from "./auditFixtures";
import { inspectSnapshotIntegrity, inspectWeekIntegrity, parseWeekRecord } from "./weekIntegrity";

describe("canonical data integrity contracts", () => {
  it("accepts the representative multi-app and multi-shift week", () => {
    expect(parseWeekRecord(representativeAuditWeek)).toEqual(representativeAuditWeek);
    expect(inspectWeekIntegrity(representativeAuditWeek)).toEqual([]);
  });

  it("keeps canonical totals aligned across calculations and CSV", () => {
    expect(dayTotal(representativeAuditWeek.entries[0])).toBe(156.75);
    expect(weekTotal(representativeAuditWeek)).toBe(271.75);
    expect(getWeekMiles(representativeAuditWeek)).toBe(110.5);
    expect(getWeekRideCount(representativeAuditWeek)).toBe(13);
    expect(getWeekShiftHours(representativeAuditWeek)).toBe(8.5);
    const csv = buildEarningsCsv([representativeAuditWeek]);
    expect(csv).toContain("2026-06-29,2026-06-29,Monday,156.75,135.5,21.25");
    expect(csv).toContain(",48.5,3.5,6,true,");
  });

  it("does not flag a legacy same-date overnight shift as inverted", () => {
    const overnight = structuredClone(representativeAuditWeek);
    const day = overnight.entries[0];
    const shift = day.shifts![0];
    shift.startTime = `${day.date}T17:48:00`;
    shift.endTime = `${day.date}T01:03:00`;
    shift.blocks = [{ id: "overnight-block", startTime: shift.startTime, endTime: shift.endTime }];

    const issueCodes = inspectWeekIntegrity(overnight).map((issue) => issue.code);
    expect(issueCodes).not.toContain("INVERTED_SHIFT");
    expect(issueCodes).not.toContain("INVERTED_BLOCK");
    expect(issueCodes).not.toContain("BLOCK_OUTSIDE_SHIFT");
  });

  it("detects corrupt attribution, mileage, overlap and snapshot transitions", () => {
    const corrupt = structuredClone(representativeAuditWeek);
    corrupt.entries[0].shifts![0].rideCount = 2;
    corrupt.entries[0].shifts![0].miles = 80;
    corrupt.entries[0].shifts!.push({
      id: "overlap", startTime: "2026-06-29T11:00:00.000Z", endTime: "2026-06-29T13:00:00.000Z",
    });
    expect(inspectWeekIntegrity(corrupt).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "RIDES_ATTRIBUTION_EXCEEDS_TOTAL", "SHIFT_MILES_EXCEED_DAY", "OVERLAPPING_SHIFTS",
    ]));
    expect(parseWeekRecord(corrupt)).toEqual(corrupt);
    expect(() => parseWeekRecord({ ...corrupt, entries: "broken" })).toThrow();
    expect(inspectSnapshotIntegrity({
      id: "s1", userId: "u", weekId: representativeAuditWeek.id, dayDate: "2026-06-29", app: "Uber",
      previousAmount: 10, newAmount: 20, delta: 15, createdAt: "2026-06-29T10:00:00.000Z",
    }, representativeAuditWeek)[0]?.code).toBe("SNAPSHOT_DELTA_MISMATCH");
  });
});
