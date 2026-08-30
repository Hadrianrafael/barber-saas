import { describe, it, expect } from "vitest";
import {
  normalizeSlug,
  validateSlugFormat,
  checkSlug,
  generateUniqueSlug,
  isReservedSlug,
} from "@/features/tenant/slug";

describe("normalizeSlug", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeSlug("Barbearia São João")).toBe("barbearia-sao-joao");
    expect(normalizeSlug("  Corte & Barba!!  ")).toBe("corte-barba");
    expect(normalizeSlug("A---B")).toBe("a-b");
  });
  it("caps length at 40 with no trailing dash", () => {
    const s = normalizeSlug("x".repeat(50));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("validateSlugFormat", () => {
  it("flags too short / reserved / invalid", () => {
    expect(validateSlugFormat("ab")).toBe("too_short");
    expect(validateSlugFormat("admin")).toBe("reserved");
    expect(validateSlugFormat("has space")).toBe("invalid_chars");
    expect(validateSlugFormat("-lead")).toBe("invalid_chars");
    expect(validateSlugFormat("ok-slug-123")).toBeNull();
  });
  it("knows reserved words", () => {
    expect(isReservedSlug("dashboard")).toBe(true);
    expect(isReservedSlug("my-barbershop")).toBe(false);
  });
});

describe("checkSlug", () => {
  const exists = (taken: string[]) => async (s: string) => taken.includes(s);

  it("reports availability", async () => {
    expect(await checkSlug("Fade House", exists([]))).toEqual({
      slug: "fade-house",
      available: true,
      problem: null,
    });
  });
  it("reports taken", async () => {
    const r = await checkSlug("Fade House", exists(["fade-house"]));
    expect(r).toEqual({ slug: "fade-house", available: false, problem: "taken" });
  });
  it("reports reserved before hitting the DB", async () => {
    const r = await checkSlug("api", exists([]));
    expect(r.problem).toBe("reserved");
  });
});

describe("generateUniqueSlug", () => {
  it("returns the base when free", async () => {
    expect(await generateUniqueSlug("Kings Barber", async () => false)).toBe("kings-barber");
  });
  it("appends a numeric suffix on collision", async () => {
    const taken = new Set(["kings-barber", "kings-barber-2", "kings-barber-3"]);
    expect(await generateUniqueSlug("Kings Barber", async (s) => taken.has(s))).toBe(
      "kings-barber-4",
    );
  });
  it("avoids reserved bases", async () => {
    const out = await generateUniqueSlug("api", async () => false);
    expect(isReservedSlug(out)).toBe(false);
  });
});
