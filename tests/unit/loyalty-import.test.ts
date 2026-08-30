import { describe, it, expect } from "vitest";
import {
  parseLoyaltyConfig,
  pointsForVisit,
  DEFAULT_LOYALTY_CONFIG,
} from "@/features/loyalty/config";
import { parseCsv, mapHeader } from "@/features/import/csv";

describe("loyalty config + points", () => {
  it("defaults are safe and disabled", () => {
    expect(DEFAULT_LOYALTY_CONFIG.enabled).toBe(false);
    expect(DEFAULT_LOYALTY_CONFIG.pointsPerVisit).toBeGreaterThan(0);
  });

  it("pointsForVisit: flat + value bonus, service override wins", () => {
    const cfg = parseLoyaltyConfig({ pointsPerVisit: 10, pointsPerCurrencyCents: 100 });
    expect(pointsForVisit(cfg, 4500)).toBe(10 + 45);
    expect(pointsForVisit(cfg, 4500, 200)).toBe(200); // override
    expect(pointsForVisit(cfg, 4500, 0)).toBe(0); // explicit 0 override
  });

  it("no value bonus when pointsPerCurrencyCents is 0", () => {
    const cfg = parseLoyaltyConfig({ pointsPerVisit: 5, pointsPerCurrencyCents: 0 });
    expect(pointsForVisit(cfg, 99999)).toBe(5);
  });
});

describe("CSV parser", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    const grid = parseCsv('name,email\r\n"Silva, João",j@x.com\r\n"O ""Rei""",r@x.com\r\n');
    expect(grid).toEqual([
      ["name", "email"],
      ["Silva, João", "j@x.com"],
      ['O "Rei"', "r@x.com"],
    ]);
  });

  it("skips fully-blank lines and strips BOM", () => {
    const grid = parseCsv("﻿name\nAna\n\n\nBia\n");
    expect(grid).toEqual([["name"], ["Ana"], ["Bia"]]);
  });

  it("maps localized headers to known columns", () => {
    expect(mapHeader(["Nome", "E-mail", "Telefone", "xyz"])).toEqual([
      "name",
      "email",
      "phone",
      null,
    ]);
  });
});
