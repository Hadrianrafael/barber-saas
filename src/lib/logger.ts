import pino from "pino";
import { env } from "@/env";

/**
 * Structured logger — JSON to stdout (Azure Container Apps → Log Analytics).
 *
 * We deliberately do NOT use the `pino-pretty` transport here: it spawns a
 * worker thread whose file path breaks under the Next.js dev-server bundler
 * (`Cannot find module .next/server/vendor-chunks/lib/worker.js`). JSON logs are
 * fine in dev; pipe through `pino-pretty` on the CLI if you want colour:
 *   npm run dev | npx pino-pretty
 *
 * Never log secrets or full PII — see the redact list.
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
});
