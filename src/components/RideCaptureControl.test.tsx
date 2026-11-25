import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RideCaptureControl from "./RideCaptureControl";
import { getOperationalDate } from "@/lib/operationalDay";
import type { WeekRecord } from "@/lib/types";

vi.mock("@/lib/movementCapture", () => ({ captureForegroundZone: vi.fn(async () => ({ status: "unavailable" })) }));

describe("RideCaptureControl", () => {
  it("shows an error and unlocks the button if saving throws", async () => {
    const today = getOperationalDate();
    const week = { id: "week", entries: [{ date: today, shifts: [{ id: "shift", startTime: new Date().toISOString() }] }] } as WeekRecord;
    const onStart = vi.fn().mockRejectedValue(new Error("offline"));
    render(<RideCaptureControl openWeek={week} apps={["Uber"]} rideEvents={[]} onStart={onStart} onPickup={vi.fn()} onFinish={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "En route" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("Refresh before trying again");
    expect(screen.getByRole("button", { name: "En route" })).toBeEnabled();
  });
});
