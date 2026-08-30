"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { CustomerModal } from "./customer-modal";
import type { ListFilters } from "../schema";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  status: string;
  tags: string[];
  visitsCount: number;
  totalSpentCents: number;
  lastVisitAt: string | null;
};

const SEGMENTS = [
  "all",
  "active",
  "inactive",
  "new",
  "recurring",
  "by_service",
  "by_employee",
  "opted_in",
] as const;

export function ClientsView({
  locale,
  canWrite,
  canDelete,
  currency,
  filters,
  metrics,
  list,
  employees,
  services,
}: {
  locale: string;
  canWrite: boolean;
  canDelete: boolean;
  currency: string;
  filters: ListFilters;
  metrics: {
    total: number;
    active: number;
    inactive: number;
    new: number;
    recurring: number;
    blocked: number;
    optInWhatsapp: number;
    optInEmail: number;
  };
  list: { total: number; page: number; pages: number; pageSize: number; rows: Row[] };
  employees: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const t = useTranslations("crm");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [editing, setEditing] = useState<Row | null | "new">(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function setParam(next: Record<string, string>) {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("page" in next)) p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  const stats = [
    { label: t("mTotal"), value: metrics.total },
    { label: t("mActive"), value: metrics.active },
    { label: t("mInactive"), value: metrics.inactive },
    { label: t("mNew"), value: metrics.new },
    { label: t("mRecurring"), value: metrics.recurring },
    { label: t("mOptInWa"), value: metrics.optInWhatsapp },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {canWrite && <Button onClick={() => setEditing("new")}>{t("new")}</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex items-end gap-2"
          action={(fd) => setParam({ q: String(fd.get("q") ?? "") })}
        >
          <Input name="q" placeholder={t("search")} defaultValue={filters.q} className="w-56" />
          <Button type="submit" variant="outline" size="sm">
            {t("search")}
          </Button>
        </form>
        <Select
          className="w-40"
          value={filters.status}
          onChange={(e) => setParam({ status: e.target.value })}
        >
          {["ALL", "ACTIVE", "INACTIVE", "BLOCKED"].map((s) => (
            <option key={s} value={s}>
              {t(`status${s}`)}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={filters.segment}
          onChange={(e) => setParam({ segment: e.target.value })}
        >
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {t(`seg_${s}`)}
            </option>
          ))}
        </Select>
        {filters.segment === "by_service" && (
          <Select
            className="w-44"
            value={filters.serviceId}
            onChange={(e) => setParam({ serviceId: e.target.value })}
          >
            <option value="">—</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        {filters.segment === "by_employee" && (
          <Select
            className="w-44"
            value={filters.employeeId}
            onChange={(e) => setParam({ employeeId: e.target.value })}
          >
            <option value="">—</option>
            {employees.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("name")}</th>
              <th className="p-3">{t("contact")}</th>
              <th className="p-3">{t("visits")}</th>
              <th className="p-3">{t("totalSpent")}</th>
              <th className="p-3">{t("lastVisit")}</th>
              <th className="p-3">{t("status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
            {list.rows.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer hover:bg-accent/40"
                onClick={() => setDetailId(c.id)}
              >
                <td className="p-3 font-medium">
                  {c.name}
                  {c.tags.length > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">{c.tags.join(", ")}</span>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">{c.email ?? c.phone ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{c.visitsCount}</td>
                <td className="p-3 text-muted-foreground">
                  {formatMoney(c.totalSpentCents, currency, locale)}
                </td>
                <td className="p-3 text-muted-foreground">
                  {c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString(locale) : "—"}
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t(`status${c.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("countLabel", { total: String(list.total) })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={list.page <= 1}
            onClick={() => setParam({ page: String(list.page - 1) })}
          >
            {t("prev")}
          </Button>
          <span>
            {list.page} / {Math.max(1, list.pages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={list.page >= list.pages}
            onClick={() => setParam({ page: String(list.page + 1) })}
          >
            {t("next")}
          </Button>
        </div>
      </div>

      {editing && (
        <CustomerModal
          mode="edit"
          locale={locale}
          canDelete={canDelete}
          employees={employees}
          customer={editing === "new" ? null : { id: editing.id }}
          onClose={() => setEditing(null)}
        />
      )}
      {detailId && (
        <CustomerModal
          mode="detail"
          locale={locale}
          canWrite={canWrite}
          canDelete={canDelete}
          currency={currency}
          employees={employees}
          customer={{ id: detailId }}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
