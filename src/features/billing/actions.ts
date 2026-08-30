"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { prisma } from "@/server/db/client";
import { PaymentProviderNotConfiguredError } from "@/server/payments";
import { startCheckout, openBillingPortal, BillingConfigError } from "./service";

export interface BillingState {
  ok: boolean;
  code?: string;
  url?: string;
}

const checkoutSchema = z.object({
  planCode: z.string().min(1),
  interval: z.enum(["month", "year"]).default("month"),
  locale: z.string().default("pt-BR"),
});

export async function startCheckoutAction(
  _prev: BillingState,
  fd: FormData,
): Promise<BillingState> {
  const ctx = await requireTenantContext({ permission: "tenant.billing.manage" });
  const parsed = checkoutSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    const { url } = await startCheckout({
      tenantId: ctx.tenantId,
      planCode: parsed.data.planCode,
      interval: parsed.data.interval,
      locale: parsed.data.locale,
      customerEmail: ctx.session.email,
    });
    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorType: "USER",
        actorId: ctx.session.userId,
        actorLabel: ctx.session.email,
        action: "billing.checkout_started",
        metadata: { planCode: parsed.data.planCode, interval: parsed.data.interval },
      },
    });
    redirect(url);
  } catch (e) {
    if (e instanceof PaymentProviderNotConfiguredError) {
      return { ok: false, code: "stripeNotConfigured" };
    }
    if (e instanceof BillingConfigError) {
      return {
        ok: false,
        code: e.code === "PLAN_NOT_IN_STRIPE" ? "planNotConfigured" : "noCustomer",
      };
    }
    throw e;
  }
}

export async function openPortalAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "tenant.billing.manage" });
  const locale = String(fd.get("locale") ?? "pt-BR");
  try {
    const { url } = await openBillingPortal(ctx.tenantId, locale);
    redirect(url);
  } catch (e) {
    if (e instanceof PaymentProviderNotConfiguredError || e instanceof BillingConfigError) {
      redirect(`/${locale}/billing?portal=unavailable`);
    }
    throw e;
  }
}
