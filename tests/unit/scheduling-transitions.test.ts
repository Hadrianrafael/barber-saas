import { describe, it, expect } from "vitest";
import {
  canTransition,
  ALLOWED_TRANSITIONS,
  SLOT_HOLDING_STATUSES,
  RESCHEDULABLE_STATUSES,
} from "@/features/scheduling/constants";

describe("appointment status transitions", () => {
  it("PENDING can be confirmed, started, canceled or marked no-show", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canTransition("PENDING", "CANCELED")).toBe(true);
    expect(canTransition("PENDING", "NO_SHOW")).toBe(true);
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
  });

  it("CONFIRMED progresses to in-progress or completed", () => {
    expect(canTransition("CONFIRMED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransition("CONFIRMED", "PENDING")).toBe(false);
  });

  it("IN_PROGRESS only completes or cancels", () => {
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "CANCELED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "NO_SHOW")).toBe(false);
  });

  it("terminal states are terminal", () => {
    for (const s of ["COMPLETED", "CANCELED", "NO_SHOW"] as const) {
      expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("only pending/confirmed appointments are reschedulable", () => {
    expect(RESCHEDULABLE_STATUSES).toEqual(["PENDING", "CONFIRMED"]);
  });

  it("slot-holding set matches the DB overlap constraint WHERE list", () => {
    expect(new Set(SLOT_HOLDING_STATUSES)).toEqual(
      new Set(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"]),
    );
  });
});
