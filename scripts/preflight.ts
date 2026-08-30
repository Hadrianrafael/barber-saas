/**
 * Pre-deploy connectivity check. Verifies the app can actually reach its
 * backing services with the credentials in the environment.
 *
 *   npm run preflight
 *
 * Checks: PostgreSQL, Redis, Azure Blob (if configured), Stripe (if configured).
 * NEVER prints a secret. Exit 0 if every configured dependency is reachable.
 */
/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

type Result = { name: string; status: "ok" | "fail" | "skip"; detail: string };
const results: Result[] = [];
const add = (name: string, status: Result["status"], detail = "") =>
  results.push({ name, status, detail });

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkPostgres() {
  const prisma = new PrismaClient();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 8000, "postgres");
    const rows = (await prisma.$queryRaw`SELECT count(*)::int AS n FROM "Plan"`) as { n: number }[];
    const n = rows[0]?.n ?? 0;
    add(
      "PostgreSQL",
      "ok",
      `connected · ${n} Plan row(s)${n === 0 ? " — run `npm run db:seed`" : ""}`,
    );
  } catch (e) {
    add("PostgreSQL", "fail", (e as Error).message);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function checkRedis() {
  if (!process.env.REDIS_URL) return add("Redis", "skip", "REDIS_URL not set");
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await withTimeout(r.connect(), 6000, "redis connect");
    const pong = await withTimeout(r.ping(), 3000, "redis ping");
    add("Redis", pong === "PONG" ? "ok" : "fail", `PING → ${pong}`);
  } catch (e) {
    add("Redis", "fail", (e as Error).message);
  } finally {
    r.disconnect();
  }
}

async function checkBlob() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return add("Azure Blob", "skip", "not configured (local-disk driver in use)");
  try {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const svc = BlobServiceClient.fromConnectionString(conn);
    const container = svc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER ?? "uploads");
    const exists = await withTimeout(container.exists(), 8000, "blob");
    add("Azure Blob", exists ? "ok" : "fail", exists ? "container reachable" : "container missing");
  } catch (e) {
    add("Azure Blob", "fail", (e as Error).message);
  }
}

async function checkStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return add("Stripe", "skip", "STRIPE_SECRET_KEY not set");
  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
    const acct = await withTimeout(stripe.accounts.retrieve(), 10000, "stripe");
    const live = key.startsWith("sk_live_");
    add(
      "Stripe",
      "ok",
      `${live ? "LIVE ⚠" : "test"} · account ${acct.id} · country ${acct.country ?? "?"} · ` +
        `charges ${acct.charges_enabled ? "on" : "off"}`,
    );
  } catch (e) {
    add("Stripe", "fail", (e as Error).message.slice(0, 160));
  }
}

async function main() {
  console.log("\nPreflight — connectivity to backing services\n");
  await checkPostgres();
  await checkRedis();
  await checkBlob();
  await checkStripe();

  let failed = 0;
  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : r.status === "skip" ? "·" : "✗";
    if (r.status === "fail") failed++;
    console.log(`  ${icon} ${r.name.padEnd(14)} ${r.detail}`);
  }
  console.log(
    `\n${failed === 0 ? "✓ all configured dependencies reachable" : `✗ ${failed} check(s) failed`}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
