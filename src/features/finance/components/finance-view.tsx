"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import type { FinancePreset } from "../range";

interface Overview {
  billedCents: number;
  grossReceivedCents: number;
  netReceivedCents: number;
  pendingCents: number;
  refundedCents: number;
  platformFeesCents: number;
  payoutCents: number;
  appointmentsCount: number;
  avgTicketCents: number;
  activeClientSubs: number;
  commissionsTotalCents: number;
  commissions: {
    employeeId: string;
    name: string;
    appts: number;
    baseCents: number;
    commissionCents: number;
  }[];
}
interface PayRow {
  id: string;
  createdAt: string;
  amountCents: number;
  refundedCents: number;
  platformFeeCents: number;
  currency: string;
  status: string;
  method: string;
  customerName: string | null;
  serviceName: string | null;
}

const PRESETS: FinancePreset[] = ["today", "week", "month", "quarter", "year", "custom"];

export function FinanceView({
  locale,
  currency,
  preset,
  from,
  to,
  overview,
  series,
  payments,
  exportHref,
}: {
  locale: string;
  currency: string;
  preset: FinancePreset;
  from: string;
  to: string;
  overview: Overview;
  series: { month: string; billedCents: number; receivedCents: number }[];
  payments: { total: number; page: number; pages: number; rows: PayRow[] };
  exportHref: string;
}) {
  const t = useTranslations("finance");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const money = (c: number) => formatMoney(c, currency, locale);

  function setParam(next: Record<string, string>) {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("page" in next)) p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  const kpis = [
    { label: t("billed"), value: money(overview.billedCents) },
    { label: t("received"), value: money(overview.netReceivedCents) },
    { label: t("pending"), value: money(overview.pendingCents) },
    { label: t("refunded"), value: money(overview.refundedCents) },
    { label: t("avgTicket"), value: money(overview.avgTicketCents) },
    { label: t("appointments"), value: String(overview.appointmentsCount) },
    { label: t("platformFees"), value: money(overview.platformFeesCents) },
    { label: t("commissions"), value: money(overview.commissionsTotalCents) },
  ];

  const maxSeries = Math.max(1, ...series.map((s) => Math.max(s.billedCents, s.receivedCents)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref}>{t("exportCsv")}</a>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="inline-flex flex-wrap rounded-md border">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setParam({ preset: p })}
              className={`px-3 py-1.5 text-sm ${preset === p ? "bg-primary text-primary-foreground" : ""}`}
            >
              {t(`preset.${p}`)}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <form
            className="flex items-end gap-2"
            action={(fd) =>
              setParam({
                preset: "custom",
                from: String(fd.get("from") ?? ""),
                to: String(fd.get("to") ?? ""),
              })
            }
          >
            <Input type="date" name="from" defaultValue={from} />
            <Input type="date" name="to" defaultValue={to} />
            <Button type="submit" size="sm" variant="outline">
              {t("apply")}
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("last6")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            {series.map((s) => (
              <div key={s.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end justify-center gap-1">
                  <div
                    className="w-3 rounded-t bg-primary/70"
                    style={{ height: `${(s.billedCents / maxSeries) * 100}%` }}
                    title={`${t("billed")}: ${money(s.billedCents)}`}
                  />
                  <div
                    className="w-3 rounded-t bg-emerald-500/70"
                    style={{ height: `${(s.receivedCents / maxSeries) * 100}%` }}
                    title={`${t("received")}: ${money(s.receivedCents)}`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{s.month.slice(5)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="mr-3">▮ {t("billed")}</span>
            <span className="text-emerald-600">▮ {t("received")}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("commissionsByBarber")}</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.commissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1">{t("barber")}</th>
                  <th className="py-1">{t("apptsCol")}</th>
                  <th className="py-1">{t("baseCol")}</th>
                  <th className="py-1">{t("commissionCol")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overview.commissions.map((c) => (
                  <tr key={c.employeeId}>
                    <td className="py-1.5">{c.name}</td>
                    <td className="py-1.5 text-muted-foreground">{c.appts}</td>
                    <td className="py-1.5 text-muted-foreground">{money(c.baseCents)}</td>
                    <td className="py-1.5 font-medium">{money(c.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("paymentsLog")}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1">{t("dateCol")}</th>
                    <th className="py-1">{t("customerCol")}</th>
                    <th className="py-1">{t("amountCol")}</th>
                    <th className="py-1">{t("feeCol")}</th>
                    <th className="py-1">{t("statusCol")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.rows.map((p) => (
                    <tr key={p.id}>
                      <td className="py-1.5 text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString(locale)}
                      </td>
                      <td className="py-1.5">
                        {p.customerName ?? "—"}
                        {p.serviceName ? (
                          <span className="text-muted-foreground"> · {p.serviceName}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5">{money(p.amountCents)}</td>
                      <td className="py-1.5 text-muted-foreground">{money(p.platformFeeCents)}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {t.has(`pst.${p.status}`) ? t(`pst.${p.status}`) : p.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>{t("countLabel", { total: String(payments.total) })}</span>
                <div className="flex items-center gap-2">
                  <Link
                    aria-disabled={payments.page <= 1}
                    href={`?preset=${preset}&page=${payments.page - 1}`}
                    className={payments.page <= 1 ? "pointer-events-none opacity-40" : "underline"}
                  >
                    {t("prev")}
                  </Link>
                  <span>
                    {payments.page} / {Math.max(1, payments.pages)}
                  </span>
                  <Link
                    aria-disabled={payments.page >= payments.pages}
                    href={`?preset=${preset}&page=${payments.page + 1}`}
                    className={
                      payments.page >= payments.pages
                        ? "pointer-events-none opacity-40"
                        : "underline"
                    }
                  >
                    {t("next")}
                  </Link>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
