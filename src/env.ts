import { z } from "zod";

/**
 * Centralised, validated environment access.
 *
 * - Import from server code only (`import { env } from "@/env"`).
 * - The process refuses to boot if required vars are missing/invalid.
 * - Optional integration blocks (Stripe, WhatsApp, Resend, Azure Blob, LLM) are
 *   allowed to be empty; feature code checks `isConfigured.*` before using them
 *   and degrades cleanly (console e-mail transport, local disk storage, 503 on
 *   chatbot, etc.) instead of pretending an integration works.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  APP_URL: z.string().url(),
  APP_LOCALES: z.string().default("pt-BR,en,es"),
  APP_DEFAULT_LOCALE: z.string().default("pt-BR"),

  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url().optional().or(z.literal("")),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  AUTH_SECRET: z.string().min(24, "AUTH_SECRET must be at least 24 chars"),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  ADMIN_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 12),

  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Barber SaaS <no-reply@example.com>"),

  AZURE_STORAGE_CONNECTION_STRING: z.string().optional().default(""),
  AZURE_STORAGE_CONTAINER: z.string().default("uploads"),
  STORAGE_PUBLIC_URL: z.string().optional().default(""),

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_PUBLISHABLE_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PRICING_TABLE_ID: z.string().optional().default(""),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional().default(""),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  CHATBOT_MODEL: z.string().default("claude-sonnet-5"),

  SENTRY_DSN: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`\n❌ Invalid environment variables:\n${issues}\n`);
  throw new Error("Invalid environment configuration. See errors above.");
}

export const env = parsed.data;

export const locales = env.APP_LOCALES.split(",").map((l) => l.trim());
export const defaultLocale = env.APP_DEFAULT_LOCALE;

/** Feature availability derived from which integration secrets are present. */
export const isConfigured = {
  resend: env.RESEND_API_KEY.length > 0,
  azureBlob: env.AZURE_STORAGE_CONNECTION_STRING.length > 0,
  stripe: env.STRIPE_SECRET_KEY.length > 0 && env.STRIPE_WEBHOOK_SECRET.length > 0,
  stripeConnect: env.STRIPE_SECRET_KEY.length > 0 && env.STRIPE_CONNECT_WEBHOOK_SECRET.length > 0,
  whatsapp: env.WHATSAPP_ACCESS_TOKEN.length > 0 && env.WHATSAPP_PHONE_NUMBER_ID.length > 0,
  chatbot: env.ANTHROPIC_API_KEY.length > 0,
} as const;

export type IntegrationName = keyof typeof isConfigured;
