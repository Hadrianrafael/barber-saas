import { z } from "zod";

/**
 * Per-tenant chatbot configuration, persisted as `Tenant.chatbotConfig` (JSON)
 * and validated here. Kept small and declarative — the assistant's *capabilities*
 * are fixed in code (see `tools.ts`); this only tunes voice and availability.
 */
export const chatbotConfigSchema = z.object({
  /** Master switch. Off ⇒ the widget still opens but every message goes straight
   *  to the human queue (status PENDING_HUMAN), the model is never called. */
  enabled: z.boolean().default(false),
  /** Name shown in the chat header. */
  displayName: z.string().trim().min(1).max(40).default("Assistente"),
  /** First message, per UI locale. Empty ⇒ a built-in default is used. */
  greeting: z
    .object({
      "pt-BR": z.string().max(400).default(""),
      en: z.string().max(400).default(""),
      es: z.string().max(400).default(""),
    })
    .default({ "pt-BR": "", en: "", es: "" }),
  /** Free-text house style / extra instructions appended to the system prompt.
   *  Cannot grant capabilities — tool access is fixed. */
  instructions: z.string().max(2000).default(""),
  /** If a customer message contains one of these (case-insensitive), hand off
   *  to a human immediately without calling the model. */
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
});

export type ChatbotConfig = z.infer<typeof chatbotConfigSchema>;

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = chatbotConfigSchema.parse({});

export function parseChatbotConfig(value: unknown): ChatbotConfig {
  const r = chatbotConfigSchema.safeParse(value ?? {});
  return r.success ? r.data : DEFAULT_CHATBOT_CONFIG;
}

const BUILTIN_GREETING: Record<string, string> = {
  "pt-BR": "Olá! Posso ajudar com agendamentos, serviços e preços. Como posso ajudar?",
  en: "Hi! I can help with bookings, services and prices. How can I help?",
  es: "¡Hola! Puedo ayudarte con reservas, servicios y precios. ¿En qué te ayudo?",
};

export function greetingFor(cfg: ChatbotConfig, locale: string): string {
  const key = locale in BUILTIN_GREETING ? locale : "pt-BR";
  return cfg.greeting[key as keyof ChatbotConfig["greeting"]] || BUILTIN_GREETING[key]!;
}
