import { describe, it, expect } from "vitest";
import { interpolate, renderTemplate } from "@/features/messaging/templates";

describe("interpolate", () => {
  it("replaces vars and drops unknowns / collapses whitespace", () => {
    expect(
      interpolate("Hi {{name}}, at {{barbershop}}. {{missing}}", { name: "Ana", barbershop: "X" }),
    ).toBe("Hi Ana, at X.");
  });
});

describe("renderTemplate", () => {
  const vars = {
    name: "Ana",
    barbershop: "Barbearia X",
    barber: "Bruno",
    service: "Corte",
    datetime: "15 mar 09:00",
  };

  it("localises per locale", () => {
    expect(renderTemplate("appointment_confirmation", "WHATSAPP", "pt-BR", vars).text).toContain(
      "confirmado",
    );
    expect(renderTemplate("appointment_confirmation", "WHATSAPP", "en", vars).text).toContain(
      "confirmed",
    );
    expect(renderTemplate("appointment_confirmation", "WHATSAPP", "es", vars).text).toContain(
      "confirmada",
    );
  });

  it("EMAIL gets an html body + subject, WhatsApp does not", () => {
    const email = renderTemplate("appointment_reminder", "EMAIL", "pt-BR", vars);
    expect(email.subject).toBeTruthy();
    expect(email.html).toContain("<div");
    const wa = renderTemplate("appointment_reminder", "WHATSAPP", "pt-BR", vars);
    expect(wa.html).toBeNull();
  });

  it("applies a tenant override", () => {
    const r = renderTemplate("appointment_confirmation", "WHATSAPP", "pt-BR", vars, {
      subject: null,
      body: "Oi {{name}}, tudo certo pra {{datetime}}!",
    });
    expect(r.text).toBe("Oi Ana, tudo certo pra 15 mar 09:00!");
  });

  it("unknown locale falls back to pt-BR", () => {
    expect(renderTemplate("appointment_canceled", "WHATSAPP", "fr", vars).text).toContain(
      "cancelado",
    );
  });
});
