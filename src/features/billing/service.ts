import "server-only";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { paymentProvider } from "@/server/payments";
import { getEntitlements } from "./gate";

export class BillingConfigError extends Error {
  code: "PLAN_NOT_IN_STRIPE" | "NO_STRIPE_CUSTOMER";
  constructor(code: BillingConfigError["code"], message?: string) {
    super(message ?? code);
    this.name = "BillingConfigError";
    this.code = code;
  }
}

export async function listPublicPlans() {
  return prisma.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: "asc" } });
}

interface CheckoutArgs {
  tenantId: string;
  planCode: string;
  interval: "month" | "year";
  locale: string;
  customerEmail: string;
}

export async function startCheckout(args: CheckoutArgs): Promise<{ url: string }> {
  const plan = await prisma.plan.findUnique({ where: { code: args.planCode } });
  if (!plan) throw new BillingConfigError("PLAN_NOT_IN_STRIPE", "unknown plan");

  const priceId = args.interval === "year" ? plan.stripePriceIdYearly : plan.stripePriceId;
  if (!priceId) {
    throw new BillingConfigError(
      "PLAN_NOT_IN_STRIPE",
      `plan "${plan.code}" has no Stripe ${args.interval} price id`,
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: { stripeCustomerId: true },
  });

  const base = `${env.APP_URL}/${args.locale}/billing`;
  const result = await paymentProvider.createSubscriptionCheckout({
    tenantId: args.tenantId,
    planCode: plan.code,
    priceId,
    successUrl: `${base}?checkout=success`,
    cancelUrl: `${base}?checkout=canceled`,
    customerEmail: args.customerEmail,
    existingCustomerId: tenant?.stripeCustomerId ?? undefined,
    trialDays: plan.trialDays,
  });
  return { url: result.url };
}

export async function openBillingPortal(
  tenantId: string,
  locale: string,
): Promise<{ url: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeCustomerId: true },
  });
  if (!tenant?.stripeCustomerId) throw new BillingConfigError("NO_STRIPE_CUSTOMER");
  return paymentProvider.createBillingPortalSession(
    tenant.stripeCustomerId,
    `${env.APP_URL}/${locale}/billing`,
  );
}

export async function getBillingSummary(tenantId: string) {
  const [ent, invoices, plans, sub] = await Promise.all([
    getEntitlements(tenantId),
    prisma.invoice.findMany({
      where: { tenantId, scope: "PLATFORM" },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        status: true,
        amountDueCents: true,
        amountPaidCents: true,
        currency: true,
        hostedUrl: true,
        pdfUrl: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
      },
    }),
    listPublicPlans(),
    prisma.subscription.findFirst({
      where: { tenantId, scope: "PLATFORM" },
      orderBy: { createdAt: "desc" },
      select: { interval: true, priceCents: true, currency: true, providerSubId: true },
    }),
  ]);
  return { ent, invoices, plans, sub };
}
