import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeEmail, isEmail, dedupeKey } from "@/features/sdr/phone";
import { autoMap } from "@/features/sdr/schema";
import { detectOptOut } from "@/features/sdr/suppression";
import { scoreSignals, type QualSignals } from "@/features/sdr/qualification";
import { localWindow } from "@/features/sdr/campaigns";
import { renderTemplate } from "@/features/sdr/conversation";

describe("sdr/phone", () => {
  it("normalizes bare BR numbers to 55 + DDD + number", () => {
    expect(normalizePhone("(11) 99999-0000")).toBe("5511999990000");
    expect(normalizePhone("11 3333-4444")).toBe("551133334444");
    expect(normalizePhone("+55 11 99999-0000")).toBe("5511999990000");
    expect(normalizePhone("0011999990000")).toBe("5511999990000");
  });

  it("rejects too-short / empty", () => {
    expect(normalizePhone("123")).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });

  it("email helpers", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(isEmail("foo@bar.com")).toBe(true);
    expect(isEmail("nope")).toBe(false);
  });

  it("dedupeKey prefers phone, then email, else null", () => {
    expect(dedupeKey({ whatsapp: "(11) 99999-0000" })).toBe("p:5511999990000");
    expect(dedupeKey({ phone: "11 99999-0000", email: "a@b.com" })).toBe("p:5511999990000");
    expect(dedupeKey({ email: "A@B.com" })).toBe("e:a@b.com");
    expect(dedupeKey({ email: "bad" })).toBeNull();
    expect(dedupeKey({})).toBeNull();
  });
});

describe("sdr/schema autoMap", () => {
  it("maps pt / en / es headers", () => {
    expect(autoMap(["Nome", "Barbearia", "WhatsApp", "E-mail", "Cidade", "xyz"])).toEqual([
      "name",
      "barbershopName",
      "whatsapp",
      "email",
      "city",
      null,
    ]);
    expect(autoMap(["telefone", "correo", "estado"])).toEqual(["phone", "email", "state"]);
  });
});

describe("sdr/suppression detectOptOut", () => {
  it("catches stop intent in pt / en / es", () => {
    for (const s of [
      "PARE",
      "para de me mandar mensagem",
      "não tenho interesse",
      "quero me descadastrar",
      "stop",
      "please unsubscribe",
      "do not contact me",
      "dar de baja",
    ]) {
      expect(detectOptOut(s), s).toBe(true);
    }
  });

  it("does not flag normal replies", () => {
    for (const s of [
      "quanto custa?",
      "pode me mandar mais info",
      "tenho 3 barbeiros",
      "que legal",
    ]) {
      expect(detectOptOut(s), s).toBe(false);
    }
  });
});

describe("sdr/qualification scoreSignals", () => {
  it("cold by default", () => {
    expect(scoreSignals({}).tier).toBe("FRIO");
  });

  it("hot when strong interest + demo + budget", () => {
    const s: QualSignals = {
      interest: "high",
      wantsDemo: true,
      budgetSignal: "clear",
      urgency: "now",
    };
    const r = scoreSignals(s);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.tier).toBe("QUENTE");
  });

  it("explicit human request weighs heavily and never stays cold", () => {
    const r = scoreSignals({ wantsHuman: true, interest: "high" });
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.tier).not.toBe("FRIO");
    // and combined with a demo ask it is unambiguously hot
    expect(scoreSignals({ wantsHuman: true, interest: "high", wantsDemo: true }).tier).toBe(
      "QUENTE",
    );
  });

  it("respects configured thresholds", () => {
    const cfg = { qualificationRules: { hotThreshold: 20, warmThreshold: 10 } } as never;
    expect(scoreSignals({ interest: "medium" }, cfg).tier).toBe("MORNO");
  });
});

describe("sdr/campaigns localWindow", () => {
  it("computes weekday + minute-of-day for a timezone", () => {
    // 2026-01-05 is a Monday. 12:00 UTC → 09:00 in America/Sao_Paulo (UTC-3).
    const w = localWindow(new Date("2026-01-05T12:00:00Z"), "America/Sao_Paulo");
    expect(w.weekday).toBe(1);
    expect(w.minutes).toBe(9 * 60);
  });
});

describe("sdr/conversation renderTemplate", () => {
  it("substitutes {{vars}} and blanks unknowns", () => {
    expect(
      renderTemplate("Oi {{nome}}, da {{empresa}}!", { nome: "Ana", empresa: "HR Tech" }),
    ).toBe("Oi Ana, da HR Tech!");
    expect(renderTemplate("Oi {{nome}}", {})).toBe("Oi ");
  });
});
