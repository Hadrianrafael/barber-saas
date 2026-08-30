/**
 * Sync the `Plan` rows in the database to Stripe Products + Prices.
 *
 *   npm run stripe:sync-plans            # test mode (sk_test_...), applies changes
 *   npm run stripe:sync-plans -- --dry-run
 *   npm run stripe:sync-plans -- --only=pro
 *   npm run stripe:sync-plans -- --allow-live   # required to touch a live key
 *
 * Behaviour:
 *  - Creates one Stripe Product per plan (idempotent on Plan.stripeProductId).
 *  - Creates a recurring monthly Price and, if priceCentsYearly is set, a yearly
 *    Price. Stripe Prices are immutable, so when the amount/currency/interval no
 *    longer matches, a NEW price is created and the old one is archived.
 *  - Writes stripeProductId / stripePriceId / stripePriceIdYearly back to the row.
 *  - REFUSES to run against a live key unless --allow-live is passed. It never
 *    creates production prices without that explicit opt-in.
 *
 * Requires STRIPE_SECRET_KEY in the environment (loaded from .env by tsx? no —
 * pass it inline or export it first, e.g.
 *   STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans
 */
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALLOW_LIVE = args.includes("--allow-live");
const ONLY = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const TAX_CODE = args.find((a) => a.startsWith("--tax-code="))?.split("=")[1] ?? "txcd_10103001"; // SaaS

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key) {
  console.error("✗ STRIPE_SECRET_KEY is not set. Export it (test key) and re-run.");
  process.exit(1);
}
const isLive = key.startsWith("sk_live_");
if (isLive && !ALLOW_LIVE) {
  console.error(
    "✗ Refusing to run against a LIVE Stripe key without --allow-live.\n" +
      "  Use a test key (sk_test_...) for development, or pass --allow-live if you\n" +
      "  really mean to create production products/prices.",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
const mode = isLive ? "LIVE" : "TEST";

type PriceKind = "month" | "year";

async function findMatchingPrice(
  productId: string,
  unitAmount: number,
  currency: string,
  interval: PriceKind,
): Promise<Stripe.Price | null> {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return (
    prices.data.find(
      (p) =>
        p.unit_amount === unitAmount &&
        p.currency === currency.toLowerCase() &&
        p.recurring?.interval === interval,
    ) ?? null
  );
}

async function ensurePrice(
  productId: string,
  currentId: string | null,
  unitAmount: number,
  currency: string,
  interval: PriceKind,
): Promise<string> {
  if (currentId) {
    const existing = await stripe.prices.retrieve(currentId).catch(() => null);
    if (
      existing &&
      existing.active &&
      existing.unit_amount === unitAmount &&
      existing.currency === currency.toLowerCase() &&
      existing.recurring?.interval === interval
    ) {
      return existing.id;
    }
  }
  const reuse = await findMatchingPrice(productId, unitAmount, currency, interval);
  if (reuse) return reuse.id;

  const created = await stripe.prices.create({
    product: productId,
    currency: currency.toLowerCase(),
    unit_amount: unitAmount,
    recurring: { interval },
    tax_behavior: "exclusive",
    nickname: `${interval}ly`,
  });
  // Archive a stale previous price so the Dashboard stays tidy.
  if (currentId && currentId !== created.id) {
    await stripe.prices.update(currentId, { active: false }).catch(() => undefined);
  }
  return created.id;
}

async function main() {
  const plans = await prisma.plan.findMany({
    where: ONLY ? { code: ONLY } : {},
    orderBy: { sortOrder: "asc" },
  });
  if (plans.length === 0) {
    console.error(`✗ No plans found${ONLY ? ` for code "${ONLY}"` : ""}. Run \`npm run db:seed\`.`);
    process.exit(1);
  }

  console.warn(`Stripe mode: ${mode}${DRY_RUN ? " (dry run — no changes)" : ""}\n`);

  for (const plan of plans) {
    const line = `• ${plan.code} — ${plan.name} — ${(plan.priceCents / 100).toFixed(2)} ${plan.currency}/mo`;
    if (DRY_RUN) {
      console.warn(
        `${line}\n    product=${plan.stripeProductId ?? "(new)"} ` +
          `month=${plan.stripePriceId ?? "(new)"} ` +
          `year=${plan.priceCentsYearly ? (plan.stripePriceIdYearly ?? "(new)") : "—"}`,
      );
      continue;
    }

    // 1. Product
    let productId = plan.stripeProductId ?? null;
    if (productId) {
      const p = await stripe.products.retrieve(productId).catch(() => null);
      if (p && !p.deleted) {
        await stripe.products.update(productId, {
          name: plan.name,
          description: plan.description ?? undefined,
          tax_code: TAX_CODE,
          metadata: { planCode: plan.code },
        });
      } else {
        productId = null;
      }
    }
    if (!productId) {
      const p = await stripe.products.create({
        name: plan.name,
        description: plan.description ?? undefined,
        tax_code: TAX_CODE,
        metadata: { planCode: plan.code },
      });
      productId = p.id;
    }

    // 2. Prices
    const monthlyPriceId = await ensurePrice(
      productId,
      plan.stripePriceId,
      plan.priceCents,
      plan.currency,
      "month",
    );
    const yearlyPriceId = plan.priceCentsYearly
      ? await ensurePrice(
          productId,
          plan.stripePriceIdYearly,
          plan.priceCentsYearly,
          plan.currency,
          "year",
        )
      : null;

    // 3. Persist
    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripeProductId: productId,
        stripePriceId: monthlyPriceId,
        stripePriceIdYearly: yearlyPriceId,
      },
    });

    console.warn(
      `${line}\n    product=${productId}\n    month=${monthlyPriceId}` +
        (yearlyPriceId ? `\n    year=${yearlyPriceId}` : ""),
    );
  }

  console.warn(`\n✓ ${plans.length} plan(s) synced to Stripe (${mode}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
