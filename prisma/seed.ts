import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Idempotent seed:
 *   - the 3 SaaS plans (data, not code — see dev-saas)
 *   - one platform Super Admin (credentials from env; dev fallback with a warning)
 *
 * No fake tenants/appointments — set SEED_DEMO=true only if you explicitly want
 * sample data for a demo environment.
 */
const prisma = new PrismaClient();

const PLANS = [
  {
    code: "starter",
    name: "Starter",
    priceCents: 8900,
    currency: "BRL",
    interval: "month",
    trialDays: 14,
    sortOrder: 1,
    limits: {
      maxEmployees: 3,
      maxServices: 20,
      maxMonthlyAppointments: 400,
      whatsapp: false,
      chatbot: false,
      campaigns: false,
    },
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 17900,
    currency: "BRL",
    interval: "month",
    trialDays: 14,
    sortOrder: 2,
    limits: {
      maxEmployees: 10,
      maxServices: 100,
      maxMonthlyAppointments: 2000,
      whatsapp: true,
      chatbot: true,
      campaigns: true,
    },
  },
  {
    code: "scale",
    name: "Scale",
    priceCents: 34900,
    currency: "BRL",
    interval: "month",
    trialDays: 14,
    sortOrder: 3,
    limits: {
      maxEmployees: 50,
      maxServices: 500,
      maxMonthlyAppointments: 20000,
      whatsapp: true,
      chatbot: true,
      campaigns: true,
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
        interval: plan.interval,
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
