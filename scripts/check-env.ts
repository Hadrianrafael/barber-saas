/**
 * Environment / configuration validator. Run before a deploy or after wiring
 * Key Vault.
 *
 *   npm run check:env
 *
 * Reports which required vars are present and which optional integrations are
 * configured. NEVER prints a secret value — only "set" / "missing" and, for a
 * few ids, a masked hint (first 3 + last 2 chars).
 *
 * Exit code: 0 if all REQUIRED vars are valid, 1 otherwise.
 */
/* eslint-disable no-console */

const REQUIRED = ["DATABASE_URL", "REDIS_URL", "AUTH_SECRET", "APP_URL"] as const;

const OPTIONAL_GROUPS: { name: string; vars: string[]; needAll?: boolean }[] = [
  {
    name: "Stripe (SaaS billing)",
    vars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    needAll: true,
  },
  {
    name: "Stripe Connect",
    vars: ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"],
    needAll: true,
  },
  { name: "Stripe Tax", vars: ["STRIPE_TAX_ENABLED"] },
  { name: "Stripe (extra)", vars: ["STRIPE_PUBLISHABLE_KEY"] },
  { name: "Resend e-mail", vars: ["RESEND_API_KEY", "EMAIL_FROM"], needAll: true },
  {
    name: "WhatsApp Cloud API",
    vars: [
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      "WHATSAPP_APP_SECRET",
    ],
    needAll: true,
  },
  { name: "AI chatbot (Anthropic)", vars: ["ANTHROPIC_API_KEY"], needAll: true },
  { name: "Azure Blob storage", vars: ["AZURE_STORAGE_CONNECTION_STRING"], needAll: true },
  { name: "Sentry", vars: ["SENTRY_DSN"] },
];

const NON_SECRET_HINTS = new Set([
  "APP_URL",
  "EMAIL_FROM",
  "STRIPE_TAX_ENABLED",
  "STRIPE_PUBLISHABLE_KEY",
]);

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function hint(name: string): string {
  const v = process.env[name] ?? "";
  if (NON_SECRET_HINTS.has(name)) return v;
  if (v.length < 8) return "set";
  return `${v.slice(0, 3)}…${v.slice(-2)} (${v.length} chars)`;
}

function mode(): string {
  const k = process.env.STRIPE_SECRET_KEY ?? "";
  if (!k) return "—";
  if (k.startsWith("sk_live_")) return "LIVE ⚠";
  if (k.startsWith("sk_test_")) return "test";
  return "unknown prefix ⚠";
}

let ok = true;
console.log(`\nEnvironment check — NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}\n`);

console.log("Required:");
for (const name of REQUIRED) {
  const has = present(name);
  ok &&= has;
  console.log(`  ${has ? "✓" : "✗"} ${name.padEnd(28)} ${has ? hint(name) : "MISSING"}`);
}
// AUTH_SECRET length sanity
if (present("AUTH_SECRET") && (process.env.AUTH_SECRET ?? "").length < 24) {
  ok = false;
  console.log("  ✗ AUTH_SECRET is shorter than 24 chars — generate `openssl rand -base64 48`");
}

console.log("\nOptional integrations:");
for (const g of OPTIONAL_GROUPS) {
  const set = g.vars.filter(present);
  const configured = g.needAll ? set.length === g.vars.length : set.length > 0;
  const partial = set.length > 0 && !configured;
  const mark = configured ? "✓ configured" : partial ? "◐ PARTIAL" : "· not configured";
  console.log(`  ${mark.padEnd(16)} ${g.name}`);
  if (partial) {
    for (const v of g.vars) console.log(`       ${present(v) ? "✓" : "✗"} ${v}`);
  }
}

console.log(`\nStripe mode: ${mode()}`);
console.log(`\n${ok ? "✓ required environment OK" : "✗ required environment INCOMPLETE"}\n`);
process.exit(ok ? 0 : 1);
