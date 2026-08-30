import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { isConfigured } from "@/env";
import { getTenantById } from "@/features/tenant/service";
import { listPaymentLinks, listClientPayments } from "@/features/payments/links";
import { getPayoutAccount } from "@/features/payments/connect";
import { PaymentsView } from "@/features/payments/components/payments-view";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("payments");
  const canManageAccount = roleCan(active.role, "payout.manage");
  const canCreateLink = roleCan(active.role, "payment.link.create");

  const [tenant, account, links, payments] = await Promise.all([
    getTenantById(active.tenantId),
    getPayoutAccount(active.tenantId),
    listPaymentLinks(active.tenantId),
    listClientPayments(active.tenantId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PaymentsView
        locale={locale}
        currency={tenant?.currency ?? "BRL"}
        stripeConnectConfigured={isConfigured.stripeConnect}
        canManageAccount={canManageAccount}
        canCreateLink={canCreateLink}
        account={
          account
            ? {
                status: account.status,
                chargesEnabled: account.chargesEnabled,
                payoutsEnabled: account.payoutsEnabled,
                connected: !!account.providerAccountId,
              }
            : {
                status: "NOT_CONNECTED",
                chargesEnabled: false,
                payoutsEnabled: false,
                connected: false,
              }
        }
        links={links.map((l) => ({
          id: l.id,
          description: l.description,
          amountCents: l.amountCents,
          currency: l.currency,
          status: l.status,
          url: l.url,
          customerName: l.customer?.name ?? null,
          createdAt: l.createdAt.toISOString(),
        }))}
        payments={payments.map((p) => ({
          id: p.id,
          amountCents: p.amountCents,
          refundedCents: p.refundedCents,
          platformFeeCents: p.platformFeeCents,
          netCents: p.netCents,
          currency: p.currency,
          status: p.status,
          method: p.method,
          customerName: p.customer?.name ?? null,
          serviceName: p.appointment?.serviceName ?? null,
          createdAt: p.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
