/**
 * Push local secrets into an Azure Key Vault, mapping env-var names to the
 * Key Vault secret names that `infra/main.bicep` declares.
 *
 *   npm run keyvault:push -- --vault barber-staging-kv-xxxx --file .env.staging
 *   npm run keyvault:push -- --vault ... --file ... --dry-run
 *
 * The `--file` is a plain `KEY=value` file you keep LOCAL and GIT-IGNORED
 * (`.env.staging` / `.env.production` are already ignored). This script:
 *   - never prints a secret value (only the var name + "queued"/"ok")
 *   - shells out to `az keyvault secret set` (requires `az login` first)
 *   - skips vars that are empty or not in the mapping
 *   - is idempotent (Key Vault versions the secret)
 */
/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// env var  ->  Key Vault secret name (must match infra/main.bicep `secrets[]`)
const MAP: Record<string, string> = {
  AUTH_SECRET: "auth-secret",
  STRIPE_SECRET_KEY: "stripe-secret-key",
  STRIPE_PUBLISHABLE_KEY: "stripe-publishable-key",
  STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret",
  STRIPE_CONNECT_WEBHOOK_SECRET: "stripe-connect-webhook-secret",
  RESEND_API_KEY: "resend-api-key",
  ANTHROPIC_API_KEY: "anthropic-api-key",
  WHATSAPP_PHONE_NUMBER_ID: "whatsapp-phone-number-id",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "whatsapp-business-account-id",
  WHATSAPP_ACCESS_TOKEN: "whatsapp-access-token",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "whatsapp-webhook-verify-token",
  WHATSAPP_APP_SECRET: "whatsapp-app-secret",
  SENTRY_DSN: "sentry-dsn",
};

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const vault = opt("vault");
const file = opt("file");
const dryRun = args.includes("--dry-run");

if (!vault || !file) {
  console.error("usage: npm run keyvault:push -- --vault <kv-name> --file <.env.xxx> [--dry-run]");
  process.exit(1);
}

const parsed: Record<string, string> = {};
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  parsed[k] = v;
}

console.log(`\nKey Vault: ${vault}  ·  source: ${file}${dryRun ? "  ·  DRY RUN" : ""}\n`);
let pushed = 0;
let skipped = 0;

for (const [envVar, secretName] of Object.entries(MAP)) {
  const value = parsed[envVar];
  if (value == null || value === "") {
    console.log(`  ·  ${envVar.padEnd(30)} → ${secretName.padEnd(32)} (empty, skipped)`);
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(
      `  ~  ${envVar.padEnd(30)} → ${secretName.padEnd(32)} (would set, ${value.length} chars)`,
    );
    pushed++;
    continue;
  }
  try {
    execFileSync(
      "az",
      [
        "keyvault",
        "secret",
        "set",
        "--vault-name",
        vault,
        "--name",
        secretName,
        "--value",
        value,
        "--output",
        "none",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    console.log(`  ✓  ${envVar.padEnd(30)} → ${secretName}`);
    pushed++;
  } catch {
    console.log(
      `  ✗  ${envVar.padEnd(30)} → ${secretName}  (az command failed — are you logged in?)`,
    );
  }
}

console.log(
  `\n${pushed} secret(s) ${dryRun ? "would be set" : "set"}, ${skipped} skipped (empty).`,
);
console.log(
  "Reminder: database-url / redis-url / azure-storage-connection-string are\n" +
    "derived by the Bicep from the provisioned resources — do not set them here.\n",
);
