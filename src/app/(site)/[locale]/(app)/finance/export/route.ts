import { NextResponse, type NextRequest } from "next/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { getTenantById } from "@/features/tenant/service";
import { listFinancePayments } from "@/features/finance/service";
import { resolveRange, type FinancePreset } from "@/features/finance/range";
import { formatMoney } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV export of the client-payment ledger for the selected period. */
export async function GET(req: NextRequest) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const active = resolveActiveTenant(session);
  if (!active || !roleCan(active.role, "finance.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const tenant = await getTenantById(active.tenantId);
  if (!tenant) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const preset = (req.nextUrl.searchParams.get("preset") as FinancePreset) || "month";
  const range = resolveRange(
    tenant.timezone,
    preset,
    req.nextUrl.searchParams.get("from") ?? undefined,
    req.nextUrl.searchParams.get("to") ?? undefined,
  );

  const rows: string[][] = [
    [
      "date",
      "customer",
      "service",
      "status",
      "method",
      "amount",
      "platform_fee",
      "refunded",
      "currency",
    ],
  ];
  for (let page = 1; page <= 100; page++) {
    const chunk = await listFinancePayments(active.tenantId, range, page, 200);
    for (const p of chunk.rows) {
      rows.push([
        p.createdAt.toISOString(),
        p.customer?.name ?? "",
        p.appointment?.serviceName ?? "",
        p.status,
        p.method,
        formatMoney(p.amountCents, p.currency, "en").replace(/[^\d.,-]/g, ""),
        formatMoney(p.platformFeeCents, p.currency, "en").replace(/[^\d.,-]/g, ""),
        formatMoney(p.refundedCents, p.currency, "en").replace(/[^\d.,-]/g, ""),
        p.currency,
      ]);
    }
    if (page >= chunk.pages) break;
  }

  // Quote every cell + neutralise spreadsheet formula injection (a value that
  // starts with = + - @ or a tab is prefixed with a single quote).
  const cell = (c: string) => {
    const s = /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map((c) => cell(String(c))).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${range.label}.csv"`,
    },
  });
}
