import { describe, it, expect } from "vitest";
import { segmentWhere, SEGMENT_IDS } from "@/features/crm/segments";

describe("segmentWhere", () => {
  it("all → no constraint", () => {
    expect(segmentWhere("all")).toEqual({});
  });

  it("inactive → never visited or long ago", () => {
    const w = segmentWhere("inactive", { inactiveDays: 30 });
    expect(w.status).toEqual({ not: "BLOCKED" });
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR).toContainEqual({ lastVisitAt: null });
  });

  it("new → created within window", () => {
    const w = segmentWhere("new", { newDays: 14 });
    expect(w.createdAt).toHaveProperty("gte");
  });

  it("recurring → 2+ visits", () => {
    expect(segmentWhere("recurring")).toEqual({ visitsCount: { gte: 2 } });
  });

  it("by_service / by_employee require the param", () => {
    expect(segmentWhere("by_service")).toEqual({});
    expect(segmentWhere("by_service", { serviceId: "s1" })).toEqual({
      appointments: { some: { serviceId: "s1" } },
    });
    expect(segmentWhere("by_employee", { employeeId: "e1" })).toEqual({
      appointments: { some: { employeeId: "e1" } },
    });
  });

  it("opted_in → granted consent on a channel", () => {
    const w = segmentWhere("opted_in", { channel: "EMAIL" });
    expect(w.consents).toEqual({
      some: { channel: "EMAIL", granted: true, revokedAt: null },
    });
  });

  it("every id is handled", () => {
    for (const id of SEGMENT_IDS) expect(() => segmentWhere(id)).not.toThrow();
  });
});
