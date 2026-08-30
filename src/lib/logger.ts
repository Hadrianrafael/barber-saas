import pino from "pino";
import { env } from "@/env";

/**
 * Structured logger. In production, JSON to stdout (Azure Container Apps →
 * Log Analytics). In dev, pretty-printed. Never log secrets or full PII.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "*.password",
      "*.token",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
});
