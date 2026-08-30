import { describe, it, expect } from "vitest";
import {
  chatbotConfigSchema,
  parseChatbotConfig,
  greetingFor,
  DEFAULT_CHATBOT_CONFIG,
} from "@/features/chatbot/config";
import { detectLocale } from "@/features/chatbot/language";

describe("chatbotConfigSchema", () => {
  it("fills safe defaults and stays disabled by default", () => {
    expect(DEFAULT_CHATBOT_CONFIG.enabled).toBe(false);
    expect(DEFAULT_CHATBOT_CONFIG.displayName).toBeTruthy();
  });

  it("accepts a partial config", () => {
    const c = parseChatbotConfig({ enabled: true, displayName: "Léo" });
    expect(c.enabled).toBe(true);
    expect(c.displayName).toBe("Léo");
    expect(c.handoffKeywords).toEqual([]);
  });

  it("rejects an over-long keyword list and falls back to safe defaults", () => {
    const c = parseChatbotConfig({ enabled: true, handoffKeywords: Array(30).fill("x") });
    expect(c).toEqual(DEFAULT_CHATBOT_CONFIG); // invalid → disabled default, never a half-applied config
  });

  it("keeps a valid keyword list", () => {
    const c = chatbotConfigSchema.parse({ handoffKeywords: ["gerente", "reclamação"] });
    expect(c.handoffKeywords).toEqual(["gerente", "reclamação"]);
  });
});

describe("greetingFor", () => {
  it("uses the tenant greeting when set, else a builtin in the right language", () => {
    const cfg = parseChatbotConfig({ greeting: { "pt-BR": "Oi!", en: "", es: "" } });
    expect(greetingFor(cfg, "pt-BR")).toBe("Oi!");
    expect(greetingFor(cfg, "en").toLowerCase()).toContain("help");
    expect(greetingFor(cfg, "es").toLowerCase()).toContain("ayud");
    expect(greetingFor(cfg, "fr")).toBe(greetingFor(cfg, "pt-BR")); // unknown → pt-BR
  });
});

describe("detectLocale", () => {
  it("recognises each supported language", () => {
    expect(detectLocale("Olá, quero agendar um corte")).toBe("pt-BR");
    expect(detectLocale("Hi, I want to book a haircut")).toBe("en");
    expect(detectLocale("Hola, quiero reservar un turno")).toBe("es");
  });
  it("falls back when nothing matches", () => {
    expect(detectLocale("...", "en")).toBe("en");
  });
});
