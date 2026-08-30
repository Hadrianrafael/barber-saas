import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { AuthorizationError } from "@/server/rbac/guard";
import { roleCan } from "@/server/rbac/permissions";
import { getTenantById } from "@/features/tenant/service";
import {
  getFinanceOverview,
  listFinancePayments,
  getMonthlySeries,
} from "@/features/finance/service";
import { resolveRange, type FinancePreset } from "@/features/finance/range";
import { FinanceView } from "@/features/finance/components/finance-view";

export const dynamic = "force-dynamic";

const PRESETS: FinancePreset[] = ["today", "week", "month", "quarter", "year", "custom"];

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string; page?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "finance.read")) throw new AuthorizationError();

  const tenant = await getTenantById(active.tenantId);
  if (!tenant) redirect(`/${locale}/onboarding`);

  const preset: FinancePreset = PRESETS.includes(sp.preset as FinancePreset)
    ? (sp.preset as FinancePreset)
    : "month";
  const range = resolveRange(tenant.timezone, preset, sp.from, sp.to);
  const page = Math.max(1, Number(sp.page) || 1);

  const [overview, payments, series] = await Promise.all([
    getFinanceOverview(active.tenantId, range),
    listFinancePayments(active.tenantId, range, page),
    getMonthlySeries(active.tenantId, 6),
  ]);

  return (
    <FinanceView
      locale={locale}
      currency={tenant.currency}
      preset={preset}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
      overview={overview}
      series={series}
      payments={{
        total: payments.total,
        page: payments.page,
        pages: payments.pages,
        rows: payments.rows.map((p) => ({
          id: p.id,
          createdAt: p.createdAt.toISOString(),
          amountCents: p.amountCents,
          refundedCents: p.refundedCents,
          platformFeeCents: p.platformFeeCents,
          currency: p.currency,
          status: p.status,
          method: p.method,
          customerName: p.customer?.name ?? null,
          serviceName: p.appointment?.serviceName ?? null,
        })),
      }}
      exportHref={`/${locale}/finance/export?preset=${preset}${sp.from ? `&from=${sp.from}` : ""}${sp.to ? `&to=${sp.to}` : ""}`}
    />
  );
}
