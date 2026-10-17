import { describe, expect, it } from "vitest";
import { getOperationalDate, OPERATIONAL_DAY_BOUNDARY_HOUR } from "./operationalDay";

describe("operational day", () => {
  it("uses 4 a.m. local time as the business-day boundary", () => {
    expect(OPERATIONAL_DAY_BOUNDARY_HOUR).toBe(4);
    expect(getOperationalDate(new Date(2026, 8, 12, 3, 59, 59))).toBe("2026-09-11");
    expect(getOperationalDate(new Date(2026, 8, 12, 4, 0, 0))).toBe("2026-09-12");
  });

  it("uses local calendar arithmetic around daylight-saving transitions", () => {
    expect(getOperationalDate(new Date(2026, 2, 8, 3, 30, 0))).toBe("2026-03-07");
  });
});
