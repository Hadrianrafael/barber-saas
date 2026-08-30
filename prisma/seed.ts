import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Idempotent seed:
 *   - the 3 SaaS plans (data, not code — see dev-saas). Prices are BRL; Stripe
 *     Price ids are left null and set later (see docs/deployment/stripe.md).
 *   - one platform Super Admin (credentials from env; dev fallback with a warning)
 *
 * No fake tenants/appointments.
 */
const prisma = new PrismaClient();

type PlanLimits = {
  maxEmployees: number;
  maxServices: number;
  maxCustomers: number;
  maxMonthlyAppointments: number;
  maxMonthlyMessages: number;
  maxCampaignsPerMonth: number;
  maxUnits: number;
  whatsapp: boolean;
  chatbot: boolean;
  campaigns: boolean;
  loyalty: boolean;
};

const PLANS: {
  code: string;
  name: string;
  priceCents: number;
  priceCentsYearly: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  limits: PlanLimits;
}[] = [
  {
    code: "starter",
    name: "Starter",
    priceCents: 8900,
    priceCentsYearly: 89000, // ~2 months free
    currency: "BRL",
    trialDays: 14,
    sortOrder: 1,
    limits: {
      maxEmployees: 3,
      maxServices: 20,
      maxCustomers: 1000,
      maxMonthlyAppointments: 400,
      maxMonthlyMessages: 0,
      maxCampaignsPerMonth: 0,
      maxUnits: 1,
      whatsapp: false,
      chatbot: false,
      campaigns: false,
      loyalty: false,
    },
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 17900,
    priceCentsYearly: 179000,
    currency: "BRL",
    trialDays: 14,
    sortOrder: 2,
    limits: {
      maxEmployees: 10,
      maxServices: 100,
      maxCustomers: 10000,
      maxMonthlyAppointments: 2000,
      maxMonthlyMessages: 5000,
      maxCampaignsPerMonth: 20,
      maxUnits: 1,
      whatsapp: true,
      chatbot: true,
      campaigns: true,
      loyalty: true,
    },
  },
  {
    code: "scale",
    name: "Scale",
    priceCents: 34900,
    priceCentsYearly: 349000,
    currency: "BRL",
    trialDays: 14,
    sortOrder: 3,
    limits: {
      maxEmployees: 50,
      maxServices: 500,
      maxCustomers: 100000,
      maxMonthlyAppointments: 20000,
      maxMonthlyMessages: 50000,
      maxCampaignsPerMonth: 200,
      maxUnits: 10,
      whatsapp: true,
      chatbot: true,
      campaigns: true,
      loyalty: true,
    },
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        priceCents: plan.priceCents,
        priceCentsYearly: plan.priceCentsYearly,
        currency: plan.currency,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        limits: plan.limits,
      },
      create: plan,
    });
  }
  console.warn(`✓ ${PLANS.length} plans upserted`);

  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@barber.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme-admin-000";
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      "⚠  SEED_ADMIN_PASSWORD not set — using an insecure dev default. " +
        "Set it before seeding any shared/staging/prod database.",
    );
  }

  await prisma.user.upsert({
    where: { email },
    update: { isPlatformAdmin: true },
    create: {
      email,
      name: "Platform Admin",
      passwordHash: await bcrypt.hash(password, 12),
      isPlatformAdmin: true,
      emailVerifiedAt: new Date(),
      locale: "pt-BR",
    },
  });
  console.warn(`✓ super admin ready: ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
