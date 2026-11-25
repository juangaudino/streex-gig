import { afterEach, describe, expect, it, vi } from "vitest";
import { captureForegroundZone, loadRideEventPages } from "./movementCapture";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("foreground ride capture", () => {
  it("continues without a zone if the browser never calls back", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn() } });
    const capture = captureForegroundZone();
    await vi.advanceTimersByTimeAsync(13_000);
    await expect(capture).resolves.toEqual({ status: "unavailable" });
  });

  it("continues without a zone if geolocation throws", async () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: () => { throw new Error("unavailable"); } } });
    await expect(captureForegroundZone()).resolves.toEqual({ status: "unavailable" });
  });

  it("loads a recent active ride beyond the API page limit", async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id, status: id === 1000 ? "active" : "completed" }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    const result = await loadRideEventPages(fetchPage);
    expect(result.data).toHaveLength(1001);
    expect(result.data?.at(-1)?.status).toBe("active");
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("does not treat a partial failed load as complete", async () => {
    const fetchPage = vi.fn(async (from: number) => from === 0
      ? { data: [1, 2], error: null }
      : { data: null, error: new Error("offline") });
    const result = await loadRideEventPages(fetchPage, 2);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
