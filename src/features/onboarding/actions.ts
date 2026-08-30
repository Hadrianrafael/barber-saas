"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppSession } from "@/server/auth/current-user";
import { forTenant } from "@/server/db/tenant";
import { prisma } from "@/server/db/client";
// forTenant is still used for the plan-selection subscription writes below.
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { isConfigured } from "@/env";
import { getCountry } from "@/lib/regions";
import { checkSlug } from "@/features/tenant/slug";
import {
  createTenantSchema,
  tenantProfileSchema,
  businessHoursSchema,
} from "@/features/tenant/schema";
import {
  slugExists,
  createTenantWithOwner,
  updateTenantProfile,
  replaceBusinessHours,
} from "@/features/tenant/service";

export interface OnboardingState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}

async function requireVerifiedUser() {
  const session = await getAppSession();
  if (!session) redirect("/pt-BR/sign-in");
  return session;
}

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Live slug availability check for the wizard (debounced client-side). */
export async function checkSlugAction(
  raw: string,
): Promise<{ slug: string; available: boolean; problem: string | null }> {
  const session = await getAppSession();
  if (!session) return { slug: "", available: false, problem: "unauthenticated" };
  const rl = await rateLimit(`slugcheck:${session.userId}`, 40, 60);
  if (!rl.ok) return { slug: "", available: false, problem: "rate_limited" };
  const res = await checkSlug(raw ?? "", slugExists);
  return { slug: res.slug, available: res.available, problem: res.problem };
}

const hoursField = z.string().transform((s, ctx) => {
  try {
    return JSON.parse(s);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalidHours" });
    return z.NEVER;
  }
});

export async function createTenantAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await requireVerifiedUser();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { emailVerifiedAt: true, disabledAt: true },
  });
  if (!user || user.disabledAt) redirect("/pt-BR/sign-in");
  if (!user.emailVerifiedAt) return { ok: false, code: "emailNotVerified" };

  const clientIp = await ip();
  const rl = await rateLimit(`createtenant:${session.userId}`, 5, 60 * 60);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const raw = Object.fromEntries(formData);

  const identity = createTenantSchema.safeParse(raw);
  if (!identity.success) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        identity.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
      ),
    };
  }

  // Cross-check currency/timezone belong to something sane for the country.
  const country = getCountry(identity.data.country);
  if (!country) return { ok: false, fieldErrors: { country: "invalid" } };

  // Optional profile (step 2) — only validate if any field is present.
  let profile: ReturnType<typeof tenantProfileSchema.safeParse> | null = null;
  const hasProfile = [
    "description",
    "email",
    "phone",
    "whatsapp",
    "instagram",
    "website",
    "addressLine1",
    "city",
  ].some((k) => String(raw[k] ?? "").trim().length > 0);
  if (hasProfile) {
    profile = tenantProfileSchema.safeParse({ ...raw, name: identity.data.name });
    if (!profile.success) {
      return {
        ok: false,
        fieldErrors: Object.fromEntries(
          profile.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
        ),
      };
    }
  }

  // Optional business hours (step 3).
  let hours: ReturnType<typeof businessHoursSchema.safeParse> | null = null;
  if (typeof raw.hours === "string" && raw.hours.length > 0) {
    const parsedJson = hoursField.safeParse(raw.hours);
    if (parsedJson.success) {
      hours = businessHoursSchema.safeParse(parsedJson.data);
      if (!hours.success) return { ok: false, code: "invalidHours" };
    }
  }

  // Final slug validation server-side (never trust the client's availability).
  const slugCheck = await checkSlug(identity.data.slug, slugExists);
  if (!slugCheck.available) {
    return { ok: false, fieldErrors: { slug: slugCheck.problem ?? "taken" } };
  }

  let tenantId: string;
  try {
    const created = await createTenantWithOwner({
      userId: session.userId,
      userEmail: session.email,
      input: { ...identity.data, slug: slugCheck.slug },
      ip: clientIp,
    });
    tenantId = created.tenantId;
  } catch (err) {
    if (err instanceof Error && err.name === "SlugTakenError") {
      return { ok: false, fieldErrors: { slug: "taken" } };
    }
    logger.error({ err, userId: session.userId }, "onboarding.create_failed");
    return { ok: false, code: "error" };
  }

  if (profile?.success) {
    await updateTenantProfile(tenantId, profile.data, {
      userId: session.userId,
      label: session.email,
      ip: clientIp,
    });
  }
  if (hours?.success) {
    await replaceBusinessHours(tenantId, hours.data);
  }

  redirect(`/${identity.data.locale}/onboarding/plan`);
}

// ---- Plan selection (post-onboarding) --------------------------------

const choosePlanSchema = z.object({
  planCode: z.string().min(1),
  interval: z.enum(["month", "year"]).default("month"),
  locale: z.string().default("pt-BR"),
});

/**
 * Records the chosen SaaS plan and routes to Stripe Checkout **when Stripe is
 * configured**. Without Stripe keys, the tenant simply continues its free trial
 * — no paid features are unlocked and `status` stays TRIALING. A paid
 * subscription (`status = ACTIVE`) is only ever created by the Stripe webhook
 * handler in Slice 5.
 */
export async function choosePlanAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await getAppSession();
  if (!session) redirect("/pt-BR/sign-in");

  const parsed = choosePlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "error" };
  const { planCode, locale } = parsed.data;

  const membership = session.memberships[0];
  if (!membership) redirect(`/${locale}/onboarding`);

  const interval = parsed.data.interval === "year" ? "year" : "month";
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) return { ok: false, fieldErrors: { planCode: "invalid" } };

  const db = forTenant(membership.tenantId);

  // Record the pending PLATFORM subscription intent (trial). Status only becomes
  // ACTIVE from a verified Stripe webhook — never here. No simulated payment.
  const existing = await db.subscription.findFirst({ where: { scope: "PLATFORM" } });
  if (existing) {
    await db.subscription.update({
      where: { id: existing.id },
      data: {
        planId: plan.id,
        priceCents: interval === "year" ? plan.priceCentsYearly : plan.priceCents,
        currency: plan.currency,
        interval,
      },
    });
  } else {
    await db.subscription.create({
      data: {
        tenantId: membership.tenantId,
        scope: "PLATFORM",
        planId: plan.id,
        status: "TRIALING",
        priceCents: interval === "year" ? plan.priceCentsYearly : plan.priceCents,
        currency: plan.currency,
        interval,
        currentPeriodEnd: new Date(Date.now() + plan.trialDays * 86_400_000),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: membership.tenantId,
      actorType: "USER",
      actorId: session.userId,
      actorLabel: session.email,
      action: "billing.plan_selected",
      metadata: { planCode, interval, stripeConfigured: isConfigured.stripe },
    },
  });

  if (isConfigured.stripe) {
    const { startCheckout } = await import("@/features/billing/service");
    let checkoutUrl: string | null = null;
    try {
      checkoutUrl = (
        await startCheckout({
          tenantId: membership.tenantId,
          planCode,
          interval,
          locale,
          customerEmail: session.email,
        })
      ).url;
    } catch (e) {
      // Plan has no Stripe price id yet — fall through to the trial dashboard.
      logger.warn({ err: (e as Error).message, planCode }, "onboarding.checkout_unavailable");
    }
    if (checkoutUrl) redirect(checkoutUrl); // outside try — never swallow NEXT_REDIRECT
  }

  redirect(`/${locale}/dashboard?welcome=1`);
}
