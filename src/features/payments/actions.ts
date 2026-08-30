"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { PaymentProviderNotConfiguredError } from "@/server/payments";
import { startConnectOnboarding, refreshConnectStatus } from "./connect";
import { createPaymentLink, cancelPaymentLink, refundClientPayment } from "./links";

export interface PaymentsState {
  ok: boolean;
  code?: string;
  url?: string;
  fieldErrors?: Record<string, string>;
}

const rev = (locale: string) => revalidatePath(`/${locale}/payments`);

export async function startConnectAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "payout.manage" });
  const locale = String(fd.get("locale") ?? "pt-BR");
  try {
    const { url } = await startConnectOnboarding(ctx.tenantId, locale);
    redirect(url);
  } catch (e) {
    if (e instanceof PaymentProviderNotConfiguredError) {
      redirect(`/${locale}/payments?connect=unavailable`);
    }
    throw e;
  }
}

export async function refreshConnectAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "payout.manage" });
  const locale = String(fd.get("locale") ?? "pt-BR");
  try {
    await refreshConnectStatus(ctx.tenantId);
  } catch (e) {
    if (!(e instanceof PaymentProviderNotConfiguredError)) throw e;
  }
  rev(locale);
}

const linkSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount: z.coerce.number().positive().max(1_000_000),
  currency: z.string().length(3),
  customerId: z.string().optional().or(z.literal("")),
  appointmentId: z.string().optional().or(z.literal("")),
  locale: z.string().default("pt-BR"),
});

export async function createPaymentLinkAction(
  _prev: PaymentsState,
  fd: FormData,
): Promise<PaymentsState> {
  const ctx = await requireTenantContext({ permission: "payment.link.create" });
  const parsed = linkSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
      ),
    };
  }
  const d = parsed.data;
  try {
    const link = await createPaymentLink({
      tenantId: ctx.tenantId,
      description: d.description,
      amountCents: Math.round(d.amount * 100),
      currency: d.currency.toUpperCase(),
      customerId: d.customerId || null,
      appointmentId: d.appointmentId || null,
      createdById: ctx.session.userId,
      locale: d.locale,
    });
    rev(d.locale);
    return { ok: true, code: "created", url: link.url ?? undefined };
  } catch (e) {
    if (e instanceof PaymentProviderNotConfiguredError) return { ok: false, code: "notConfigured" };
    if (e instanceof Error && e.name === "ConnectNotReadyError")
      return { ok: false, code: "connectNotReady" };
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    if (e instanceof Error && e.name === "ValidationError") return { ok: false, code: "invalid" };
    throw e;
  }
}

export async function cancelPaymentLinkAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "payment.link.create" });
  const id = String(fd.get("id") ?? "");
  if (id) await cancelPaymentLink(ctx.tenantId, id);
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function refundPaymentAction(
  _prev: PaymentsState,
  fd: FormData,
): Promise<PaymentsState> {
  const ctx = await requireTenantContext({ permission: "payout.manage" });
  const id = String(fd.get("id") ?? "");
  const amount = fd.get("amount") ? Number(fd.get("amount")) : undefined;
  if (!id) return { ok: false, code: "invalid" };
  try {
    await refundClientPayment(
      ctx.tenantId,
      id,
      amount != null && amount > 0 ? Math.round(amount * 100) : undefined,
    );
    rev(String(fd.get("locale") ?? "pt-BR"));
    return { ok: true, code: "refunded" };
  } catch (e) {
    if (e instanceof PaymentProviderNotConfiguredError) return { ok: false, code: "notConfigured" };
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    if (e instanceof Error && e.name === "ValidationError")
      return { ok: false, code: "notRefundable" };
    throw e;
  }
}
